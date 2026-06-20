import { useDeferredValue, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import type { PointerEvent as ReactPointerEvent } from "react";
import { useMediaQuery } from "./lib/useMediaQuery";
import { AboutPage } from "./components/AboutPage";
import { AppHeader } from "./components/AppHeader";
import { DetailPanel } from "./components/DetailPanel";
import { MobileComparison } from "./components/MobileComparison";
import { MobileWelcome } from "./components/MobileWelcome";
import { FiltersBar } from "./components/FiltersBar";
import { GradeInput } from "./components/GradeInput";
import { ResultsView } from "./components/ResultsView";
import { ShareView } from "./components/ShareView";
import { AnalysisView, AnalysisBody } from "./components/AnalysisView";
import { StepperBar } from "./components/StepperBar";
import { ShareButton } from "./components/ShareButton";
import { NameModal } from "./components/NameModal";
import { PreferencePlanner } from "./components/PreferencePlanner";
import { AdvisorConsole } from "./components/AdvisorConsole";
import { AdvisorEmptyState } from "./components/AdvisorEmptyState";
import { AlternativeSuggestions } from "./components/AlternativeSuggestions";
import { suggestAlternatives } from "./lib/suggestions";
import { SlotMovePicker } from "./components/SlotMovePicker";
import { filterResults, sortResults, type Filters, type SortKey } from "./lib/results";
import { trimTrailingNulls } from "./lib/arrays";
import { useLang, pickName, loadLang, type Lang } from "./lib/i18n";
import { STRINGS } from "./lib/strings";
import { institutionLabel } from "./lib/institutions";
import { buildShareUrl, encodeProfileHash, MAX_PROFILE_NAME, PROGRAMME_CODE_PATTERN, readHashState, sanitizeGrades, writeHashState } from "./lib/hashState";
import { slotLabel } from "./lib/slots";
import type { SlimResult } from "./lib/dataWorker";
import type { Profile, Programme, ProgrammeResult, StudentGrades } from "./types/jupas";

const DATA_URL = "/data/processed/JUPAS_2026_Unified_Data.json";
const VERSION_URL = "/data/processed/JUPAS_2026_Unified_Data.version";

// Stable empty reference for allResults before the first worker
// compute lands – a fresh [] each render would defeat downstream memos.
const EMPTY_RESULTS: ProgrammeResult[] = [];

// Messages the data/compute worker posts back to the main thread.
type WorkerResponse =
  | { type: "loaded"; programmes: Programme[]; version: string }
  | { type: "computed"; results: SlimResult[]; token: number }
  | { type: "error"; message: string };

const DEFAULT_FILTERS: Filters = {
  query: "",
  institutions: [],
  eligibleOnly: false,
  band: "all",
};

const INITIAL_HASH_STATE = readHashState();
const HAS_HASH_STATE = INITIAL_HASH_STATE !== null;
const IS_SHARED_VIEW = INITIAL_HASH_STATE?.sharing === true && INITIAL_HASH_STATE.pickedCodes.length > 0;

// Per-tab nav snapshot so a refresh lands back where you were — the step, the
// Step-3 sub-view (compare / detail / analysis), the open programme, and the
// scroll position — instead of resetting to Step 1 at the top. sessionStorage:
// survives a refresh, but a brand-new tab still starts fresh. Skipped for
// shared links (those route to the share view, not the calculator).
const NAV_KEY = "jupas-staging-nav";
type NavSnapshot = {
  step?: 1 | 2 | 3;
  analysisOpen?: boolean;
  mobileDetailOpen?: boolean;
  detailFromAnalysis?: boolean;
  activeCode?: string;
  scrollTop?: number;
};
const INITIAL_NAV: NavSnapshot = (() => {
  if (IS_SHARED_VIEW || typeof sessionStorage === "undefined") return {};
  try {
    return JSON.parse(sessionStorage.getItem(NAV_KEY) || "{}") as NavSnapshot;
  } catch {
    return {};
  }
})();

// True when the initial sharing URL encodes the same grades+picks as one of
// the user's own local profiles – i.e. they're looking at THEIR OWN share /
// analysis link (e.g. after refreshing their own Analysis view), not a
// foreign share. Compared data-only (name omitted) via the same encoder, so
// it's robust to decode round-trips. When own, we must NOT enter recipient
// (preview) mode – that would force the social ShareView over the AnalysisView.
function initialShareIsOwn(profiles: Profile[]): boolean {
  if (!IS_SHARED_VIEW || !INITIAL_HASH_STATE) return false;
  const incoming = encodeProfileHash(INITIAL_HASH_STATE.grades, INITIAL_HASH_STATE.pickedCodes);
  return profiles.some((p) => encodeProfileHash(p.grades || {}, p.pickedCodes ?? []) === incoming);
}

// First-run mobile landing flag. The welcome screen (MobileWelcome) is a
// one-time orientation shown only to genuine first-timers. We persist a
// flag on dismissal AND guard on existing data so anyone who used the app
// before this flag existed never gets it retroactively; deep links /
// shared URLs skip it entirely (they have content to show immediately).
const WELCOME_SEEN_KEY = "jupas-staging-seen-welcome";
const DEFAULT_PROFILE_NAME = STRINGS["profile.defaultName"];

function defaultProfileName(lang: Lang = loadLang()): string {
  return DEFAULT_PROFILE_NAME[lang] ?? DEFAULT_PROFILE_NAME.en;
}

function isLocalizableDefaultProfile(profile: Profile): boolean {
  return profile.id === "default" && Object.values(DEFAULT_PROFILE_NAME).includes(profile.name.trim());
}

function shouldShowWelcome(): boolean {
  if (HAS_HASH_STATE) return false; // deep link / shared URL – go straight in
  try {
    if (localStorage.getItem(WELCOME_SEEN_KEY)) return false;
    if (localStorage.getItem("jupas-staging-profiles")) return false; // returning user
    if (localStorage.getItem("jupas-staging-grades")) return false; // legacy returning user
  } catch {
    // localStorage unavailable (private mode etc.) – treat as first visit.
  }
  return true;
}

type Theme = "light" | "dark";

function getRoute(): "home" | "about" {
  return window.location.hash === "#about" ? "about" : "home";
}

function App() {
  const [route, setRoute] = useState<"home" | "about">(() => getRoute());
  useEffect(() => {
    const onHashChange = () => setRoute(getRoute());
    window.addEventListener("hashchange", onHashChange);
    return () => window.removeEventListener("hashchange", onHashChange);
  }, []);

  if (route === "about") {
    return <AboutPage />;
  }

  return <CalculatorApp />;
}

function CalculatorApp() {
  const { t, lang } = useLang();
  const [programmes, setProgrammes] = useState<Programme[]>([]);
  // Profiles & local-storage state. Note `loadProfiles()` no longer appends
  // a synthetic "Shared profile" – the recipient preview is a separate
  // transient state (below) so the user's localStorage isn't mutated by
  // just opening someone else's share link.
  const [profiles, setProfiles] = useState<Profile[]>(() => loadProfiles());
  const [activeProfileId, setActiveProfileId] = useState<string>(() => loadActiveProfileId(profiles));
  useEffect(() => {
    setProfiles((current) => {
      const nextName = defaultProfileName(lang);
      let changed = false;
      const next = current.map((profile) => {
        if (!isLocalizableDefaultProfile(profile) || profile.name === nextName) return profile;
        changed = true;
        return { ...profile, name: nextName };
      });
      return changed ? next : current;
    });
  }, [lang]);
  // Recipient mode: a transient preview profile sourced from a sharing URL.
  // Lives only in React state. Not persisted to localStorage until the user
  // hits "Save as my profile". When non-null AND shareViewMode is true, the
  // ShareView renders this instead of any local profile.
  const [previewProfile, setPreviewProfile] = useState<Profile | null>(() => {
    if (!IS_SHARED_VIEW || !INITIAL_HASH_STATE) return null;
    // Owner refreshing their OWN share/analysis URL: stay out of recipient
    // (preview) mode. Leaving previewProfile null keeps sharedViewActive
    // false, so an "advisor" view re-renders the AnalysisView instead of
    // being forced onto the social ShareView.
    if (initialShareIsOwn(profiles)) return null;
    return {
      id: "__preview__",
      // Use the URL's profile name if present so the recipient sees
      // who sent it; fall back to a generic label otherwise.
      name: INITIAL_HASH_STATE.name || "Shared plan",
      grades: INITIAL_HASH_STATE.grades,
      pickedCodes: INITIAL_HASH_STATE.pickedCodes,
    };
  });
  const activeProfile = profiles.find((p) => p.id === activeProfileId) || profiles[0];
  // Picks live on the active profile (or the preview profile when viewing
  // a received share). Undefined on legacy profiles → treat as [].
  const sharedViewActive = !!previewProfile;
  const displayProfile = sharedViewActive ? previewProfile! : activeProfile;
  const grades = displayProfile.grades;
  const deferredGrades = useDeferredValue(grades);
  const pickedCodes = displayProfile.pickedCodes ?? [];

  function setPickedCodes(
    updater: (string | null)[] | ((current: (string | null)[]) => (string | null)[]),
  ) {
    // Edits to picks while viewing a received share apply to that preview
    // profile only (and never leak into localStorage). Otherwise they
    // update the active local profile.
    if (sharedViewActive && previewProfile) {
      setPreviewProfile((prev) => {
        if (!prev) return prev;
        const current = prev.pickedCodes ?? [];
        const next = typeof updater === "function" ? updater(current) : updater;
        return { ...prev, pickedCodes: next };
      });
      return;
    }
    setProfiles((prev) =>
      prev.map((p) => {
        if (p.id !== activeProfileId) return p;
        const current = p.pickedCodes ?? [];
        const next = typeof updater === "function" ? updater(current) : updater;
        return { ...p, pickedCodes: next };
      }),
    );
  }

  const [theme, setTheme] = useState<Theme>(() => loadTheme());
  const [filters, setFilters] = useState<Filters>(DEFAULT_FILTERS);
  const [programmeFiltersOpen, setProgrammeFiltersOpen] = useState(!HAS_HASH_STATE);
  // Closable notice shown when the "Above UQ" band filter is active:
  // only HKU & CUHK publish upper-quartile scores, so results look sparse.
  // `dismissed` is a per-session "Dismiss" (re-arms when the band leaves
  // above-uq); `hidden` is the persisted "Don't show again" (localStorage,
  // cookie-banner style).
  const [uqNoticeDismissed, setUqNoticeDismissed] = useState(false);
  const [uqNoticeHidden, setUqNoticeHidden] = useState(() => {
    try { return localStorage.getItem("jupas-staging-uq-notice") === "hidden"; } catch { return false; }
  });
  function dontShowUqNoticeAgain() {
    try { localStorage.setItem("jupas-staging-uq-notice", "hidden"); } catch { /* best-effort */ }
    setUqNoticeHidden(true);
  }
  const [compactResults, setCompactResults] = useState(false);
  // Benchmark delta display in the Browse table: raw points vs % of the benchmark.
  // Default to % — it's the more comparable metric across programmes.
  const [deltaMode, setDeltaMode] = useState<"points" | "percent">("percent");
  const [selectedOnly, setSelectedOnly] = useState(false);
  const [sortKey, setSortKey] = useState<SortKey>("code");
  const [sortDirection, setSortDirection] = useState<"asc" | "desc">("asc");
  const [activeCode, setActiveCode] = useState<string | undefined>(INITIAL_NAV.activeCode);
  // Mobile-only: step 3 starts on a comparison list. Tapping a row
  // opens the full DetailPanel (with swipe between picks); the panel's
  // back button returns to the comparison.
  const [mobileDetailOpen, setMobileDetailOpen] = useState(INITIAL_NAV.mobileDetailOpen ?? false);
  // Analysis is the THIRD sub-view of Step 3 (the in-flow "Step 4"): the
  // compare list slides forward to it just like compare→detail, so it reads
  // as a natural continuation of the same sequence rather than a new page.
  const [analysisOpen, setAnalysisOpen] = useState(INITIAL_NAV.analysisOpen ?? false);
  // Tracks the most recent transition direction between the mobile
  // comparison list and the detail panel, so we can play a directional
  // slide-in animation (right = drill-in, left = back).
  const [mobileDetailDirection, setMobileDetailDirection] = useState<"forward" | "backward">("forward");
  // Refs initialised lazily below once `step` is declared. They're
  // declared here so consumers of stepDirection / shouldAnimateMobileDetail
  // can reference them in the same scope as the other view state.
  const prevStepRef = useRef<1 | 2 | 3 | null>(null);
  const stepDirectionRef = useRef<"forward" | "backward">("forward");
  // Step 3 stacks three sub-views in one sliding pane: the compare list, a
  // programme's detail, and the Analysis read. This is the one showing now.
  const step3SubView: "compare" | "detail" | "analysis" =
    analysisOpen ? "analysis" : mobileDetailOpen ? "detail" : "compare";
  // Suppress the inner .mobile-step3-pane animation on initial entry into
  // Step 3 so it doesn't double-fire on top of the step-level slide. The ref
  // flips after the first render in Step 3, so any later sub-view swap
  // (compare↔detail↔analysis) still animates.
  const lastSeenStep3SubRef = useRef<string | null>(null);
  const shouldAnimateMobileDetail = lastSeenStep3SubRef.current !== null && lastSeenStep3SubRef.current !== step3SubView;
  // The mobile scroll container is .app-shell itself (html/body are
  // overflow:hidden), so each step shares one scroll offset. Ref'd here so we
  // can reset it to the top whenever the visible page changes (see below).
  const appShellRef = useRef<HTMLElement>(null);
  // True when the open DetailPanel was reached from the Analysis page (vs
  // the Step-3 compare list). Lets the Back button return to Analysis
  // instead of the compare list.
  const [detailFromAnalysis, setDetailFromAnalysis] = useState(INITIAL_NAV.detailFromAnalysis ?? false);
  const [reviewRequest, setReviewRequest] = useState(HAS_HASH_STATE ? 1 : 0);
  const [loadError, setLoadError] = useState<string>();
  const [dataLoaded, setDataLoaded] = useState(false);
  // The data/compute worker + a monotonic token to discard stale
  // compute responses when grades change faster than the worker
  // replies. Declared up here so the load effect below can reach them.
  const workerRef = useRef<Worker | null>(null);
  const computeTokenRef = useRef(0);
  // Share view is a soft view-switch (no page reload). Holds the chosen
  // audience variant (or null when not sharing). Two share buttons in
  // step 3 each pick a different mode:
  //   - "advisor": detailed plan view – for teachers/parents reviewing
  //     the picks (eventually strips the visual recap card).
  //   - "social": image-friendly card view – for casual sharing (will
  //     eventually become the screenshot/native-share artifact).
  // For now both modes render the same ShareView content; the prop is
  // threaded through so we can differentiate during the visual redesign
  // without re-plumbing state. The mode is now encoded in the share URL,
  // so a refresh restores the exact view (Analysis vs Share); older URLs
  // without the bit decode to "advisor".
  type ShareMode = "advisor" | "social";
  const [shareViewMode, setShareViewMode] = useState<ShareMode | null>(
    IS_SHARED_VIEW ? (INITIAL_HASH_STATE?.mode ?? "advisor") : null,
  );
  // Drives the Analysis/Share page's slide-OUT (mirror of its slide-in).
  // The Back button sets this; we keep the view mounted through the exit
  // animation, then clear shareViewMode to reveal Step 3 underneath.
  const [shareViewExiting, setShareViewExiting] = useState(false);
  // Preview banner can be hidden to a corner FAB. Each new URL paste
  // re-shows the banner so the user notices the context switch.
  const [previewBannerHidden, setPreviewBannerHidden] = useState(false);

  // Watch the URL hash for runtime changes – user pasting a different URL
  // into the address bar (fires `hashchange`) or hitting the back/forward
  // buttons (`popstate`). Each external URL change creates a TRANSIENT
  // preview profile so the DOM matches the URL, without ever mutating the
  // user's local profiles. To keep / edit the preview the user must hit
  // "Save as profile" in the banner / share view; to drop it they hit
  // "Discard". Our own writes use replaceState / pushState which do NOT
  // fire `hashchange`, so this listener never reacts to internally-driven
  // URL updates.
  //
  // The popstate firing on browser-back from our pushState'd ShareView
  // would otherwise see the user's own calculator URL and mistakenly
  // create a preview profile from it (readOnly preview of their own
  // data). We guard against that via the activeProfile match check
  // below.
  const activeProfileRef = useRef<Profile>(activeProfile);
  useEffect(() => { activeProfileRef.current = activeProfile; });
  // True while WE are showing our own share view (set synchronously in
  // enter/exitShareMode, never via render) so the back handler can tell a
  // share-close from a step-back without a render race. See the back-nav trap.
  const inShareRef = useRef(false);
  useEffect(() => {
    const onUrlChange = () => {
      // Ignore navigations among our OWN history entries (jcOwn) – step / sub-
      // view backs handled by the back-nav trap below. Their URLs can be stale
      // (lower entries keep the plan as it was when current), so reacting here
      // would wrongly flag them as a foreign URL and drop into view mode. Only
      // genuinely foreign URLs (pasted → null state) fall through.
      if ((window.history.state as { jcOwn?: boolean } | null)?.jcOwn) return;
      const state = readHashState();
      const hasContent = !!state && (
        Object.keys(state.grades).length > 0 || state.pickedCodes.length > 0
      );
      if (!hasContent) {
        // Empty hash → drop any preview, exit share view.
        setPreviewProfile(null);
        setShareViewMode(null);
        return;
      }
      // Distinguish "I just browser-backed out of my own ShareView"
      // from "I pasted a foreign share URL". Compare the popped state
      // to the user's own active profile – if grades + picks match,
      // it's our own data and we should just clear shareViewMode
      // without entering readOnly preview mode.
      const own = activeProfileRef.current;
      const ownGrades = own.grades || {};
      const ownPicks = own.pickedCodes ?? [];
      // Definitive own-data check: does the incoming URL hash equal exactly
      // the calc URL our active profile encodes to? Back-nav out of our own
      // ShareView lands on our own calc URL, whose hash is generated from
      // this same profile – so the strings match. Robust against any
      // decode-roundtrip quirks the object compare below could trip on.
      const incomingHash = window.location.hash.slice(1);
      const ownHash = encodeProfileHash(ownGrades, ownPicks, own.name);
      const ownGradesKeys = Object.keys(ownGrades);
      const stateGradesKeys = Object.keys(state!.grades);
      const gradesMatch = ownGradesKeys.length === stateGradesKeys.length
        && stateGradesKeys.every((k) => state!.grades[k] === ownGrades[k]);
      const picksMatch = state!.pickedCodes.length === ownPicks.length
        && state!.pickedCodes.every((c, i) => c === ownPicks[i]);
      if (incomingHash === ownHash || (gradesMatch && picksMatch)) {
        setShareViewMode(null);
        setPreviewProfile(null);
        return;
      }
      setPreviewProfile({
        id: "__preview__",
        // Prefer the URL's encoded name. If absent (older URL, or
        // someone hand-typed one), fall back to a generic label.
        name: state!.name || (state!.sharing ? "Shared plan" : "URL preview"),
        grades: state!.grades,
        pickedCodes: state!.pickedCodes,
      });
      setShareViewMode(state!.sharing === true ? (state!.mode ?? "advisor") : null);
      // New URL = fresh context, re-show the banner regardless of
      // whether the user previously hid it for the last preview.
      setPreviewBannerHidden(false);
    };
    window.addEventListener("hashchange", onUrlChange);
    window.addEventListener("popstate", onUrlChange);
    return () => {
      window.removeEventListener("hashchange", onUrlChange);
      window.removeEventListener("popstate", onUrlChange);
    };
  }, []);

  const pickedCount = pickedCodes.filter((c) => c !== null).length;

  // Always start at Step 1. (We used to auto-jump to Step 3 when a saved/linked
  // plan already had grades + programmes, and Step 2 when it had only grades –
  // that's removed: the saved data still loads, the user just begins at Step 1.)
  const [step, setStep] = useState<1 | 2 | 3>(INITIAL_NAV.step ?? 1);

  // Compute step direction synchronously during render. Using a
  // useEffect for this lags by one render, leaving the new active
  // panel with the previous direction on its very first animation
  // frame – visibly wrong. Refs let us update during render.
  if (prevStepRef.current !== null && prevStepRef.current !== step) {
    stepDirectionRef.current = step > prevStepRef.current ? "forward" : "backward";
  }
  prevStepRef.current = step;
  const stepDirection = stepDirectionRef.current;

  // First-run mobile landing. Only rendered in the mobile branch (the
  // desktop return sits above the welcome check), and only when there's
  // no prior data / deep link (see shouldShowWelcome). "Get started"
  // persists the flag and drops the user into Step 1 (already the default).
  const [showWelcome, setShowWelcome] = useState(() => shouldShowWelcome());
  // Drives the landing's fade/slide-out. We keep MobileWelcome mounted
  // (as an overlay over the live app) through the exit transition, then
  // unmount via a timeout – a cross-fade hand-off instead of a hard cut.
  const [welcomeExiting, setWelcomeExiting] = useState(false);
  function startFromWelcome() {
    try {
      localStorage.setItem(WELCOME_SEEN_KEY, "1");
    } catch {
      // Persisting the flag is best-effort; the worst case is the welcome
      // re-shows next visit, which is harmless.
    }
    setWelcomeExiting(true);
    // Matches the .mobile-welcome slide-up duration (460ms) + a hair.
    // A timeout (rather than transitionend) guarantees unmount even with
    // prefers-reduced-motion / no transition.
    window.setTimeout(() => setShowWelcome(false), 500);
  }
  // Re-show the landing on demand (brand/logo tap, mobile). Non-destructive
  // – it just re-covers the live app; "Get started" returns the user to
  // wherever they were, data intact. Clear the exiting flag so it renders
  // visible rather than mid-fade-out.
  function showLanding() {
    setWelcomeExiting(false);
    setShowWelcome(true);
  }

  useEffect(() => {
    let cancelled = false;

    // The worker owns the heavy data work: it fetches + parses the
    // 3.2MB dataset (off the main thread, so reloads don't freeze)
    // AND computes the ~419 ProgrammeResults from grades in the
    // background (so step-1 grade entry stays reactive – the compute
    // never touches the main thread). It posts back:
    //  - `loaded`: the raw programmes (UI needs them for the
    //    institution filter + slot picker), and we kick off the
    //    first compute.
    //  - `computed`: slim results (no programme object) tagged with a
    //    request token; we drop stale tokens and re-attach each
    //    programme by code.
    const worker = new Worker(new URL("./lib/dataWorker.ts", import.meta.url), { type: "module" });
    workerRef.current = worker;

    worker.onmessage = (event: MessageEvent<WorkerResponse>) => {
      if (cancelled) return;
      const msg = event.data;
      if (msg.type === "loaded") {
        setProgrammes(msg.programmes);
        setDataLoaded(true);
      } else if (msg.type === "computed") {
        // Ignore results from a superseded grades snapshot.
        if (msg.token !== computeTokenRef.current) return;
        const byCode = programmesByCodeRef.current;
        const joined: ProgrammeResult[] = [];
        for (const slim of msg.results) {
          const programme = byCode.get(slim.code);
          if (programme) joined.push({ ...slim, programme });
        }
        setAllResults(joined);
      } else if (msg.type === "error") {
        setLoadError(msg.message);
      }
    };
    worker.onerror = (event) => {
      if (!cancelled) setLoadError(event.message || t("app.loadFailed"));
    };
    worker.postMessage({ type: "load", dataUrl: DATA_URL, versionUrl: VERSION_URL });

    return () => {
      cancelled = true;
      worker.terminate();
      workerRef.current = null;
    };
  }, []);

  useEffect(() => {
    // Recipient (preview) mode: don't touch localStorage or URL. The URL
    // is a received share that shouldn't be rewritten, and the local
    // profile list shouldn't be mutated by just viewing a share.
    if (sharedViewActive) return;
    try {
      localStorage.setItem("jupas-staging-profiles", JSON.stringify(profiles));
      localStorage.setItem("jupas-staging-active-profile-id", activeProfileId);
    } catch {
      // Keep the session usable even when storage is blocked.
    }
    if (shareViewMode) {
      // Own-share view: keep the URL pointed at the *currently displayed*
      // profile's share URL so switching profiles via the switcher keeps
      // the URL in sync with what's on screen.
      buildShareUrl(
        activeProfile.grades,
        activeProfile.pickedCodes ?? [],
        false,
        activeProfile.name,
        shareViewMode,
      ).then((url) => {
        // Preserve history.state so a back-nav sentinel marker on the current
        // entry survives this URL re-write (see the mobile back-button trap).
        window.history.replaceState(window.history.state, "", url);
      });
    } else {
      writeHashState(activeProfile.grades, activeProfile.pickedCodes ?? [], activeProfile.name);
    }
  }, [profiles, activeProfileId, shareViewMode, sharedViewActive, activeProfile]);

  async function enterShareMode(mode: ShareMode = "advisor"): Promise<string> {
    // Always shares the active local profile (not the preview – exiting
    // and re-entering preview is a re-share of the original URL).
    const url = await buildShareUrl(
      activeProfile.grades,
      activeProfile.pickedCodes ?? [],
      false,
      activeProfile.name,
      mode,
    );
    window.history.pushState({ jcOwn: true }, "", url);
    inShareRef.current = true; // race-free: set here, not via render
    setShareViewMode(mode);
    return url;
  }

  // Desktop Advisor Console: the analysis is already the default view, so the
  // old "Analyse plan" takeover is redundant. Instead build the advisor share
  // URL and copy it to the clipboard (no history push, no view change).
  async function copyAdvisorLink(): Promise<string> {
    const url = await buildShareUrl(
      activeProfile.grades,
      activeProfile.pickedCodes ?? [],
      false,
      activeProfile.name,
      "advisor",
    );
    try {
      if (navigator.clipboard?.writeText) await navigator.clipboard.writeText(url);
    } catch {
      // best-effort; the URL is still returned for any caller that wants it
    }
    return url;
  }

  function exitShareMode() {
    inShareRef.current = false;
    setShareViewMode(null);
    // Keep `previewProfile` alive so the user lands in the calculator
    // still in view mode (banner + FAB visible). Only the explicit
    // Discard / Save actions in the banner drop the preview – without
    // this, stepping out of the share landing would silently strand
    // the user in their own profile and lose the shared plan.
  }

  // Animated exit used by the Back button on the Analysis/Share page:
  // play the slide-out, then actually leave. (openProgrammeDetail keeps
  // the instant exitShareMode so a card tap jumps straight to the detail.)
  function exitShareModeAnimated() {
    if (shareViewExiting) return;
    setShareViewExiting(true);
    window.setTimeout(() => {
      setShareViewExiting(false);
      exitShareMode();
    }, 300);
  }

  // Tapping a card in the Analysis view jumps straight to that programme's
  // detail. Step is already 3 (analysis is a Step-3 sub-view), so setStep(3)
  // is a no-op and the "reset to comparison list" effect won't fire – the
  // sub-view swaps from analysis to detail and the DetailPanel opens directly.
  // exitShareMode() is a harmless no-op for the in-flow path (share mode is
  // never entered there) but still drops the standalone desktop page.
  function openProgrammeDetail(code: string) {
    setActiveCode(code);
    setStep(3);
    setMobileDetailDirection("forward");
    setAnalysisOpen(false);
    setMobileDetailOpen(true);
    setDetailFromAnalysis(true); // Back should return to Analysis, not Compare
    exitShareMode();
  }

  // Desktop Advisor Console: open a programme's detail without the mobile
  // step/share side effects of openProgrammeDetail (the console swaps its own
  // main view to "detail"; it must not push history or touch the stepper).
  function selectProgramme(code: string) {
    setActiveCode(code);
  }

  // Open / close the in-flow Analysis sub-view (the "Step 4"). Reached from
  // the Step-3 footer's Analysis button; slides forward over the compare
  // list and back to it, using the same pane animation as compare↔detail.
  function openAnalysis() {
    setMobileDetailDirection("forward");
    setMobileDetailOpen(false);
    setAnalysisOpen(true);
  }
  function closeAnalysis() {
    setMobileDetailDirection("backward");
    setAnalysisOpen(false);
  }

  // "Save as my profile" for a received share — opens the in-app name modal
  // (same component as Rename/New) instead of a browser prompt.
  const [savePreviewOpen, setSavePreviewOpen] = useState(false);

  function savePreviewAsProfile() {
    if (!previewProfile) return;
    setSavePreviewOpen(true);
  }

  // Default name comes from the URL (sender's profile name) when present, so the
  // recipient usually just hits Save to accept.
  const savePreviewDefaultName = previewProfile
    ? uniqueProfileName(
        previewProfile.name && previewProfile.name !== "Shared plan" && previewProfile.name !== "URL preview"
          ? previewProfile.name
          : "Imported plan",
      )
    : "";

  function commitSavePreview(rawName: string) {
    if (!previewProfile) return;
    const name = uniqueProfileName(rawName.trim() || savePreviewDefaultName || "Imported plan");
    const newId = `profile-${Date.now()}`;
    const newProfile: Profile = {
      id: newId,
      name,
      grades: previewProfile.grades,
      pickedCodes: previewProfile.pickedCodes,
    };
    setProfiles((prev) => [...prev, newProfile]);
    setActiveProfileId(newId);
    setPreviewProfile(null);
    setShareViewMode(null);
    setSavePreviewOpen(false);
  }

  // The save-as-profile dialog overlay. Defined once here so it renders over BOTH
  // the share/analysis views AND the calculator's View-mode banner (which also
  // triggers savePreviewAsProfile).
  const savePreviewModal = savePreviewOpen ? (
    <NameModal
      title={t("share.saveAsProfile")}
      initialName={savePreviewDefaultName}
      onSave={commitSavePreview}
      onClose={() => setSavePreviewOpen(false)}
    />
  ) : null;

  function discardPreview() {
    // Throw away the pasted URL state and return to the user's saved
    // active profile. The localStorage effect will rewrite the URL to
    // the active profile's calc URL on the next render.
    setPreviewProfile(null);
    setShareViewMode(null);
  }

  useEffect(() => {
    document.documentElement.dataset.theme = theme;
    try {
      localStorage.setItem("jupas-staging-theme", theme);
    } catch {
      // Best effort only.
    }
  }, [theme]);

  useEffect(() => {
    if (pickedCodes.length === 0 && selectedOnly) setSelectedOnly(false);
  }, [pickedCodes.length, selectedOnly]);

  // Re-arm the UQ notice whenever the band filter moves off "above-uq".
  useEffect(() => {
    if (filters.band !== "above-uq") setUqNoticeDismissed(false);
  }, [filters.band]);

  // Reset the mobile step-3 view to the comparison list every time the
  // user (re-)enters step 3. Placed here, with the other unconditional
  // hooks, so it runs on every render – putting it later in the
  // component body would sit AFTER the early returns for ShareView /
  // loadError / loading state and trip a hooks-order violation.
  // Only reset on a real TRANSITION into step 3 (prev step was not 3) — not on
  // mount. This keeps a refresh that restores step 3 + its detail/analysis
  // sub-view (INITIAL_NAV) intact, and is StrictMode-safe (the prev ref is
  // updated each run, so the dev double-invoke sees no transition).
  const step3ResetPrevRef = useRef<number | null>(null);
  useEffect(() => {
    const prev = step3ResetPrevRef.current;
    step3ResetPrevRef.current = step;
    if (prev !== null && prev !== 3 && step === 3) {
      setMobileDetailOpen(false);
      setAnalysisOpen(false);
      setDetailFromAnalysis(false);
    }
  }, [step]);

  // Reset the "first compare/detail render" guard whenever the user
  // leaves Step 3 so re-entering plays the step-level slide cleanly
  // without the inner pane double-animating.
  // Every step (and every Step-3 sub-view: compare / detail / analysis) opens
  // at the top, killing the cross-tab scroll bleed. The scroll container is
  // .app-shell — NOT the window (html/body are overflow:hidden on mobile) — so
  // a window.scrollTo here is a no-op; we reset the shell directly.
  //
  // "The top" means the progress (stepper) bar pinned flush at the very top.
  // The JUPASCal header above it is secondary chrome, so we normally tuck it
  // just out of view (scroll past exactly its height). BUT we preserve the
  // header's reveal state across tabs: if you're leaving a tab scrolled all the
  // way up (header showing), the next tab keeps it showing; otherwise it stays
  // tucked. We read el.scrollTop first because, until we write it, it still
  // holds the scroll position of the tab being left.
  //
  // useLayoutEffect runs before paint and a direct scrollTop assignment is
  // instant (scroll-behavior is forced auto), so there's no flash.
  //
  // Going FORWARD a view opens at the top (preserving the header-reveal state).
  // Going BACK restores the scroll you left that view at — so detail→compare or
  // step-3→step-2 returns you where you were, not to the top. Per-view scroll is
  // remembered in viewScrollRef, captured here on leave (el.scrollTop still holds
  // the leaving view's position until we overwrite it).
  const viewScrollRef = useRef<Record<string, number>>({});
  // The live scroll of the app-shell, updated synchronously on every scroll. The
  // per-view save below MUST read this (not el.scrollTop): when a view switches
  // to a shorter one, the browser clamps el.scrollTop before this layout effect
  // runs, so reading el.scrollTop would save the clamped position and "back"
  // would land too high.
  const lastScrollRef = useRef<number>(0);
  const layoutPrevStepRef = useRef<number | null>(null);
  const layoutPrevSubRef = useRef<string>("compare");
  useLayoutEffect(() => {
    const el = appShellRef.current;
    if (!el) return;
    const header = el.querySelector<HTMLElement>(".app-topbar");
    const h = header ? header.offsetHeight : 0;

    const prevStep = layoutPrevStepRef.current;
    const prevSub = layoutPrevSubRef.current;
    const prevKey = prevStep === null ? null : prevStep === 3 ? `3:${prevSub}` : `s${prevStep}`;
    const newKey = step === 3 ? `3:${step3SubView}` : `s${step}`;

    if (prevKey && prevKey !== newKey) {
      // Save the leaving view's LAST REAL scroll (lastScrollRef), not el.scrollTop
      // — the new (often shorter) view is already in the DOM and has clamped
      // el.scrollTop, which would lose the real position.
      viewScrollRef.current[prevKey] = lastScrollRef.current;

      // Back = step decreased, or the Step-3 sub-view slid backward.
      const goingBack = prevStep !== step ? step < (prevStep as number) : mobileDetailDirection === "backward";
      const saved = viewScrollRef.current[newKey];
      if (goingBack && typeof saved === "number") {
        el.scrollTop = saved;
      } else {
        const headerWasShowing = lastScrollRef.current < h / 2;
        el.scrollTop = headerWasShowing ? 0 : h;
      }
      // Keep the live ref in sync with what we just set, so a quick follow-up
      // navigation (before any scroll event) saves this view's real position.
      lastScrollRef.current = el.scrollTop;
    }

    layoutPrevStepRef.current = step;
    layoutPrevSubRef.current = step3SubView;
  }, [step, step3SubView]);

  // — Restore-on-refresh —
  // Persist the nav snapshot (step + Step-3 sub-view + open programme + scroll)
  // to sessionStorage; the initial step/sub-view are seeded from INITIAL_NAV in
  // the useState calls above, and the scroll is put back below once content has
  // rendered. navRef holds the latest values so the once-bound scroll/pagehide
  // listeners always serialise fresh state.
  const navRef = useRef<NavSnapshot & { share: boolean }>({ share: false });
  navRef.current = { step, analysisOpen, mobileDetailOpen, detailFromAnalysis, activeCode, share: !!shareViewMode || sharedViewActive };

  function writeNav() {
    const n = navRef.current;
    // Don't clobber the saved calculator position while in a share/preview view.
    if (IS_SHARED_VIEW || n.share) return;
    try {
      sessionStorage.setItem(NAV_KEY, JSON.stringify({
        step: n.step,
        analysisOpen: n.analysisOpen,
        mobileDetailOpen: n.mobileDetailOpen,
        detailFromAnalysis: n.detailFromAnalysis,
        activeCode: n.activeCode,
        scrollTop: appShellRef.current?.scrollTop ?? 0,
      }));
    } catch { /* best-effort */ }
  }

  // Persist immediately on nav changes (so a refresh right after navigating, with
  // no scroll, still lands correctly).
  useEffect(() => { writeNav(); }, [step, analysisOpen, mobileDetailOpen, detailFromAnalysis, activeCode, shareViewMode, sharedViewActive]); // eslint-disable-line react-hooks/exhaustive-deps

  // Persist scroll: capture-phase catches the inner shell scroller; pagehide
  // grabs the final position on refresh/close. rAF-throttled.
  useEffect(() => {
    let raf = 0;
    const onScroll = () => {
      // Track the live position synchronously so the per-view save reads the real
      // scroll even when a view switch later clamps el.scrollTop.
      lastScrollRef.current = appShellRef.current?.scrollTop ?? lastScrollRef.current;
      if (raf) return;
      raf = requestAnimationFrame(() => { raf = 0; writeNav(); });
    };
    window.addEventListener("scroll", onScroll, true);
    window.addEventListener("pagehide", writeNav);
    return () => {
      if (raf) cancelAnimationFrame(raf);
      window.removeEventListener("scroll", onScroll, true);
      window.removeEventListener("pagehide", writeNav);
    };
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  // Put the scroll back once data + content have rendered. The step/sub-view
  // layout effect above forces the top on mount, so this one-shot runs after it.
  const scrollRestoredRef = useRef(false);
  useEffect(() => {
    if (scrollRestoredRef.current || !dataLoaded || IS_SHARED_VIEW) return;
    scrollRestoredRef.current = true;
    const top = INITIAL_NAV.scrollTop ?? 0;
    if (top <= 0) return;
    // The picks/results render a frame or two after `dataLoaded` (separate worker
    // message), so the shell may be too short to scroll at first. Retry across a
    // few frames until the position sticks (content has grown), then stop.
    let tries = 0;
    const tryRestore = () => {
      const el = appShellRef.current;
      if (!el) return;
      el.scrollTop = top;
      if (Math.abs(el.scrollTop - top) > 2 && tries++ < 20) {
        requestAnimationFrame(tryRestore);
      }
    };
    requestAnimationFrame(tryRestore);
  }, [dataLoaded]);

  useEffect(() => {
    if (step !== 3) lastSeenStep3SubRef.current = null;
  }, [step]);

  // After each render in Step 3, remember the current sub-view so the next
  // change can be detected (and animated) – refs don't trigger re-renders,
  // so this is cheap.
  useEffect(() => {
    if (step === 3) lastSeenStep3SubRef.current = step3SubView;
  });

  const institutions = useMemo(() => {
    const byInstitution = new Map<string, number>();
    for (const programme of programmes) {
      const numericCode = Number.parseInt(programme.jupas_code.replace(/\D/g, ""), 10);
      const current = byInstitution.get(programme.institution);
      if (current === undefined || numericCode < current) byInstitution.set(programme.institution, numericCode);
    }
    const sorted = [...byInstitution.entries()].sort((a, b) => a[1] - b[1]).map(([institution]) => institution);
    if (sorted.includes("HKMU") && sorted.includes("SSSDP")) {
      return sorted.filter((i) => i !== "SSSDP").flatMap((i) => i === "HKMU" ? [i, "SSSDP"] : [i]);
    }
    return sorted;
  }, [programmes]);

  const isDesktop = useMediaQuery("(min-width: 921px)");

  // ── Mobile back-button navigation ──────────────────────────────────────
  // In this single-page app the step flow and the Step-3 sub-views (compare /
  // detail / analysis) don't create browser history entries, so a hardware/
  // browser back press would exit the app entirely. We trap it: keep one
  // "sentinel" history entry while there's an in-app back to do, and on
  // popstate walk one level up exactly like the footer Back button. When we
  // reach the root (Step 1) no sentinel is re-armed, so the next back exits.
  //
  // The social ShareView keeps its own pushed entry (enterShareMode) and is
  // handled by the URL-watch effect above; we bail out of the sentinel path
  // while in share mode or on a foreign/pasted URL so the two never collide.
  function goBackInApp(): boolean {
    if (step === 3 && analysisOpen) { closeAnalysis(); return true; }
    if (step === 3 && mobileDetailOpen) {
      if (detailFromAnalysis) {
        setDetailFromAnalysis(false);
        setMobileDetailDirection("backward");
        setMobileDetailOpen(false);
        setAnalysisOpen(true);
        return true;
      }
      setMobileDetailDirection("backward");
      setMobileDetailOpen(false);
      return true;
    }
    if (step > 1) { setStep((step - 1) as 1 | 2 | 3); return true; }
    return false; // already at the root – let the browser leave the app
  }
  // Refs so the once-registered popstate listener always sees current values.
  const goBackRef = useRef(goBackInApp);
  goBackRef.current = goBackInApp;
  const isDesktopRef = useRef(isDesktop);
  isDesktopRef.current = isDesktop;
  const sentinelRef = useRef(false);

  // Arm a single sentinel whenever there's an in-app back to consume. Re-runs
  // on every step / sub-view change, so after each back (which clears the ref)
  // a fresh sentinel is pushed until we're back at the root. Marked jcOwn so
  // both this trap and the URL-watch effect recognise it as our own entry.
  useEffect(() => {
    if (isDesktop) return;
    const backable = step > 1 || analysisOpen || mobileDetailOpen;
    if (backable && !sentinelRef.current) {
      window.history.pushState({ jcOwn: true }, "");
      sentinelRef.current = true;
    }
  }, [isDesktop, step, analysisOpen, mobileDetailOpen]);

  useEffect(() => {
    const onPopNav = (e: PopStateEvent) => {
      // Only act on navigations among our OWN entries. Foreign/pasted URLs land
      // with a null state and are handled by the URL-watch effect (preview).
      if (!(e.state as { jcOwn?: boolean } | null)?.jcOwn) return;
      // Closing our own share view takes priority (works on desktop too).
      // inShareRef is set synchronously in enter/exitShareMode, so it's free of
      // the render race that a React-state read here would have.
      if (inShareRef.current) { exitShareMode(); return; }
      if (isDesktopRef.current) return;             // desktop has no step flow
      sentinelRef.current = false;                  // our sentinel was just consumed
      goBackRef.current();                          // step up one level; the arming effect re-arms
      // The entry we landed on may hold a stale plan (lower entries keep the
      // plan as it was when last current). Re-point its URL at the live profile
      // so a copy/share/reload from here isn't stale. replaceState fires no
      // events and scheduleWrite re-applies the jcOwn marker.
      const ap = activeProfileRef.current;
      writeHashState(ap.grades, ap.pickedCodes ?? [], ap.name);
    };
    window.addEventListener("popstate", onPopNav);
    return () => window.removeEventListener("popstate", onPopNav);
  }, []);

  // allResults is computed in the worker (off the main thread) and
  // arrives via the `computed` message. Holding it as state – rather
  // than a useMemo over grades – is what keeps step-1 grade entry
  // reactive: the 419× score/eligibility/benchmark calc never runs on
  // the main thread, so the grade buttons never block. Seeded empty
  // until the first compute lands.
  const [allResults, setAllResults] = useState<ProgrammeResult[]>(EMPTY_RESULTS);

  // Keep a by-code lookup current for the worker→main join (the
  // worker returns slim results without the heavy programme object).
  // A ref so the worker's onmessage closure always sees the latest
  // map without re-binding the handler.
  const programmesByCodeRef = useRef<Map<string, Programme>>(new Map());
  useEffect(() => {
    programmesByCodeRef.current = new Map(programmes.map((p) => [p.jupas_code, p]));
  }, [programmes]);

  // Ask the worker to recompute whenever the programmes load or the
  // (deferred) grades settle. deferredGrades naturally throttles this
  // to typing pauses; the token lets us discard stale responses.
  useEffect(() => {
    const worker = workerRef.current;
    if (!worker || programmes.length === 0) return;
    const token = ++computeTokenRef.current;
    worker.postMessage({ type: "compute", grades: deferredGrades, token });
  }, [programmes, deferredGrades]);

  const filteredResults = useMemo(() => {
    const selectedSet = new Set(pickedCodes.filter((c): c is string => c !== null));
    const baseResults = selectedOnly
      ? allResults.filter((result) => selectedSet.has(result.programme.jupas_code))
      : filterResults(allResults, filters);
    if (selectedOnly && filters.query.trim()) {
      return sortResults(filterResults(baseResults, filters), sortKey, sortDirection, deltaMode);
    }
    if (selectedOnly && (filters.institutions.length > 0 || filters.eligibleOnly || filters.band !== "all")) {
      return sortResults(filterResults(baseResults, filters), sortKey, sortDirection, deltaMode);
    }
    return sortResults(baseResults, sortKey, sortDirection, deltaMode);
  }, [allResults, filters, pickedCodes, selectedOnly, sortDirection, sortKey, deltaMode]);

  // Defer the heavy filtered list – ResultsView renders ~864 row
  // elements (table + cards across desktop/mobile) per result, so
  // a fresh `filteredResults` array triggers a synchronous render
  // pass that can take seconds on mid-range mobile. Wrapping in
  // useDeferredValue keeps the filter pill toggle visually instant
  // (filters state updates immediately) while React reconciles the
  // list at low priority – the UI feels responsive even though the
  // rows still take their time.
  const deferredFilteredResults = useDeferredValue(filteredResults);

  const pickedResults = useMemo(() => {
    const byCode = new Map(allResults.map((r) => [r.programme.jupas_code, r]));
    return pickedCodes.map((code) => {
      if (code === null) return null;
      return byCode.get(code) || null;
    });
  }, [allResults, pickedCodes]);

  const activeResult = useMemo(() => {
    const firstNonNull = pickedResults.find((r): r is ProgrammeResult => r !== null);
    return pickedResults.find((r): r is ProgrammeResult => r !== null && r.programme.jupas_code === activeCode) || firstNonNull;
  }, [activeCode, pickedResults]);

  // The recommended "safer options" for the student's risky Band-A picks. Used
  // both for the in-analysis suggestions block and — when one is opened — to turn
  // the detail view into a recommendations-only pager (the list swipes through
  // the recommendations, not the student's picks).
  const alternatives = useMemo(
    () => suggestAlternatives(pickedResults, allResults),
    [pickedResults, allResults],
  );
  const activeSuggestion = useMemo(
    () => alternatives.suggestions.find((s) => s.result.programme.jupas_code === activeCode) ?? null,
    [alternatives, activeCode],
  );
  // Recommendation results in suggestion order + a code→backed-up-slot map, so
  // the detail panel can label each ("Backup for A2") and hide plan-only chrome.
  const suggestionResults = useMemo(
    () => alternatives.suggestions.map((s) => s.result),
    [alternatives],
  );
  const suggestionSlotByCode = useMemo(() => {
    const map: Record<string, string> = {};
    for (const s of alternatives.suggestions) map[s.result.programme.jupas_code] = s.forSlot;
    return map;
  }, [alternatives]);
  // code → the 0-based slot index it backs up, so the detail panel's "Swap"
  // action (which only knows the code) can target the right slot.
  const suggestionSlotIndexByCode = useMemo(() => {
    const map: Record<string, number> = {};
    for (const s of alternatives.suggestions) map[s.result.programme.jupas_code] = s.forSlotIndex;
    return map;
  }, [alternatives]);

  // When the active programme is a SUGGESTION not in the plan (e.g. a clicked
  // "Safer option"), include it in the detail panel's results so its OWN detail
  // shows instead of falling back to the first pick. Flagged as a preview so the
  // panel renders it as "Suggested / not in your plan", not a plan slot.
  const previewResult = useMemo(() => {
    if (!activeCode || pickedCodes.includes(activeCode)) return null;
    return allResults.find((r) => r.programme.jupas_code === activeCode) || null;
  }, [activeCode, pickedCodes, allResults]);
  // Opening a recommendation → the detail pager lists the WHOLE recommendation
  // set (so the student can swipe through the safer options). Opening any other
  // non-pick programme (e.g. from Browse) keeps the legacy picks + this-one view.
  const detailResults = useMemo(
    () => {
      if (activeSuggestion) return suggestionResults;
      return previewResult ? [...pickedResults, previewResult] : pickedResults;
    },
    [activeSuggestion, suggestionResults, previewResult, pickedResults],
  );
  const previewCode = previewResult?.programme.jupas_code;

  function setGrades(nextGrades: StudentGrades) {
    if (sharedViewActive) {
      setPreviewProfile((prev) => (prev ? { ...prev, grades: nextGrades } : prev));
      return;
    }
    setProfiles((prev) =>
      prev.map((p) => (p.id === activeProfileId ? { ...p, grades: nextGrades } : p))
    );
  }

  function uniqueProfileName(desired: string, ignoreId?: string): string {
    const taken = new Set(
      profiles.filter((p) => p.id !== ignoreId).map((p) => p.name.trim().toLowerCase()),
    );
    const base = desired.trim().slice(0, MAX_PROFILE_NAME).trim();
    if (!taken.has(base.toLowerCase())) return base;
    let n = 2;
    while (taken.has(`${base} (${n})`.toLowerCase())) n++;
    return `${base} (${n})`;
  }

  // Name comes from the in-app profile modal (ProfileChip); kept unique here.
  function addProfile(rawName: string) {
    const name = uniqueProfileName(rawName.trim() || `${t("profile.defaultName")} ${profiles.length + 1}`);
    const id = `profile-${Date.now()}`;
    const newProfile: Profile = { id, name, grades: {}, pickedCodes: [] };
    setProfiles((prev) => [...prev, newProfile]);
    setActiveProfileId(id);
    setStep(1);
  }

  function renameProfile(id: string, name: string) {
    const cleaned = name.trim();
    if (!cleaned) return; // Reject empty rename – preserves existing name.
    const unique = uniqueProfileName(cleaned, id);
    setProfiles((prev) => prev.map((p) => (p.id === id ? { ...p, name: unique } : p)));
  }

  function deleteProfile(id: string) {
    if (profiles.length <= 1) return;
    const nextProfiles = profiles.filter((p) => p.id !== id);
    setProfiles(nextProfiles);
    if (activeProfileId === id) setActiveProfileId(nextProfiles[0].id);
  }

  function resetAllData() {
    // Wipe everything user-personal. The programme dataset isn't in
    // localStorage anymore (the worker fetches it through the HTTP
    // cache), and theme is kept since it isn't profile data. Reload
    // to a clean app state.
    localStorage.removeItem("jupas-staging-profiles");
    localStorage.removeItem("jupas-staging-active-profile-id");
    localStorage.removeItem("jupas-staging-grades"); // legacy pre-multi-profile key
    try { sessionStorage.removeItem(NAV_KEY); } catch { /* best-effort */ } // don't restore into a wiped state
    window.location.href = window.location.origin + window.location.pathname;
  }

  function reviewSelectedProgrammes() {
    const nonNullResults = pickedResults.filter((r): r is ProgrammeResult => r !== null);
    if (!nonNullResults.length) return;
    const firstCode = pickedCodes.find((c) => c !== null);
    if (firstCode) setActiveCode(firstCode);
    setProgrammeFiltersOpen(false);
    setStep(3);
    setReviewRequest((c) => c + 1);
  }

  function resetSelectedProgrammes() {
    setPickedCodes([]);
    setActiveCode(undefined);
    setSelectedOnly(false);
    setProgrammeFiltersOpen(true);
  }

  function pickProgramme(code: string) {
    setPickedCodes((current) => {
      if (current.includes(code)) return current;
      const firstNullIndex = current.indexOf(null);
      if (firstNullIndex !== -1) {
        const next = [...current];
        next[firstNullIndex] = code;
        return next;
      }
      return [...current, code];
    });
    setActiveCode(code);
  }

  function setSlotCode(slotIndex: number, code: string) {
    const trimmed = code.trim().toUpperCase();
    if (!trimmed) return;
    setPickedCodes((current) => {
      // If this code is already in another slot, do nothing (avoid duplicates).
      const existingIndex = current.indexOf(trimmed);
      if (existingIndex !== -1 && existingIndex !== slotIndex) return current;
      const next = [...current];
      while (next.length <= slotIndex) next.push(null);
      next[slotIndex] = trimmed;
      return next;
    });
    setActiveCode(trimmed);
  }

  function handleNext() {
    const nonNullCount = pickedCodes.filter((c) => c !== null).length;
    if (step === 2 && nonNullCount > 0) {
      reviewSelectedProgrammes();
    } else if (step < 3) {
      setStep((step + 1) as 2 | 3);
    }
  }

  // View mode = previewing a pasted share URL. While active, edits are
  // gated so the user can't silently mutate the preview profile (it
  // would feel editable but never persist). The banner's Save/Discard
  // actions are the only paths out.
  const readOnly = sharedViewActive;

  function reorderPickedCodes(fromIndex: number, toIndex: number) {
    setPickedCodes((current) => {
      const padded = [...current];
      const maxIndex = Math.max(fromIndex, toIndex);
      while (padded.length <= maxIndex) padded.push(null);
      const [moved] = padded.splice(fromIndex, 1);
      padded.splice(toIndex, 0, moved ?? null);
      return trimTrailingNulls(padded);
    });
  }

  // Swap two picks (used by the tap-a-slot picker). Unlike reorder/drag — which
  // shifts everything between the two positions — this exchanges just the two
  // slots, so "send A2 to B5" lands A2's pick at B5 and B5's pick at A2.
  function swapPickedCodes(a: number, b: number) {
    if (a === b) return;
    setPickedCodes((current) => {
      const padded = [...current];
      const maxIndex = Math.max(a, b);
      while (padded.length <= maxIndex) padded.push(null);
      [padded[a], padded[b]] = [padded[b], padded[a]];
      return trimTrailingNulls(padded);
    });
  }

  function removePickedCode(code: string) {
    setPickedCodes((current) => {
      const index = current.indexOf(code);
      if (index === -1) return current;
      const next = [...current];
      next[index] = null;
      return trimTrailingNulls(next);
    });
    if (activeCode === code) {
      const nextVal = pickedCodes.filter((c) => c !== null).find((item) => item !== code);
      setActiveCode(nextVal || undefined);
    }
  }

  // Drop an empty slot from the pickedCodes array entirely (vs
  // removePickedCode which only nulls a slot out). Used by the × on
  // Step 3 mobile empty rows so the user can collapse a leading gap
  // – e.g. removed A1/A2/A3 picks leaving [null,null,null,B1,B2,B3]
  // can be compacted to [B1,B2,B3] so B1 becomes the new A1.
  function removePickedSlot(index: number) {
    setPickedCodes((current) => {
      if (index < 0 || index >= current.length) return current;
      const next = [...current];
      next.splice(index, 1);
      return trimTrailingNulls(next);
    });
  }

  // On desktop, a received/owned ADVISOR share opens inside the Advisor Console
  // (the isDesktop branch below reads displayProfile + readOnly), so it must NOT
  // take over as a full page here. Social shares stay a full page everywhere;
  // advisor shares stay a full page on mobile.
  if (
    shareViewMode &&
    programmes.length > 0 &&
    pickedCount > 0 &&
    (shareViewMode === "social" || !isDesktop)
  ) {
    const sharePageProps = {
      mode: shareViewMode,
      profileName: displayProfile.name,
      results: pickedResults,
      grades: displayProfile.grades,
      profiles: sharedViewActive ? undefined : profiles,
      activeProfileId: sharedViewActive ? undefined : activeProfileId,
      onProfileChange: sharedViewActive ? undefined : setActiveProfileId,
      onRename: sharedViewActive ? undefined : (name: string) => renameProfile(activeProfileId, name),
      // "Edit Profile" (top-bar pill) → grade selection of the current profile.
      onEditProfile: sharedViewActive ? undefined : () => { setStep(1); exitShareMode(); },
      onExitShareMode: exitShareModeAnimated,
      exiting: shareViewExiting,
      isReceivedShare: sharedViewActive,
      onSaveAsProfile: sharedViewActive ? savePreviewAsProfile : undefined,
      // Owner-only: builds a "Share with Teacher / Advisor" link (advisor mode)
      // that opens the analysis dashboard when the recipient opens it.
      onBuildAdvisorUrl: sharedViewActive
        ? undefined
        : () => buildShareUrl(activeProfile.grades, activeProfile.pickedCodes ?? [], false, activeProfile.name, "advisor"),
      // Switch the social recap → advisor analysis for the same plan (works for
      // both an owned share and a received one — displayProfile drives both, and
      // the owner's URL re-syncs via the shareViewMode effect).
      onViewAnalysis: () => setShareViewMode("advisor"),
      theme,
      onThemeChange: setTheme,
    };
    // Advisor mode → the portfolio analysis dashboard, for BOTH the user's own
    // "Analysis" button AND a teacher/advisor who opens a "Share with Teacher /
    // Advisor" link (received). Social mode stays on the recap-card ShareView.
    if (shareViewMode === "advisor") {
      return (
        <>
          <AnalysisView
            {...sharePageProps}
            onOpenDetail={openProgrammeDetail}
            onShare={() => enterShareMode("social")}
            pickedCount={pickedCount}
            onGoToStep={(s) => { setStep(s); exitShareMode(); }}
          />
          {savePreviewModal}
        </>
      );
    }
    return (
      <>
        <ShareView {...sharePageProps} />
        {savePreviewModal}
      </>
    );
  }

  if (loadError) {
    return (
      <main className="app-shell">
        <section className="panel error-panel">
          <h1>{t("app.loadError.title")}</h1>
          <p>{loadError}</p>
          <p>{t("app.loadError.expected")} <code>{DATA_URL}</code></p>
        </section>
      </main>
    );
  }

  if (shareViewMode && !dataLoaded) {
    return (
      <main className="share-view">
        <AppHeader />
        <section className="panel share-profile-card">
          <div>
            <p className="eyebrow">{t("app.sharedResults")}</p>
            <strong>{t("app.loadingProfile")}</strong>
          </div>
        </section>
      </main>
    );
  }

  const nextLabel =
    step === 1 ? t("app.next.selectProgrammes") :
    step === 2 && pickedCount > 0 ? t("app.next.review", { n: pickedCount }) :
    t("app.next.programmeDetail");

  // On mobile Step 3 the Back button does double duty: when the
  // detail panel is open it returns to the comparison list (instead
  // of the previous "back to step 2" behaviour); otherwise it
  // decrements the step like elsewhere.
  const backLabel =
    step === 2 ? t("app.back.editGrades") :
    step === 3 && analysisOpen ? t("app.back.compare") :
    step === 3 && mobileDetailOpen ? (detailFromAnalysis ? t("app.back.analysis") : t("app.back.compare")) :
    step === 3 ? t("app.back.programme") :
    null;

  const showProgrammeLoading = step === 2 && !dataLoaded;
  const canShare = pickedCount > 0;

  // Advisor Console renders its own PreferencePlanner; the share buttons it
  // hosts in the plan footer. "Analyse plan" is repurposed to "Copy advisor
  // link" (analysis is already the console's default view).
  const desktopShareButtons = canShare && !readOnly ? (
    <>
      <ShareButton
        onShare={copyAdvisorLink}
        label={t("app.btn.copyAdvisorLink")}
        title={t("app.btn.copyAdvisorLinkTitle")}
      />
      <ShareButton
        onShare={() => enterShareMode("social")}
        label={t("app.btn.shareFriends")}
        title={t("app.btn.shareFriendsTitle")}
      />
    </>
  ) : null;

  const mobilePlannerNode = (
    <PreferenceLine
      results={pickedResults}
      activeCode={activeResult?.programme.jupas_code}
      onReorder={reorderPickedCodes}
      onSwap={swapPickedCodes}
      onRemove={removePickedCode}
      readOnly={readOnly}
    />
  );

  const programmePicker = showProgrammeLoading ? (
    // Clean placeholder mirroring the Step 3 empty-state panel
    // (.desktop-empty-detail): correct "Step 2" eyebrow + heading + a
    // single muted line, no off-brand animated loading bars.
    <section className="panel desktop-empty-detail" aria-live="polite" aria-busy="true">
      <p className="eyebrow">{t("filters.eyebrow")}</p>
      <h2>{t("filters.title")}</h2>
      <p>{t("app.loading.text")}</p>
    </section>
  ) : (
    <section className="panel step2-panel" aria-label={t("app.comparisonAria")}>
      <FiltersBar
        filters={filters}
        open={programmeFiltersOpen}
        institutions={institutions}
        total={allResults.length}
        shown={filteredResults.length}
        selectedCount={pickedCount}
        selectedOnly={selectedOnly}
        compactResults={compactResults}
        deltaMode={deltaMode}
        sortKey={sortKey}
        sortDirection={sortDirection}
        showStepEyebrow={!isDesktop}
        onFiltersChange={setFilters}
        onOpenChange={setProgrammeFiltersOpen}
        onSelectedOnlyChange={setSelectedOnly}
        onCompactResultsChange={setCompactResults}
        onDeltaModeChange={setDeltaMode}
        onSortChange={(nextSortKey) => {
          if (nextSortKey === sortKey) {
            setSortDirection(sortDirection === "asc" ? "desc" : "asc");
            return;
          }
          setSortKey(nextSortKey);
          setSortDirection(nextSortKey === "code" || nextSortKey === "name" || nextSortKey === "institution" ? "asc" : "desc");
        }}
        onReviewSelected={reviewSelectedProgrammes}
        onResetSelected={resetSelectedProgrammes}
        selectedOrder={isDesktop ? undefined : mobilePlannerNode}
      />
      <ResultsView
        results={deferredFilteredResults}
        selectedCodes={pickedCodes.filter((c): c is string => c !== null)}
        activeCode={activeResult?.programme.jupas_code}
        compact={compactResults}
        deltaMode={deltaMode}
        readOnly={readOnly}
        onFocus={(code) => setActiveCode(code)}
        onPick={pickProgramme}
        onUnpick={(code) => {
          setPickedCodes((current) => {
            const index = current.indexOf(code);
            if (index === -1) return current;
            const next = [...current];
            next[index] = null;
            
            return trimTrailingNulls(next);
          });
          if (activeCode === code) {
            const nextVal = pickedCodes.filter(c => c !== null).find((item) => item !== code);
            setActiveCode(nextVal || undefined);
          }
        }}
        sortKey={sortKey}
        sortDirection={sortDirection}
        onSortChange={(nextSortKey) => {
          if (nextSortKey === sortKey) {
            setSortDirection(sortDirection === "asc" ? "desc" : "asc");
            return;
          }
          setSortKey(nextSortKey);
          setSortDirection(nextSortKey === "code" || nextSortKey === "name" || nextSortKey === "institution" ? "asc" : "desc");
        }}
      />
    </section>
  );

  const header = (
    <AppHeader
      theme={theme}
      onThemeChange={setTheme}
      onBrandClick={isDesktop ? undefined : showLanding}
      profiles={profiles}
      activeProfileId={activeProfileId}
      onProfileSelect={setActiveProfileId}
      onProfileAdd={addProfile}
      onProfileRename={renameProfile}
      onProfileDelete={deleteProfile}
      onResetAll={resetAllData}
    />
  );

  const detailPanelNode = pickedCount > 0 ? (
    <DetailPanel
      results={detailResults}
      activeCode={activeCode}
      previewCode={previewCode}
      suggestionSlots={activeSuggestion ? suggestionSlotByCode : undefined}
      reviewRequest={reviewRequest}
      onActiveCodeChange={setActiveCode}
      onRemove={removePickedCode}
      readOnly={readOnly}
      // Desktop console has no mobile-style footer, so the recommendation
      // Add/Swap actions live inside the detail panel itself.
      onAddToPlan={pickProgramme}
      onSwapToSlot={(code) => {
        const idx = suggestionSlotIndexByCode[code];
        if (idx != null) setSlotCode(idx, code);
      }}
    />
  ) : null;

  // Mobile step-3 content. Default: the comparison list of all picks
  // with mini bench-bars. Tap a row → open DetailPanel with a back
  // button that returns here. The "reset on enter" useEffect lives
  // higher in the component body (above the early returns) so it
  // doesn't trip a hooks-order violation.
  const mobileDetailNode = pickedCount > 0
    ? (
      <div
        key={step3SubView}
        className={`mobile-step3-pane ${shouldAnimateMobileDetail ? `vt-${mobileDetailDirection}` : "vt-no-anim"}`}
      >
        {analysisOpen ? (
          // The in-flow Analysis "Step 4": same content as the standalone
          // page, minus its chrome (the flow header/stepper/footer wrap it).
          <AnalysisBody
            variant="inline"
            profileName={displayProfile.name}
            results={pickedResults}
            grades={displayProfile.grades}
            profiles={sharedViewActive ? undefined : profiles}
            activeProfileId={sharedViewActive ? undefined : activeProfileId}
            onProfileChange={sharedViewActive ? undefined : setActiveProfileId}
            onRename={sharedViewActive ? undefined : (name: string) => renameProfile(activeProfileId, name)}
            isReceivedShare={sharedViewActive}
            onOpenDetail={openProgrammeDetail}
            onEdit={closeAnalysis}
            alternativesSlot={
              <AlternativeSuggestions
                results={pickedResults}
                allResults={allResults}
                onAdd={pickProgramme}
                onSwap={setSlotCode}
                onOpenDetail={openProgrammeDetail}
                readOnly={readOnly}
                collapsible
              />
            }
          />
        ) : mobileDetailOpen ? (
          <DetailPanel
            results={detailResults}
            activeCode={activeCode}
            previewCode={previewCode}
            suggestionSlots={activeSuggestion ? suggestionSlotByCode : undefined}
            reviewRequest={reviewRequest}
            onActiveCodeChange={setActiveCode}
            onRemove={removePickedCode}
            readOnly={readOnly}
          />
        ) : (
          <MobileComparison
            results={pickedResults}
            grades={displayProfile.grades}
            onOpenDetail={(code) => {
              setActiveCode(code);
              setMobileDetailDirection("forward");
              setMobileDetailOpen(true);
              setDetailFromAnalysis(false); // opened from Compare → Back returns to Compare
            }}
            onAddMore={() => setStep(2)}
            onReorder={reorderPickedCodes}
            onSwap={swapPickedCodes}
            onRemoveSlot={removePickedSlot}
            onRemove={removePickedCode}
            readOnly={readOnly}
          />
        )}
      </div>
    )
    : (
      <aside className="panel desktop-empty-detail">
        <p className="eyebrow">{t("app.drawer.eyebrow")}</p>
        <h2>{t("app.drawer.title")}</h2>
        <p>{t("app.drawer.text")}</p>
      </aside>
    );


  // Always-mounted banner + FAB. Inactive one fades + morphs to the
  // other shape via CSS transitions – no React mount delay.
  // `inert` (React 19) is used instead of aria-hidden: it removes the
  // element from the a11y tree AND auto-moves focus out of itself,
  // which dodges the aria-hidden-with-focused-descendant warning we
  // were hitting when users clicked Hide/View-mode (focus would still
  // be on the clicked button at the moment the class flipped).
  const previewBanner = sharedViewActive && !shareViewMode ? (
    <>
      <div
        className={`preview-banner${previewBannerHidden ? " is-inactive" : ""}`}
        role="status"
        aria-live="polite"
        inert={previewBannerHidden}
      >
        <span className="preview-banner-text">
          <svg className="preview-banner-icon" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
            <path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z" />
            <circle cx="12" cy="12" r="3" />
          </svg>
          {t("app.preview.viewModePre")}<b>{t("app.preview.saveBold")}</b>{t("app.preview.toEdit")}
        </span>
        <div className="preview-banner-actions">
          <button type="button" className="ghost-button" onClick={savePreviewAsProfile}>
            {t("app.preview.saveAsProfile")}
          </button>
          <button type="button" className="ghost-button" onClick={discardPreview}>
            {t("app.preview.discard")}
          </button>
          <button
            type="button"
            className="preview-banner-hide-link"
            onClick={() => setPreviewBannerHidden(true)}
            title={t("app.preview.hideTitle")}
          >
            {t("app.preview.hide")}
          </button>
        </div>
      </div>
      <button
        type="button"
        className={`preview-fab${!previewBannerHidden ? " is-inactive" : ""}`}
        onClick={() => setPreviewBannerHidden(false)}
        aria-label={t("app.preview.fabAria")}
        title={t("app.preview.fabTitle")}
        inert={!previewBannerHidden}
      >
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
          <path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z" />
          <circle cx="12" cy="12" r="3" />
        </svg>
        <span>{t("app.preview.viewMode")}</span>
      </button>
    </>
  ) : null;

  // Floating UQ notice – positioned exactly like the preview/View-mode
  // banner (fixed, bottom-centre) so it can't be scrolled away. Rendered
  // at app-shell level (outside the stepper's transformed panes, which
  // would otherwise break position: fixed). Suppressed while previewing a
  // shared plan so it never collides with the View-mode banner.
  const showUqNotice =
    filters.band === "above-uq" &&
    !uqNoticeDismissed &&
    !uqNoticeHidden &&
    !sharedViewActive &&
    (isDesktop || step === 2);

  const uqNotice = showUqNotice ? (
    <div className="filter-notice" role="note">
      <p className="filter-notice-text">
        <svg className="filter-notice-icon" width="15" height="15" viewBox="0 0 16 16" aria-hidden="true">
          <circle cx="8" cy="8" r="7" fill="none" stroke="currentColor" strokeWidth="1.5" />
          <circle cx="8" cy="4.6" r="0.9" fill="currentColor" />
          <path d="M8 7v5" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
        </svg>
        Only HKU and CUHK publish upper-quartile (UQ) scores, so few programmes match this filter.
      </p>
      <div className="filter-notice-actions">
        <button type="button" className="filter-notice-link is-primary" onClick={dontShowUqNoticeAgain}>
          Don't show again
        </button>
        <button type="button" className="filter-notice-link" onClick={() => setUqNoticeDismissed(true)}>
          Dismiss
        </button>
      </div>
    </div>
  ) : null;

  if (isDesktop) {
    return (
      <main className="app-shell layout-desktop">
        {header}
        {previewBanner}
        {savePreviewModal}
        {uqNotice}

        <AdvisorConsole
          profileName={displayProfile.name}
          profiles={sharedViewActive ? undefined : profiles}
          activeProfileId={sharedViewActive ? undefined : activeProfileId}
          onProfileChange={sharedViewActive ? undefined : setActiveProfileId}
          onRename={sharedViewActive ? undefined : (name: string) => renameProfile(activeProfileId, name)}
          isReceivedShare={sharedViewActive}
          onSaveAsProfile={sharedViewActive ? savePreviewAsProfile : undefined}
          grades={grades}
          onGradesChange={setGrades}
          onGradesReset={() => setGrades({})}
          pickedResults={pickedResults}
          pickedCount={pickedCount}
          activeCode={activeResult?.programme.jupas_code}
          programmes={programmes}
          onActivate={setActiveCode}
          onReorder={reorderPickedCodes}
          onSwap={swapPickedCodes}
          onRemove={removePickedCode}
          onSetSlotCode={setSlotCode}
          shareButtons={desktopShareButtons}
          allResults={allResults}
          onOpenDetail={selectProgramme}
          onAdd={pickProgramme}
          programmePicker={programmePicker}
          detailPanel={detailPanelNode}
          readOnly={readOnly}
        />
      </main>
    );
  }

  return (
    <>
    <main className="app-shell layout-mobile" ref={appShellRef}>
      <div className="glass-veil" aria-hidden="true" />
      {header}
      {previewBanner}
      {savePreviewModal}
      {uqNotice}

      <div className="mobile-stepper-flow">
        <StepperBar step={step} pickedCount={pickedCount} onStepChange={setStep} />

        <div className={`stepper-content vt-${stepDirection}`}>
          <div className={step === 1 ? "stepper-panel active" : "stepper-panel"}>
            <GradeInput grades={grades} onChange={setGrades} onReset={() => setGrades({})} readOnly={readOnly} />
          </div>

          {/* Render heavy panel content ONLY for the active step. The
              inactive panels are display:none (above), but React still
              renders their children otherwise – so the ~419-card Step-2
              ResultsView was reconciling on every Step-1 grade tap,
              causing the per-click lag. Worker compute keeps results
              ready; this just defers the DOM build to step entry. */}
          <div className={step === 2 ? "stepper-panel active" : "stepper-panel"}>
            {step === 2 ? programmePicker : null}
          </div>

          <div className={step === 3 ? "stepper-panel active" : "stepper-panel"}>
            {step === 3 ? mobileDetailNode : null}
          </div>
        </div>

        <footer className="stepper-footer">
          <div className="stepper-footer-left">
            <button
              type="button"
              className="ghost-button"
              disabled={!backLabel}
              onClick={() => {
                // Route through history.back() so the footer Back and the
                // browser/hardware back share one path (popstate → goBackInApp)
                // and the sentinel stays balanced. Fall back to a direct call
                // if no sentinel is armed (shouldn't happen while back-able).
                if (sentinelRef.current) window.history.back();
                else goBackInApp();
              }}
            >
              {t("common.back")}
            </button>
          </div>
          <div className={`stepper-footer-right${step === 3 ? " is-share-mode" : ""}`}>
            {step < 3 ? (
              <button
                type="button"
                className="ghost-button"
                disabled={
                  readOnly ||
                  (step === 1 && Object.keys(grades).length === 0) ||
                  (step === 2 && pickedCount === 0)
                }
                onClick={() => {
                  if (step === 1) setGrades({});
                  if (step === 2) resetSelectedProgrammes();
                }}
              >
                {t("app.footerReset")}
              </button>
            ) : null}
            {step < 3 ? (
              <button
                type="button"
                className="stepper-next-btn"
                onClick={handleNext}
                disabled={step === 2 && pickedCount === 0}
              >
                {nextLabel} <ArrowIcon direction="right" />
              </button>
            ) : pickedCount > 0 && !readOnly ? (
              mobileDetailOpen && activeSuggestion ? (
                // Viewing a recommended safety option (not yet in the plan):
                // Analyse/Share don't apply to a programme that isn't a pick.
                // Offer the two plan actions instead. SWAP replaces the slot it
                // backs up → drop to the plan/comparison view (a plan edit, and
                // not the analysis where these recommendations live). ADD appends
                // it → slide back to the analysis so the new option is in context.
                <>
                  <ShareButton
                    onShare={() => {
                      setSlotCode(activeSuggestion.forSlotIndex, activeSuggestion.result.programme.jupas_code);
                      // State-only nav to the comparison view. The single back
                      // sentinel still covers step 3, so browser Back from here
                      // drops to step 2 as usual; the hash-write effect keeps the
                      // URL fresh after the pick change.
                      setDetailFromAnalysis(false);
                      setMobileDetailDirection("backward");
                      setAnalysisOpen(false);
                      setMobileDetailOpen(false);
                      return Promise.resolve("");
                    }}
                    label={t("suggest.swap", { slot: activeSuggestion.forSlot })}
                    title={t("suggest.swapAria", { code: activeSuggestion.result.programme.jupas_code, slot: activeSuggestion.forSlot })}
                    icon={
                      <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                        <polyline points="17 1 21 5 17 9"/>
                        <path d="M3 11V9a4 4 0 0 1 4-4h14"/>
                        <polyline points="7 23 3 19 7 15"/>
                        <path d="M21 13v2a4 4 0 0 1-4 4H3"/>
                      </svg>
                    }
                  />
                  <ShareButton
                    onShare={() => {
                      pickProgramme(activeSuggestion.result.programme.jupas_code);
                      if (sentinelRef.current) window.history.back(); else goBackInApp();
                      return Promise.resolve("");
                    }}
                    label={t("suggest.add")}
                    title={t("suggest.addAria", { code: activeSuggestion.result.programme.jupas_code, name: pickName(activeSuggestion.result.programme, lang) })}
                    icon={
                      <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                        <line x1="12" y1="5" x2="12" y2="19"/>
                        <line x1="5" y1="12" x2="19" y2="12"/>
                      </svg>
                    }
                  />
                </>
              ) : analysisOpen ? (
                // Already in the Analysis sub-view: only Share remains (Back
                // on the left returns to Compare).
                <ShareButton
                  onShare={() => enterShareMode("social")}
                  label={t("app.btn.share")}
                  title={t("app.btn.shareTitle")}
                />
              ) : (
                <>
                  <ShareButton
                    // Opens the in-flow Analysis sub-view – it slides in like
                    // the next step (no page jump), so there's no URL/link to
                    // copy here; the returned "" is ignored by ShareButton.
                    onShare={() => { openAnalysis(); return Promise.resolve(""); }}
                    label={t("app.btn.analysis")}
                    title={t("app.btn.analysisTitle")}
                    icon={
                      <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                        <line x1="6" y1="20" x2="6" y2="12"/>
                        <line x1="12" y1="20" x2="12" y2="6"/>
                        <line x1="18" y1="20" x2="18" y2="14"/>
                      </svg>
                    }
                  />
                  <ShareButton
                    onShare={() => enterShareMode("social")}
                    label={t("app.btn.share")}
                    title={t("app.btn.shareTitle")}
                  />
                </>
              )
            ) : step === 3 && pickedCount > 0 && readOnly ? (
              // View mode (received share): re-open the advisor analysis for the
              // previewed plan — otherwise the only footer control here is Back.
              <ShareButton
                onShare={() => { setShareViewMode("advisor"); return Promise.resolve(""); }}
                label={t("app.btn.analysis")}
                title={t("app.btn.analysisTitle")}
                icon={
                  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                    <line x1="6" y1="20" x2="6" y2="12"/>
                    <line x1="12" y1="20" x2="12" y2="6"/>
                    <line x1="18" y1="20" x2="18" y2="14"/>
                  </svg>
                }
              />
            ) : null}
          </div>
        </footer>
      </div>
    </main>
    {showWelcome ? (
      <MobileWelcome
        theme={theme}
        onThemeChange={setTheme}
        onStart={startFromWelcome}
        exiting={welcomeExiting}
      />
    ) : null}
    </>
  );
}

function PreferenceLine({
  results,
  activeCode,
  onReorder,
  onSwap,
  onRemove,
  readOnly,
}: {
  results: (ProgrammeResult | null)[];
  activeCode?: string;
  onReorder: (fromIndex: number, toIndex: number) => void;
  onSwap: (a: number, b: number) => void;
  onRemove?: (code: string) => void;
  readOnly?: boolean;
}) {
  const { t, lang } = useLang();
  const pickedTotal = results.filter(Boolean).length;
  // The bar itself is view-only: a horizontally scrollable strip of every pick.
  // Tapping it opens the "Reorganize" sheet — the single place to reorder
  // (drag or tap-a-slot to swap) and remove. No per-pill drag on the bar.
  const [expanded, setExpanded] = useState(false);
  const [moveTarget, setMoveTarget] = useState<{ index: number; rect: DOMRect } | null>(null);
  // Vertical drag-to-reorder inside the reorganize sheet (drag = move/shift,
  // tap-a-slot = swap). Snapshots each card's centre at drag start so target
  // detection survives variable card heights.
  const reorgRefs = useRef<Map<number, HTMLElement>>(new Map());
  type ReorgDrag = {
    fromIndex: number;
    pointerId: number;
    startY: number;
    deltaY: number;
    centers: { index: number; center: number }[];
    draggedHeight: number;
    targetIndex: number;
  };
  const [reorgDrag, setReorgDrag] = useState<ReorgDrag | null>(null);

  function reorgDragStart(index: number, e: ReactPointerEvent<HTMLElement>) {
    if (readOnly || !results[index]) return;
    e.preventDefault();
    e.stopPropagation();
    (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
    const centers: { index: number; center: number }[] = [];
    let draggedHeight = 0;
    for (let i = 0; i < results.length; i++) {
      const el = reorgRefs.current.get(i);
      if (!el) continue;
      const r = el.getBoundingClientRect();
      centers.push({ index: i, center: r.top + r.height / 2 });
      if (i === index) draggedHeight = r.height;
    }
    setReorgDrag({ fromIndex: index, pointerId: e.pointerId, startY: e.clientY, deltaY: 0, centers, draggedHeight, targetIndex: index });
  }

  function reorgDragMove(e: ReactPointerEvent<HTMLElement>) {
    if (!reorgDrag || reorgDrag.pointerId !== e.pointerId) return;
    const deltaY = e.clientY - reorgDrag.startY;
    const fromCenter = reorgDrag.centers.find((c) => c.index === reorgDrag.fromIndex)?.center ?? 0;
    const cur = fromCenter + deltaY;
    let targetIndex = reorgDrag.fromIndex;
    let best = Infinity;
    for (const c of reorgDrag.centers) {
      const d = Math.abs(c.center - cur);
      if (d < best) { best = d; targetIndex = c.index; }
    }
    setReorgDrag({ ...reorgDrag, deltaY, targetIndex });
  }

  function reorgDragEnd(e: ReactPointerEvent<HTMLElement>) {
    if (!reorgDrag || reorgDrag.pointerId !== e.pointerId) return;
    const { fromIndex, targetIndex } = reorgDrag;
    setReorgDrag(null);
    if (targetIndex !== fromIndex) onReorder(fromIndex, targetIndex);
  }

  function reorgTransform(i: number): string | undefined {
    if (!reorgDrag) return undefined;
    const { fromIndex, targetIndex, deltaY, draggedHeight } = reorgDrag;
    if (i === fromIndex) return `translateY(${deltaY}px)`;
    const shift = draggedHeight + 8; // 8 = .reorg-grid gap (var(--space-2))
    if (targetIndex > fromIndex && i > fromIndex && i <= targetIndex) return `translateY(-${shift}px)`;
    if (targetIndex < fromIndex && i < fromIndex && i >= targetIndex) return `translateY(${shift}px)`;
    return undefined;
  }

  return (
    <section className={`preference-planner${readOnly ? " is-readonly" : ""}`} aria-label={t("planner.ariaPanel")}>
      <div
        className="preference-bar"
        role={readOnly ? undefined : "button"}
        tabIndex={readOnly ? undefined : 0}
        aria-label={readOnly ? undefined : t("app.expandPlanner")}
        // Tap opens the reorganize sheet; a horizontal swipe scrolls the strip
        // inside (touch scroll doesn't synthesize a click, so the two don't
        // clash). Disabled in read-only (shared) view.
        onClick={readOnly ? undefined : () => setExpanded(true)}
        onKeyDown={readOnly ? undefined : (e) => {
          if (e.key === "Enter" || e.key === " ") { e.preventDefault(); setExpanded(true); }
        }}
      >
        <span className="preference-line-label">{t("app.selectedLabel")}</span>
        <div className="preference-line" aria-label={t("app.selectedOrderAria")}>
          {pickedTotal === 0 ? <span className="preference-empty">{t("app.none")}</span> : null}
          {results.map((result, index) => {
            if (!result) {
              return (
                <span key={index} className="preference-text preference-empty-slot">
                  {slotLabel(index)}·---
                </span>
              );
            }
            const code = result.programme.jupas_code;
            const active = code === activeCode;
            return (
              <span key={index} className={`preference-text ${active ? "active" : "filled"}`}>
                {slotLabel(index)}·{code}
              </span>
            );
          })}
        </div>
        {!readOnly && pickedTotal > 0 ? (
          <span className="preference-bar-expand" aria-hidden="true">
            <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <polyline points="15 3 21 3 21 9" />
              <polyline points="9 21 3 21 3 15" />
              <line x1="21" y1="3" x2="14" y2="10" />
              <line x1="3" y1="21" x2="10" y2="14" />
            </svg>
          </span>
        ) : null}
      </div>

      {expanded ? createPortal(
        <div className="reorg-overlay" role="dialog" aria-modal="true" aria-label={t("app.reorganizeAll")}>
          <div className="reorg-backdrop" onPointerDown={() => { setMoveTarget(null); setExpanded(false); }} aria-hidden="true" />
          <div className="reorg-sheet">
            <header className="reorg-head">
              <div className="reorg-head-text">
                <p className="reorg-title">{t("app.reorganizeAll")}</p>
                <p className="reorg-hint">{t("app.reorganizeHint")}</p>
              </div>
              <button type="button" className="reorg-done" onClick={() => { setMoveTarget(null); setExpanded(false); }}>
                {t("app.done")}
              </button>
            </header>
            <ol className="reorg-grid">
              {results.map((result, index) => {
                const label = slotLabel(index);
                const transform = reorgTransform(index);
                const dragging = reorgDrag?.fromIndex === index;
                const liStyle = transform
                  ? { transform, transition: dragging ? "none" : "transform 160ms ease" }
                  : undefined;
                const setRef = (el: HTMLLIElement | null) => {
                  if (el) reorgRefs.current.set(index, el);
                  else reorgRefs.current.delete(index);
                };
                if (!result) {
                  return (
                    <li key={index} ref={setRef} style={liStyle} className="reorg-card is-empty">
                      <span className="reorg-slot is-empty">{label}</span>
                      <span className="reorg-empty-label">{t("app.none")}</span>
                    </li>
                  );
                }
                const code = result.programme.jupas_code;
                return (
                  <li key={index} ref={setRef} style={liStyle} className={dragging ? "reorg-card is-dragging" : "reorg-card"}>
                    <span
                      className="reorg-grip"
                      aria-hidden="true"
                      onPointerDown={(e) => reorgDragStart(index, e)}
                      onPointerMove={reorgDragMove}
                      onPointerUp={reorgDragEnd}
                      onPointerCancel={reorgDragEnd}
                    >
                      <svg viewBox="0 0 8 12" width="8" height="12" aria-hidden="true">
                        <circle cx="2" cy="2" r="1" /><circle cx="6" cy="2" r="1" />
                        <circle cx="2" cy="6" r="1" /><circle cx="6" cy="6" r="1" />
                        <circle cx="2" cy="10" r="1" /><circle cx="6" cy="10" r="1" />
                      </svg>
                    </span>
                    <button
                      type="button"
                      className="reorg-slot"
                      onClick={(e) => setMoveTarget({ index, rect: e.currentTarget.getBoundingClientRect() })}
                      aria-label={t("compare.swapTo", { code })}
                    >
                      {label}
                    </button>
                    <span className="reorg-card-body">
                      <strong>{code}</strong>
                      <small>{institutionLabel(result.programme.institution)} · {pickName(result.programme, lang)}</small>
                    </span>
                    {onRemove ? (
                      <button
                        type="button"
                        className="reorg-remove"
                        onClick={() => onRemove(code)}
                        aria-label={t("planner.removeFrom", { code, slot: label })}
                      >
                        <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                          <path d="M3 6h18M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2m3 0v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6" />
                          <line x1="10" y1="11" x2="10" y2="17" /><line x1="14" y1="11" x2="14" y2="17" />
                        </svg>
                      </button>
                    ) : null}
                  </li>
                );
              })}
            </ol>
          </div>
          {moveTarget ? (
            <SlotMovePicker
              index={moveTarget.index}
              code={results[moveTarget.index]?.programme.jupas_code ?? ""}
              count={results.length}
              anchor={moveTarget.rect}
              onMove={(target) => {
                if (target !== moveTarget.index) onSwap(moveTarget.index, target);
                setMoveTarget(null);
              }}
              onClose={() => setMoveTarget(null)}
            />
          ) : null}
        </div>,
        document.body,
      ) : null}
    </section>
  );
}


function loadTheme(): Theme {
  try {
    const saved = localStorage.getItem("jupas-staging-theme");
    if (saved === "light" || saved === "dark") return saved;
  } catch {
    // Fall through to system preference.
  }
  return window.matchMedia?.("(prefers-color-scheme: dark)").matches ? "dark" : "light";
}

function loadProfiles(): Profile[] {
  // localStorage is the sole source of profiles. Received-share URL state
  // is kept in a separate `previewProfile` and is NEVER persisted unless
  // the user explicitly clicks "Save as my profile" in ShareView.
  const local = loadLocalProfiles();
  if (local.length > 0) return local;

  // No local profiles yet. If this is a fresh visit with a non-sharing
  // deep-link URL (e.g. user bookmarked their own calc URL), seed a
  // default profile from the URL state so they don't lose it.
  const hash = readHashState();
  if (hash && !hash.sharing && (Object.keys(hash.grades).length > 0 || hash.pickedCodes.length > 0)) {
    return [{ id: "default", name: defaultProfileName(), grades: hash.grades, pickedCodes: hash.pickedCodes }];
  }
  return [{ id: "default", name: defaultProfileName(), grades: {}, pickedCodes: [] }];
}

function loadLocalProfiles(): Profile[] {
  try {
    const saved = localStorage.getItem("jupas-staging-profiles");
    if (saved) {
      const profiles = sanitizeProfiles(JSON.parse(saved));
      if (profiles.length) return profiles;
    }
  } catch (e) {
    console.error("Failed to load profiles", e);
  }
  // Legacy migration: pre-multi-profile localStorage stored grades on a
  // top-level "jupas-staging-grades" key. Pull those into a default profile.
  let grades: StudentGrades = {};
  try {
    const legacyGrades = localStorage.getItem("jupas-staging-grades");
    grades = legacyGrades ? sanitizeGrades(JSON.parse(legacyGrades)) : {};
  } catch (e) {
    console.error("Failed to load legacy grades", e);
  }
  if (Object.keys(grades).length > 0) {
    return [{ id: "default", name: defaultProfileName(), grades, pickedCodes: [] }];
  }
  return [];
}

function sanitizeProfiles(rawProfiles: unknown): Profile[] {
  if (!Array.isArray(rawProfiles)) return [];
  return rawProfiles.slice(0, 8).flatMap((profile, index) => {
    if (!profile || typeof profile !== "object" || Array.isArray(profile)) return [];
    const candidate = profile as Partial<Profile>;
    const id = typeof candidate.id === "string" && candidate.id.trim() ? candidate.id.trim().slice(0, 80) : `profile-${index + 1}`;
    const name = typeof candidate.name === "string" && candidate.name.trim() ? candidate.name.trim().slice(0, 60) : `${defaultProfileName()} ${index + 1}`;
    const picks = Array.isArray(candidate.pickedCodes) ? sanitizeStoredPickedCodes(candidate.pickedCodes) : [];
    return [{ id, name, grades: sanitizeGrades(candidate.grades), pickedCodes: picks }];
  });
}

function sanitizeStoredPickedCodes(raw: unknown[]): (string | null)[] {
  // Reuse the single source-of-truth pattern from hashState (JS + 4 alphanumerics,
  // so SSSDP codes like JSSU67 survive). A local copy here once drifted to
  // /^JS\d{4}$/ and silently dropped SSSDP picks on every reload.
  const cleaned = raw.slice(0, 20).map((code) => {
    if (typeof code !== "string") return null;
    const trimmed = code.trim().toUpperCase();
    return PROGRAMME_CODE_PATTERN.test(trimmed) ? trimmed : null;
  });
  return trimTrailingNulls(cleaned);
}

function loadActiveProfileId(profiles: Profile[]): string {
  try {
    const saved = localStorage.getItem("jupas-staging-active-profile-id");
    if (saved && profiles.some((p) => p.id === saved)) return saved;
  } catch {
    // Ignore storage failures.
  }
  return profiles[0]?.id ?? "default";
}

function ArrowIcon({ direction = "right" }: { direction?: "left" | "right" }) {
  const transform = direction === "left" ? "scale(-1,1)" : undefined;
  return (
    <svg
      width="18" height="14" viewBox="0 0 18 14"
      fill="none" xmlns="http://www.w3.org/2000/svg"
      style={{ display: "inline-block", verticalAlign: "middle", transform }}
      aria-hidden="true"
    >
      <path
        d="M1 7H17M11 1L17 7L11 13"
        stroke="currentColor" strokeWidth="2"
        strokeLinecap="round" strokeLinejoin="round"
      />
    </svg>
  );
}

export default App;
