import { Fragment, useEffect, useRef, useState } from "react";
import type { ReactNode } from "react";
import { institutionLabel } from "../lib/institutions";
import { bandLabelKey, formatDelta, formatPercent } from "../lib/results";
import { slotLabel } from "../lib/slots";
import { useLang, pickName, type Lang, type Translate } from "../lib/i18n";
import { localizedShortSubject, localizedSubject } from "../lib/subjectsI18n";
import { SUBJECTS } from "../lib/strings";
import { describeFormula } from "../lib/formulaText";
import { programmeConsideration } from "../lib/retake";
import { scoringBasisYear } from "../lib/scoreBasis";
import { getSelection, selectionTypeKey, selectionTimingKey, selectionSalienceKey, translateSelectionText } from "../lib/selection";
import { loadProgrammeDetails, type DescBlock, type ProgrammeDetail } from "../lib/programmeDetails";
import { localizeElectiveNote, localizeAdmissionNote } from "../lib/requirementI18n";
import type { CalculationResult, CandidateScore, EligibilityDetail, HkustFormulaStep, OfferStatistic, Programme, ProgrammeResult, YearChanges } from "../types/jupas";
import "./DetailPanel.css";

// "Preferred subjects" are a soft, non-binding preference the institution lists
// on JUPAS (they don't affect eligibility or score). They live in
// `min_requirements_2026.conditional_remarks` and are otherwise unsurfaced in
// the UI. Surface + localize them for the info tooltip.
//
// We MATCH known subject names (longest-first, non-overlapping) rather than
// splitting on separators — a naive split on "," / "and" shreds multi-word
// subjects like "Information and Communication Technology" or "Business,
// Accounting and Financial Studies". Prose notes with lettered "(a)…(b)…"
// clauses (JS4501/4502) are shown verbatim; a note with no matchable subject
// falls back to its cleaned text.
const PREFERRED_ALIAS: Record<string, string> = {
  // CUHK/JUPAS naming for the Maths extended modules
  "Mathematics (Module 1 or 2)": "Mathematics Extended Part (Module 1 or 2)",
  "Mathematics (Module 1)": "Mathematics Extended Part (Module 1)",
  "Mathematics (Module 2)": "Mathematics Extended Part (Module 2)",
  // PolyU naming for the same modules
  "Mathematics (Extended part - Calculus and Statistics)": "Mathematics Extended Part (Module 1)",
  "Mathematics (Extended part - Algebra and Calculus)": "Mathematics Extended Part (Module 2)",
  // bare "Mathematics" (PolyU lists) = the compulsory part
  "Mathematics": "Mathematics (Compulsory Part)",
};
const PREFERRED_KNOWN = [...Object.keys(SUBJECTS), ...Object.keys(PREFERRED_ALIAS)]
  .sort((a, b) => b.length - a.length);

type PreferredInfo = { subjects: string[] } | { note: string } | null;

function preferredSubjectsDisplay(raw: string | null | undefined, lang: Lang): PreferredInfo {
  if (!raw || !/prefer|優先/i.test(raw)) return null;
  if (/\([a-z]\)/i.test(raw)) return { note: raw.trim() }; // prose clauses — verbatim
  const used = new Array(raw.length).fill(false);
  const found: Array<{ idx: number; name: string }> = [];
  for (const name of PREFERRED_KNOWN) {
    let from = 0;
    let idx = raw.indexOf(name, from);
    while (idx !== -1) {
      let overlap = false;
      for (let i = idx; i < idx + name.length; i++) if (used[i]) { overlap = true; break; }
      if (!overlap) {
        found.push({ idx, name });
        for (let i = idx; i < idx + name.length; i++) used[i] = true;
      }
      from = idx + name.length;
      idx = raw.indexOf(name, from);
    }
  }
  if (found.length === 0) return raw.trim() ? { note: raw.trim() } : null;
  found.sort((a, b) => a.idx - b.idx);
  const seen = new Set<string>();
  const subjects: string[] = [];
  for (const f of found) {
    const loc = localizedSubject(PREFERRED_ALIAS[f.name] ?? f.name, lang);
    if (!seen.has(loc)) { seen.add(loc); subjects.push(loc); }
  }
  return { subjects };
}

// Insightful admission notes buried in `jupas_requirements.notes` — advisory tips
// ("Good results in Chinese/English preferred", "High choice banding is
// preferred", "Level 3 in M1/M2 is preferred") that were never surfaced. Filter
// the list down to advisory sentences: keep the soft-preference language, drop
// boilerplate (score-conversion tables, NCS-Chinese/CSD notes, elective
// structure, sitting policy, links) and interview/portfolio (shown elsewhere).
// When the preferred-subjects chips already show, drop subject-preference notes
// so the two don't duplicate.
const NOTE_ADVISORY_RE = /\b(prefer|preferred|preference|priorit|advantage|advantageous|recommend|favou?rab|banding)\b|優先|建議/i;
const NOTE_BOILER_RE = /note\s*\d|https?:|converted as follows|in lieu|more than 1 sitting|combined results|one of the electives?|the other elective|category [abc] subjects?\s*(excluding|including)|=\s*\d|conversion|equivalen|remarks on admission|calculation of scores/i;
const NOTE_ELSEWHERE_RE = /\binterview\b|\bportfolio\b|\baudition\b|written (test|exam)|aptitude/i;
const NOTE_SUBJECT_PREF_RE = /preferred subject|subjects?.{0,40}(is|are)\s+preferred|(level\s*\d|good results).{0,60}preferred/i;

function admissionNotes(programme: Programme, hasPreferredSection: boolean): string[] {
  const notes = programme.jupas_requirements?.notes;
  if (!notes) return [];
  const out: string[] = [];
  const seen = new Set<string>();
  for (const raw of notes) {
    const n = String(raw).trim().replace(/\s+/g, " ");
    if (n.length < 8 || n.length > 200) continue;
    if (!NOTE_ADVISORY_RE.test(n) || NOTE_BOILER_RE.test(n) || NOTE_ELSEWHERE_RE.test(n)) continue;
    if (hasPreferredSection && NOTE_SUBJECT_PREF_RE.test(n)) continue;
    const key = n.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(n);
  }
  return out;
}


// Defence-in-depth for every href that originates from SCRAPED programme data
// (overview links, tuition page, JUPAS/institution sites). The scrape step only
// keeps http(s) URLs, but that guard lives in a build script in this now-public
// repo; this re-checks at render time so a `javascript:`/`data:` scheme can
// never reach an <a href> even if bad data slips through. A rejected URL renders
// as plain text instead of an unsafe link.
function safeHref(url: string | null | undefined): string | undefined {
  const trimmed = (url ?? "").trim();
  return /^https?:\/\//i.test(trimmed) ? trimmed : undefined;
}

// HKUST's School of Engineering changed its subject weightings for 2026, so the
// LQ/median/highest benchmarks HKUST publishes for those programmes are
// "simulated" — 2025 admission results recalculated with the 2026 formula, which
// is exactly what our calculator applies. Flag them so DetailPanel can explain the
// benchmark's nature. Scoped by the existing institution + faculty data fields
// (not a hardcoded code list) so new/renamed Engineering programmes are covered.
function isHkustSimulatedScore(programme: Programme): boolean {
  return programme.institution === "HKUST" && programme.faculty === "School of Engineering";
}

const HKUST_JUPAS_URL = "https://join.hkust.edu.hk/admissions/jupas";
// CUHK's per-programme requirements + score page — where the 2026-recalculated
// 2025 benchmarks (JS4725's "(1)" footnote) and published admission scores live.
const CUHK_JUPAS_URL =
  "https://admission.cuhk.edu.hk/application/jupas/programme-specific-requirements-and-score-calculator/";
// CityU's JUPAS admission page — carries the score formulae + weighted
// median/LQ admission-score reference (recalculated under the current formula).
const CITYU_JUPAS_URL = "https://www.cityu.edu.hk/admo/admissions/jupas-admission";
// HKBU's HKDSE admissions page — the mean/median/LQ admission scores + calculator.
const HKBU_JUPAS_URL = "https://admissions.hkbu.edu.hk/en/hkdse.html";
// EdUHK's JUPAS entrance requirements + admission-scores page (the af_2025 PDF's
// "Reference scores with 2026 entry weightings" originate here).
const EDUHK_JUPAS_URL = "https://www.apply.eduhk.hk/ug/jupas";

// The TRUE 2025 weighting facts for programmes whose scoring fields were
// mirrored onto the 2026 basis (CityU recalculated / HKBU simulated) — shown
// under the scoring-logic card so the "2025" facts stay visible and never
// contradict the year-change pill. Null when the programme isn't mirrored.
function official2025Line(programme: Programme, t: Translate, lang: Lang): string | null {
  const weights = programme.subject_weights_2025_official;
  if (weights == null) return null;
  const parts = Object.entries(weights).map(([subject, w]) => `${localizedShortSubject(subject, lang)} ×${w}`);
  for (const pool of programme.best_of_weights_2025_official ?? []) {
    parts.push(
      `${t("detail.bestOf", { count: pool.count, subjects: pool.subjects.map((s) => localizedShortSubject(s, lang)).join("/") })} ×${pool.weight}`
    );
  }
  if (!parts.length) return t("detail.official2025NoWeights");
  return t("detail.official2025Weights", { weights: parts.join(lang === "zh" ? "、" : ", ") });
}

// One line of an HKBU published admit grade profile ("Chi 4 · Eng 3 · Maths 4 ·
// electives 4 / 4 / 3"). CSD is skipped — it carries no score. Returns null
// when the profile is absent so the caller can drop the row.
function hkbuProfileLine(profile: Record<string, string> | null | undefined, t: Translate): string | null {
  if (!profile) return null;
  const parts: string[] = [];
  const cores: [string, string][] = [
    ["CHIN", t("detail.hkbuEst.chi")],
    ["ENGL", t("detail.hkbuEst.eng")],
    ["MATH", t("detail.hkbuEst.math")],
  ];
  for (const [key, label] of cores) {
    if (profile[key]) parts.push(`${label} ${profile[key]}`);
  }
  const electives = Object.keys(profile)
    .filter((key) => key.startsWith("Elective"))
    .sort()
    .map((key) => profile[key]);
  if (electives.length) parts.push(`${t("detail.hkbuEst.electives")} ${electives.join(" / ")}`);
  return parts.length ? parts.join(" · ") : null;
}

type Props = {
  results: (ProgrammeResult | null)[];
  activeCode?: string;
  reviewRequest: number;
  onActiveCodeChange: (code: string) => void;
  onRemove: (code: string) => void;
  // View mode: hides the trash icon so the user can't drop programmes
  // out of someone else's shared plan.
  readOnly?: boolean;
  // A programme being previewed that is NOT in the plan (e.g. a clicked "Safer
  // option" suggestion). Rendered as "Suggested / not in your plan" — no plan
  // slot badge, no remove button.
  previewCode?: string;
  // Recommendations-only mode: when the detail is showing the safer-option
  // suggestions (rather than the student's picks), this maps each code → the
  // slot it backs up ("A2"). Every listed programme is then treated as a
  // suggestion (no remove button, "Backup for AX" labels instead of slot badges).
  suggestionSlots?: Record<string, string>;
  // When viewing a suggestion, show in-panel Add/Swap actions (desktop console —
  // there's no mobile-style footer there). Both take just the code; the parent
  // resolves which slot a swap targets. Omit on mobile (the footer handles it).
  onAddToPlan?: (code: string) => void;
  onSwapToSlot?: (code: string) => void;
  // The candidate is a HKDSE retaker (marked ≥1 retaken subject). Enables the
  // combined-cert / sitting-combination warnings, which apply to a programme
  // even when it carries no score penalty (warning-only HKU programmes).
  isRetaker?: boolean;
};

function scrollParentFor(node: HTMLElement | null): HTMLElement | null {
  let parent = node?.parentElement ?? null;
  while (parent) {
    const style = window.getComputedStyle(parent);
    if (/(auto|scroll|overlay)/.test(`${style.overflow}${style.overflowY}`)) {
      return parent;
    }
    parent = parent.parentElement;
  }
  return null;
}

// i18n key for each classified sitting-combination rule ("" = no localized
// sentence, just show the raw source quote).
const CONSIDER_SENTENCE_KEY: Record<string, string> = {
  single: "retake.consider.single",
  latest: "retake.consider.latest",
  years: "retake.consider.years",
  sittings: "retake.consider.sittings",
  other: "",
};

// Retake-penalty + combined-cert reminder shown under the hero score. The
// penalty note appears whenever this score was actually penalised; the
// consideration note appears for any retaker on a programme that states how it
// combines sittings (HKU) — including programmes with no score penalty.
function RetakeDetailNote({ programme, penalty, isRetaker, t, lang }: {
  programme: Programme;
  penalty: CalculationResult["retakePenalty"];
  isRetaker: boolean;
  t: Translate;
  lang: Lang;
}) {
  const consideration = isRetaker ? programmeConsideration(programme) : null;
  if (!penalty && !consideration) return null;
  const sentenceKey = consideration ? CONSIDER_SENTENCE_KEY[consideration.kind] : "";
  return (
    <div className="retake-detail-note">
      {penalty ? (
        <div className={"retake-note-row penalty" + (penalty.estimated ? " estimated" : "")}>
          <span className="retake-note-tag">{t("retake.penalty.title")}</span>
          <p>
            {penalty.scope === "retake_subject"
              ? t("retake.penalty.hku", {
                  pts: penalty.deducted.toFixed(2),
                  subjects: (penalty.subjects ?? []).map((s) => localizedShortSubject(s, lang)).join(t("common.listSep")),
                })
              : t("retake.penalty.cuhk", { pts: penalty.deducted.toFixed(2), band: penalty.band ?? "" })}{" "}
            <em className="retake-was">{t("retake.penalty.was", { score: penalty.preScore.toFixed(2) })}</em>
          </p>
        </div>
      ) : null}
      {consideration ? (
        <div className={"retake-note-row consider " + consideration.severity}>
          <span className="retake-note-tag">{t("retake.consider.title")}</span>
          <p>
            {sentenceKey ? `${t(sentenceKey)} ` : ""}
            <em className="retake-source">{t("retake.consider.source", { text: consideration.text })}</em>
          </p>
        </div>
      ) : null}
    </div>
  );
}

export function DetailPanel({ results, activeCode, reviewRequest, onActiveCodeChange, onRemove, readOnly = false, previewCode, suggestionSlots, onAddToPlan, onSwapToSlot, isRetaker = false }: Props) {
  const { t, lang } = useLang();
  const [auditOpen, setAuditOpen] = useState(false);
  // Programme name is clamped (2 lines / 1 secondary line) by default; tapping
  // it expands to the full name and back. Reset when switching programmes.
  const [nameExpanded, setNameExpanded] = useState(false);
  const [eligibilityOpen, setEligibilityOpen] = useState(false);
  const [showPassedReqs, setShowPassedReqs] = useState(false);
  const [isStuck, setIsStuck] = useState(false);
  const panelRef = useRef<HTMLElement | null>(null);
  const headerRef = useRef<HTMLDivElement | null>(null);
  const resultsNonNull = results.filter((r): r is ProgrammeResult => r !== null);
  const result = resultsNonNull.find((item) => item.programme.jupas_code === activeCode) || resultsNonNull[0];
  // A code is "suggested" (not a real plan slot) if it's the single previewed
  // programme OR — in recommendations-only mode — one of the safer options.
  const suggestionMode = suggestionSlots != null;
  const backupSlotOf = (code: string): string | undefined => suggestionSlots?.[code];
  const isSuggested = (code: string): boolean => code === previewCode || backupSlotOf(code) != null;

  useEffect(() => {
    const panel = panelRef.current;
    if (!panel) return;
    const scrollParent = scrollParentFor(panel);
    const update = () => {
      // Desktop: panel scrolls internally.
      if (panel.scrollTop > 0) {
        setIsStuck(true);
        return;
      }
      if (scrollParent && scrollParent !== panel && scrollParent.scrollTop > 0) {
        setIsStuck(true);
        return;
      }
      // Mobile: page scrolls – use -8px tolerance so scrollIntoView (which lands
      // at 0) doesn't prematurely trigger the minimal header state.
      setIsStuck(panel.getBoundingClientRect().top < -8);
    };
    panel.addEventListener("scroll", update, { passive: true });
    scrollParent?.addEventListener("scroll", update, { passive: true });
    window.addEventListener("scroll", update, { passive: true });
    update();
    return () => {
      panel.removeEventListener("scroll", update);
      scrollParent?.removeEventListener("scroll", update);
      window.removeEventListener("scroll", update);
    };
  }, []);
  useEffect(() => { setNameExpanded(false); }, [activeCode]);
  const activeIndex = result ? resultsNonNull.findIndex((item) => item.programme.jupas_code === result.programme.jupas_code) : -1;
  // Index in the RAW picks array (positions including nulls). The
  // slot label A1/A2/.../B1... reflects the original pick position,
  // so e.g. deleting A1 leaves the former A2 still labelled "A2"
  // until the user splices the empty A1 slot. activeIndex above
  // tracks position within the compacted (non-null) list, used for
  // the X / N count denominator.
  const rawActiveIndex = result ? results.findIndex((item) => item != null && item.programme.jupas_code === result.programme.jupas_code) : -1;

  useEffect(() => {
    setAuditOpen(false);
  }, [result?.programme.jupas_code]);

  useEffect(() => {
    setEligibilityOpen(result ? !result.eligibility.eligible : false);
    setShowPassedReqs(false);
  }, [result?.eligibility.eligible, result?.programme.jupas_code]);

  const prevReviewRequest = useRef(0);

  useEffect(() => {
    if (reviewRequest > prevReviewRequest.current) {
      prevReviewRequest.current = reviewRequest;
      if (result) {
        const timer = window.setTimeout(() => {
          panelRef.current?.scrollIntoView({ block: "start", behavior: "smooth" });
        }, 320);
        return () => window.clearTimeout(timer);
      }
    }
  }, [reviewRequest, result]);

  if (!result) {
    return (
      <aside className="panel detail-panel empty" ref={panelRef}>
        <div className="panel-heading">
          <div className="step-title-content">
            <p className="eyebrow">{t("detail.emptyEyebrow")}</p>
            <h2>{t("detail.emptyTitle")}</h2>
          </div>
        </div>
        <p>{t("detail.emptyLede")}</p>
      </aside>
    );
  }

  const { programme, calculation, eligibility } = result;
  const selection = getSelection(programme);
  const preferredSubjects = preferredSubjectsDisplay(programme.min_requirements_2026?.conditional_remarks, lang);
  const admissionNotesList = admissionNotes(programme, !!preferredSubjects);
  // Standardized, bilingual formula descriptions (generated from the structured
  // model; raw wording kept as a muted "Official:" line — see describeFormula).
  const formula2025 = describeFormula(programme, "2025", lang, t);
  const formula2026 = describeFormula(programme, "2026", lang, t);
  // Which weighting the score actually runs on. Programmes whose benchmarks
  // are already on the 2026 basis (CityU recalculated, HKBU simulated, CUHK
  // recalc/sim, HKUST Engineering) score with the 2026 weighting, and every
  // year label below must say so instead of claiming "2025".
  const basisYear = scoringBasisYear(programme);
  const changesNote =
    basisYear === "2025"
      ? t("detail.changes.note")
      : (programme.score_basis ?? "").endsWith("recalculated")
        ? t("detail.changes.noteRecalc", {
            inst: programme.institution === "CityUHK" ? (lang === "zh" ? "城大" : "CityU") : lang === "zh" ? "中大" : "CUHK",
          })
        : t("detail.changes.noteSimulated");

  function moveActive(direction: 1 | -1) {
    if (resultsNonNull.length <= 1 || activeIndex < 0) return;
    const nextIndex = (activeIndex + direction + resultsNonNull.length) % resultsNonNull.length;
    onActiveCodeChange(resultsNonNull[nextIndex].programme.jupas_code);
  }

  return (
    <div className="detail-layout">
      <nav className="programme-menu" aria-label={t("detail.selectedAria")}>
        <p className="programme-menu-heading">{t(suggestionMode ? "detail.suggestionList" : "detail.programmeList", { n: resultsNonNull.length })}</p>
        {results.map((r, i) => (
          // Key by programme code (not array index) so element identity follows
          // the programme when the picks list is reordered / a slot is removed.
          <Fragment key={r ? r.programme.jupas_code : `empty-${i}`}>
            {i > 0 && <hr className="programme-menu-divider" />}
            {!r ? (
              <div className="programme-menu-item empty-slot" data-code={`empty-${i}`}>
                <span className="programme-menu-code"><span className="selected-slot-badge">{prioritySlot(i)}</span>---</span>
                <span className="programme-menu-name muted">{t("detail.emptySlot")}</span>
              </div>
            ) : (
              <button
                type="button"
                data-code={r.programme.jupas_code}
                className={r.programme.jupas_code === result.programme.jupas_code ? "programme-menu-item active" : "programme-menu-item"}
                onClick={() => onActiveCodeChange(r.programme.jupas_code)}
              >
                <span className="programme-menu-code"><span className={isSuggested(r.programme.jupas_code) ? "selected-slot-badge is-preview" : "selected-slot-badge"}>{isSuggested(r.programme.jupas_code) ? "★" : prioritySlot(i)}</span>{r.programme.jupas_code}</span>
                <span className="programme-menu-name">{pickName(r.programme, lang)}</span>
                <span className="programme-menu-bottom">
                  <b className="programme-menu-score-value">{r.calculation.totalScore.toFixed(2)}</b>
                  <span className="programme-menu-tags">
                    <span className={r.eligibility.eligible ? "status pass mini" : "status fail mini"}>
                      {r.eligibility.eligible ? t("detail.eligible") : t("detail.ineligible")}
                    </span>
                    <span className={`band mini ${r.band}`}>{t(bandLabelKey(r.band))}</span>
                  </span>
                </span>
              </button>
            )}
          </Fragment>
        ))}
      </nav>

      <aside
        ref={panelRef}
        className="panel detail-panel"
      >
        {resultsNonNull.length > 1 ? (
          <>
            <button
              type="button"
              className="detail-edge-tap detail-edge-tap-prev"
              onClick={() => moveActive(-1)}
              aria-label={t("detail.prevProgramme")}
            >
              <svg width="14" height="22" viewBox="0 0 14 22" fill="none" aria-hidden="true">
                <polyline points="10,3 2,11 10,19" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round"/>
              </svg>
            </button>
            <button
              type="button"
              className="detail-edge-tap detail-edge-tap-next"
              onClick={() => moveActive(1)}
              aria-label={t("detail.nextProgramme")}
            >
              <svg width="14" height="22" viewBox="0 0 14 22" fill="none" aria-hidden="true">
                <polyline points="4,3 12,11 4,19" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round"/>
              </svg>
            </button>
          </>
        ) : null}
        <div className="detail-picker">
          <button className="ghost-button" type="button" disabled={resultsNonNull.length <= 1} onClick={() => moveActive(-1)} aria-label={t("detail.prev")}>
            <svg width="22" height="14" viewBox="0 0 22 14" fill="none" xmlns="http://www.w3.org/2000/svg">
              <line x1="20" y1="7" x2="2" y2="7" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round"/>
              <polyline points="8,1 2,7 8,13" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"/>
            </svg>
          </button>
          <span><em>{isSuggested(programme.jupas_code) ? "★" : prioritySlot(rawActiveIndex)}</em>{activeIndex + 1} / {resultsNonNull.length}</span>
          <button className="ghost-button" type="button" disabled={resultsNonNull.length <= 1} onClick={() => moveActive(1)} aria-label={t("detail.next")}>
            <svg width="22" height="14" viewBox="0 0 22 14" fill="none" xmlns="http://www.w3.org/2000/svg">
              <line x1="2" y1="7" x2="20" y2="7" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round"/>
              <polyline points="14,1 20,7 14,13" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"/>
            </svg>
          </button>
        </div>
        <div className={isStuck ? "detail-header is-stuck" : "detail-header"}>
          <div className="detail-header-main">
            <div className="detail-header-text">
              <p className="eyebrow">{isSuggested(programme.jupas_code) ? (backupSlotOf(programme.jupas_code) ? t("detail.backupFor", { slot: backupSlotOf(programme.jupas_code)! }) : suggestionMode ? t("detail.suggested") : t("detail.viewing")) : prioritySlot(rawActiveIndex)} · {institutionLabel(programme.institution)} · {programme.jupas_code}</p>
              <div
                className={"detail-name" + (nameExpanded ? " is-expanded" : "")}
                role="button"
                tabIndex={0}
                aria-expanded={nameExpanded}
                aria-label={t("detail.toggleFullName")}
                onClick={() => setNameExpanded((v) => !v)}
                onKeyDown={(event) => {
                  if (event.key === "Enter" || event.key === " ") {
                    event.preventDefault();
                    setNameExpanded((v) => !v);
                  }
                }}
              >
                <h2 title={pickName(programme, lang)}>{pickName(programme, lang)}</h2>
                {(lang === "zh" ? programme.name_en : programme.name_zh)
                  ? <p className="zh-name">{lang === "zh" ? programme.name_en : programme.name_zh}</p>
                  : null}
              </div>
            </div>
            {readOnly || isSuggested(programme.jupas_code) ? null : (
              <button className="remove-button" type="button" onClick={() => onRemove(programme.jupas_code)} aria-label={t("detail.removeProgramme")}>
                <svg width="18" height="18" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
                  <polyline points="3,6 5,6 21,6" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/>
                  <path d="M19,6l-1,14H6L5,6" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/>
                  <path d="M10,11v6M14,11v6" stroke="currentColor" strokeWidth="2" strokeLinecap="round"/>
                  <path d="M9,6V4h6v2" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/>
                </svg>
              </button>
            )}
          </div>
          <div className="detail-badges">
            <span className={eligibility.eligible ? "status pass" : "status fail"}>{eligibility.eligible ? t("detail.eligible") : t("detail.reqNotMet")}</span>
            {isNewProgramme(result) ? (
              <span className="status new">{t("detail.newProgramme")}</span>
            ) : (
              <span className={`band ${result.band}`}>{t(bandLabelKey(result.band))}</span>
            )}
            {programme.quota_shared && programme.quota_shared.codes.length > 1 ? (
              <span className="status neutral" title={programme.quota_shared.codes.join(", ")}>
                {t("detail.quotaShared", { n: programme.quota_shared.total ?? programme.quota ?? 0, m: programme.quota_shared.codes.length })}
              </span>
            ) : programme.quota ? (
              <span className="status neutral">{t("detail.quota", { n: programme.quota })}</span>
            ) : null}
            {programme.scores_2025?.score_type === "estimated" ? <span className="status warn">{t("detail.estimatedBenchmark")}</span> : null}
            {programme.year_changes?.weighting_changed ? <span className="status change">{t("detail.pill.weightingChanged")}</span> : null}
            {programme.year_changes?.formula_changed ? <span className="status change">{t("detail.pill.formulaChanged")}</span> : null}
          </div>
        </div>

        {/* Plan actions for a recommendation viewed in the (desktop) detail panel,
            which has no mobile-style footer. Only shown when the parent passes the
            handlers (desktop console) and we're looking at a suggestion. */}
        {isSuggested(programme.jupas_code) && !readOnly && (onAddToPlan || onSwapToSlot) ? (
          <div className="detail-rec-actions">
            {onSwapToSlot && backupSlotOf(programme.jupas_code) ? (
              <button
                type="button"
                className="suggest-swap"
                onClick={() => onSwapToSlot(programme.jupas_code)}
                aria-label={t("suggest.swapAria", { code: programme.jupas_code, slot: backupSlotOf(programme.jupas_code)! })}
              >
                {t("suggest.swap", { slot: backupSlotOf(programme.jupas_code)! })}
              </button>
            ) : null}
            {onAddToPlan ? (
              <button
                type="button"
                className="suggest-add"
                onClick={() => onAddToPlan(programme.jupas_code)}
                aria-label={t("suggest.addAria", { code: programme.jupas_code, name: pickName(programme, lang) })}
              >
                {t("suggest.add")}
              </button>
            ) : null}
          </div>
        ) : null}

        <section className={`score-context band-${result.band}`}>
          <div
            className={"score-context-header" + (auditOpen ? " expanded" : "")}
            role="button"
            tabIndex={0}
            aria-expanded={auditOpen}
            aria-label={auditOpen ? t("detail.hideBreakdown") : t("detail.showBreakdown")}
            onClick={() => setAuditOpen(!auditOpen)}
            onKeyDown={(event) => {
              if (event.key === "Enter" || event.key === " ") {
                event.preventDefault();
                setAuditOpen((v) => !v);
              }
            }}
          >
            <div className="score-context-line">
              <div className="score-context-score">
                <em>{t("detail.yourScore")}</em>
                <strong>{calculation.totalScore.toFixed(2)}</strong>
              </div>
              <span className={`band ${result.band}`}>{t(bandLabelKey(result.band))}</span>
            </div>
            <p className="score-context-note">
              {isNewProgramme(result) || !result.hasScoreData
                ? t("detail.noData2025")
                : t("detail.calcBasis", { year: basisYear })}
              <span className="score-context-tap">
                {auditOpen ? t("detail.tapBreakdownHide") : t("detail.tapBreakdownShow")}
                <svg className={"collapsible-chevron" + (auditOpen ? " open" : "")} width="12" height="12" viewBox="0 0 16 16" fill="none" aria-hidden="true">
                  <polyline points="3,5 8,11 13,5" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round"/>
                </svg>
              </span>
            </p>
            {auditOpen ? (
              <AuditRows
                candidates={calculation.allCandidates}
                formula={formula2025.text || formula2026.text || null}
                basisYear={basisYear}
                t={t}
                lang={lang}
              />
            ) : null}
          </div>
          {calculation.recognizedApL?.length ? (
            <p className="apl-advisory-note">
              {t("detail.aplAdvisoryPre")}
              <b>{calculation.recognizedApL.map((s) => localizedSubject(s, lang)).join(t("common.listSep"))}</b>
              {t("detail.aplAdvisoryPost")}
            </p>
          ) : null}
          <RetakeDetailNote programme={programme} penalty={calculation.retakePenalty} isRetaker={isRetaker} t={t} lang={lang} />
          {(() => {
            // The institution's published 2025 admission scores (LQ/Median/UQ) are
            // ALWAYS shown — they exist regardless of whether the student has entered
            // grades. The delta vs the student's own score is overlaid only once there
            // IS a score (i.e. a matching comparison). Only a genuinely score-less
            // programme falls through to the "no benchmark" line.
            const sc = programme.scores_2025 || {};
            const refKeys: string[] = ["uq", "median", "lq", "mean"];
            if (sc.median == null && sc.mean == null && sc.expected_score != null) refKeys.push("expected_score");
            const cmpByKey = new Map(result.comparisons.map((c) => [c.key as string, c]));
            const cards: Array<{ key: string; score: number; unweighted?: boolean }> = refKeys
              .map((key) => ({ key, score: (sc as Record<string, number | null | undefined>)[key] }))
              .filter((c): c is { key: string; score: number } => c.score != null);
            // HKBU 2026-simulated: median/LQ are re-weighted estimates, but HKBU's
            // published MEAN was computed under the old (unweighted) formula. Show it
            // as a distinct "無比重" card — no delta, since it isn't on the weighted basis.
            if (programme.score_basis === "hkbu_2026_simulated" && sc.mean_official_2025_basis != null) {
              cards.push({ key: "mean", score: sc.mean_official_2025_basis, unweighted: true });
            }
            if (!cards.length) return <p className="muted">{t("detail.noBenchmark")}</p>;
            return (
              <div className="benchmark-grid">
                {cards.map(({ key, score, unweighted }) => {
                  const cmp = unweighted ? undefined : cmpByKey.get(key);
                  const cls = !cmp ? "benchmark-card" : cmp.delta >= 0 ? "benchmark-card positive-card" : "benchmark-card negative-card";
                  return (
                    <div className={cls} key={unweighted ? "mean-unweighted" : key}>
                      <span>{unweighted ? t("detail.hkbuSim.meanCardLabel") : t(`common.${key}`)}</span>
                      <strong>{score}</strong>
                      {cmp ? (
                        <small>
                          <b>{formatDelta(cmp.delta)}</b>
                          <em>{formatPercent(cmp.percent)}</em>
                        </small>
                      ) : unweighted ? (
                        <small className="muted">{t("detail.hkbuSim.meanCardHint")}</small>
                      ) : null}
                    </div>
                  );
                })}
              </div>
            );
          })()}
          {isHkustSimulatedScore(programme) ? (
            <div className="simulated-scores-note">
              <p>{t("detail.hkustSim.note")}</p>
              <p className="simulated-scores-formula">{t("detail.hkustSim.formula")}</p>
              <a
                className="simulated-scores-source"
                href={HKUST_JUPAS_URL}
                target="_blank"
                rel="noopener noreferrer"
              >
                {t("detail.hkustSim.source")} ↗
              </a>
            </div>
          ) : null}
          {programme.score_basis === "cuhk_2026_recalculated" ? (
            <div className="simulated-scores-note">
              <p>{t("detail.cuhkRecalc.note")}</p>
              <a
                className="simulated-scores-source"
                href={CUHK_JUPAS_URL}
                target="_blank"
                rel="noopener noreferrer"
              >
                {t("detail.cuhkRecalc.source")} ↗
              </a>
            </div>
          ) : null}
          {programme.score_basis === "cityu_2026_recalculated" ? (
            <div className="simulated-scores-note">
              <p>{t("detail.cityuRecalc.note")}</p>
              <a
                className="simulated-scores-source"
                href={CITYU_JUPAS_URL}
                target="_blank"
                rel="noopener noreferrer"
              >
                {t("detail.cityuRecalc.source")} ↗
              </a>
            </div>
          ) : null}
          {programme.score_basis === "eduhk_2026_recalculated" ? (
            <div className="simulated-scores-note">
              <p>{t("detail.eduhkRecalc.note")}</p>
              <a
                className="simulated-scores-source"
                href={EDUHK_JUPAS_URL}
                target="_blank"
                rel="noopener noreferrer"
              >
                {t("detail.eduhkRecalc.source")} ↗
              </a>
            </div>
          ) : null}
          {programme.institution === "HKBU" && programme.scores_2025?.score_type === "estimated" ? (
            <div className="simulated-scores-note">
              <p>{t(programme.score_basis === "hkbu_2026_simulated" ? "detail.hkbuSim.note" : "detail.hkbuEst.note")}</p>
              <p className="simulated-scores-formula">{t("detail.hkbuEst.method")}</p>
              {programme.score_basis === "hkbu_2026_simulated" ? (
                <p className="simulated-scores-formula">{t("detail.hkbuSim.meanNote")}</p>
              ) : null}
              {hkbuProfileLine(programme.score_grades_2025?.median, t) ? (
                <p className="simulated-scores-formula">
                  {t("detail.hkbuEst.profileMedian", { grades: hkbuProfileLine(programme.score_grades_2025?.median, t)! })}
                </p>
              ) : null}
              {hkbuProfileLine(programme.score_grades_2025?.lq, t) ? (
                <p className="simulated-scores-formula">
                  {t("detail.hkbuEst.profileLq", { grades: hkbuProfileLine(programme.score_grades_2025?.lq, t)! })}
                </p>
              ) : null}
              <a
                className="simulated-scores-source"
                href={HKBU_JUPAS_URL}
                target="_blank"
                rel="noopener noreferrer"
              >
                {t("detail.hkbuSim.source")} ↗
              </a>
            </div>
          ) : null}
          {programme.score_basis === "cuhk_2026_simulated" ? (
            <div className="simulated-scores-note">
              <p>{t("detail.cuhkSim.note")}</p>
              <p className="simulated-scores-formula">{t("detail.cuhkSim.method")}</p>
              <a
                className="simulated-scores-source"
                href={CUHK_JUPAS_URL}
                target="_blank"
                rel="noopener noreferrer"
              >
                {t("detail.cuhkRecalc.source")} ↗
              </a>
            </div>
          ) : null}
          {programme.score_basis === "restructured" && programme.restructured_from ? (
            <p className="warning">{t("detail.restructured.note", { from: programme.restructured_from })}</p>
          ) : null}
          {typeof programme.scores_2025?.lq === "number" && typeof programme.scores_2025?.median === "number" && programme.scores_2025.lq > programme.scores_2025.median ? (
            <p className="muted benchmark-caveat">{t("detail.lqCaveat")}</p>
          ) : null}
        </section>

        <hr className="grade-section-divider" />

        <EligibilityBlock
          eligible={eligibility.eligible}
          details={eligibility.details}
          desktopOpen={eligibilityOpen}
          showPassed={showPassedReqs}
          onToggleDesktopOpen={() => setEligibilityOpen(!eligibilityOpen)}
          onTogglePassed={() => setShowPassedReqs((v) => !v)}
          t={t}
          lang={lang}
        />

        {preferredSubjects ? (
          <section className="detail-preferred formula-card">
            <span>{t("detail.preferred")}</span>
            <p className="muted detail-preferred-lede">{t("detail.preferredLede")}</p>
            <p className="detail-preferred-subjects">
              {"subjects" in preferredSubjects
                ? preferredSubjects.subjects.join(" · ")
                : preferredSubjects.note}
            </p>
          </section>
        ) : null}

        {admissionNotesList.length > 0 ? (
          <section className="detail-notes formula-card">
            <span>{t("detail.admissionNotes")}</span>
            <ul className="detail-notes-list">
              {admissionNotesList.map((n, i) => <li key={i}>{localizeAdmissionNote(n, lang)}</li>)}
            </ul>
          </section>
        ) : null}

        {selection.items.length > 0 ? (
          <section className="detail-selection formula-card">
              <span>{t("detail.selection.heading")}</span>
              <p className="muted detail-selection-sub">{t("detail.selection.sub")}</p>
              <ul className="detail-selection-list">
                {selection.items.map((item) => {
                  const timingKey = selectionTimingKey(item.timing);
                  const tentativeInterview = item.type === "interview" && /\bwhen necessary\b|\bif necessary\b|\bif required\b|\bwhere necessary\b/i.test(item.when || "");
                  return (
                    <li key={item.type} className={`detail-selection-item sal-${item.salience}`}>
                      <strong>{t(selectionTypeKey(item.type))}</strong>
                      <span className="detail-selection-meta">
                        {timingKey ? <span>{t(timingKey)}</span> : null}
                        {tentativeInterview ? <span>{t("sel.tentative")}</span> : <span>{t(selectionSalienceKey(item.salience))}</span>}
                        {item.inferred ? <em>{t(item.inferred === "stale" ? "sel.stale" : "sel.inferred")}</em> : null}
                      </span>
                      {item.type === "interview" && (item.before || item.after || item.date || item.format) ? (
                        <div className="detail-selection-structured">
                          {item.before ? (
                            <div className="structured-row">
                              <em>{t("sel.structured.before")}</em>
                              <span>{translateSelectionText(item.before, lang)}</span>
                            </div>
                          ) : null}
                          {item.after ? (
                            <div className="structured-row">
                              <em>{t("sel.structured.after")}</em>
                              <span>{translateSelectionText(item.after, lang)}</span>
                            </div>
                          ) : null}
                          {item.date ? (
                            <div className="structured-row">
                              <em>{t("sel.structured.date")}</em>
                              <span>{translateSelectionText(item.date, lang)}</span>
                            </div>
                          ) : null}
                          {item.format ? (
                            <div className="structured-row">
                              <em>{t("sel.structured.format")}</em>
                              <span>{translateSelectionText(item.format, lang)}</span>
                            </div>
                          ) : null}
                        </div>
                      ) : item.details && item.details.length ? (
                        <ul className="detail-selection-details">
                          {item.details.map((d, i) => (
                            <li key={i}>{translateSelectionText(d, lang)}</li>
                          ))}
                        </ul>
                      ) : item.when ? (
                        <span className="detail-selection-source">
                          <span>{t("detail.selection.source")}</span>
                          <q>{translateSelectionText(item.when, lang)}</q>
                        </span>
                      ) : null}
                      {item.note ? <span className="detail-selection-note muted">{t(item.note)}</span> : null}
                    </li>
                  );
                })}
              </ul>
          </section>
        ) : null}

        <hr className="grade-section-divider" />

        <section>
          {programme.year_changes ? <YearChangesPanel yc={programme.year_changes} note={changesNote} t={t} lang={lang} /> : null}
          <div className="formula-year-grid">
            {isNewProgramme(result) ? null : (
              <FormulaBlock
                label={basisYear === "2026" ? t("detail.formulaScoringLabel") : t("detail.formula2025Label")}
                note={basisYear === "2026" ? t("detail.formulaScoringNote") : t("detail.formula2025Note")}
                extraNote={official2025Line(programme, t, lang)}
                formula={formula2025.text}
                rawFormula={formula2025.showOfficial ? formula2025.raw : null}
                weights={programme.subject_weights_2025 || {}}
                pools={programme.best_of_weights_2025 || []}
                steps={programme.institution === "HKUST" ? programme.hkust_formula_steps : undefined}
                defaultOpen={basisYear === "2026"}
                t={t}
                lang={lang}
              />
            )}
            <FormulaBlock
              label={t("detail.formula2026Label")}
              note={t("detail.formula2026Note")}
              formula={formula2026.text}
              rawFormula={formula2026.showOfficial ? formula2026.raw : null}
              weights={programme.subject_weights_2026 || {}}
              pools={programme.best_of_weights_2026 || []}
              steps={programme.institution === "HKUST" ? programme.hkust_formula_steps : undefined}
              t={t}
              lang={lang}
            />
          </div>
        </section>

        <OffersBlock programme={programme} />

        <ProgrammeExtraInfoCard programme={programme} />

        <OfficialLinksCard programme={programme} />

        {/* Crowd-sourced correction: scores/weightings are compiled from public
            sources and can lag or err. Routes to the same Google Form the About
            page uses; the code is in the label so the reporter knows what to cite. */}
        <a
          className="detail-report-link"
          href="https://forms.gle/f2V4m5TrWpKSySPD8"
          target="_blank"
          rel="noopener noreferrer"
        >
          <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
            <path d="M4 15s1-1 4-1 5 2 8 2 4-1 4-1V3s-1 1-4 1-5-2-8-2-4 1-4 1z" />
            <line x1="4" y1="22" x2="4" y2="15" />
          </svg>
          {t("detail.reportError")}
        </a>
      </aside>
    </div>
  );
}

function ProgrammeExtraInfoCard({ programme }: { programme: Programme }) {
  const { t } = useLang();
  const [open, setOpen] = useState(false);
  // The unified data only carries a ~280-char preview of the overview. Pull the
  // full text lazily once the detail page is open (cached after first fetch);
  // until it arrives, fall back to the trimmed preview so nothing flashes empty.
  const [detail, setDetail] = useState<ProgrammeDetail | null>(null);
  useEffect(() => {
    let alive = true;
    setDetail(null);
    loadProgrammeDetails().then((map) => {
      if (alive) setDetail(map[programme.jupas_code] ?? null);
    });
    return () => { alive = false; };
  }, [programme.jupas_code]);

  const blocks = detail?.blocks;
  const descPreview = (programme.short_description ?? "").trim();
  const tuition = (programme.tuition_fee_first_year || "").trim();
  const tuitionUrl = safeHref(detail?.tuition_url);
  const contacts = (programme.contacts_text || "").trim();
  const studyLevel = (programme.study_level || "").trim();
  const remarks = (programme.remarks || "").trim();

  const sections: Array<{ key: string; label: string; content: ReactNode }> = [];
  // Overview: render the structured blocks once loaded; until then show the
  // trimmed preview text so the section never flashes empty.
  if (blocks?.length) {
    sections.push({ key: "desc", label: t("detail.overview"), content: <DescriptionBlocks blocks={blocks} /> });
  } else if (descPreview) {
    sections.push({ key: "desc", label: t("detail.overview"), content: <span className="extra-info-value multiline">{descPreview}</span> });
  }
  if (studyLevel) sections.push({ key: "level", label: t("detail.studyLevel"), content: <span className="extra-info-value">{studyLevel}</span> });
  if (tuition) {
    sections.push({
      key: "fee",
      label: t("detail.tuition"),
      content: (
        <span className="extra-info-value">
          {tuition}
          {tuitionUrl ? (
            <> · <a className="extra-info-link" href={tuitionUrl} target="_blank" rel="noopener noreferrer">{t("detail.moreInfoLink")}</a></>
          ) : null}
        </span>
      ),
    });
  }
  if (contacts) sections.push({ key: "contacts", label: t("detail.contacts"), content: <span className="extra-info-value multiline">{contacts}</span> });
  if (remarks && remarks !== "--") sections.push({ key: "remarks", label: t("detail.remarks"), content: <span className="extra-info-value multiline">{remarks}</span> });

  if (sections.length === 0) return null;

  return (
    <section className="extra-info-card formula-card">
      <div className="extra-info-eyebrow">
        <span>{t("detail.moreInfo")}</span>
        <b className="tally-badge extra-info-tally">{t("detail.sections", { n: sections.length })}</b>
      </div>

      <hr className="weight-divider" />
      <button
        type="button"
        className={"weight-toggle" + (open ? " open" : "")}
        aria-expanded={open}
        onClick={() => setOpen((v) => !v)}
      >
        {open ? t("detail.hideDetails") : t("detail.showDetails")}
        <svg width="14" height="14" viewBox="0 0 16 16" fill="none" aria-hidden="true">
          <polyline points="3,5 8,11 13,5" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round"/>
        </svg>
      </button>

      {open ? (
        <div className="extra-info-body">
          {sections.map((s) => (
            <div key={s.key} className="extra-info-row">
              <em>{s.label}</em>
              {s.content}
            </div>
          ))}
        </div>
      ) : null}
    </section>
  );
}

// Renders the structured overview: headings / paragraphs / list items, each a
// sequence of plain-text and link spans. No raw HTML — text is rendered as React
// text (auto-escaped) and link hrefs pass through safeHref(), so this is XSS-safe.
function DescriptionBlocks({ blocks }: { blocks: DescBlock[] }) {
  return (
    <div className="extra-info-value desc-blocks">
      {blocks.map((b, i) => {
        const content = b.spans.map((s, j) => {
          const href = safeHref(s.href);
          return href ? (
            <a key={j} href={href} target="_blank" rel="noopener noreferrer" className="desc-link">{s.text}</a>
          ) : (
            <span key={j}>{s.text}</span>
          );
        });
        const cls = b.t === "h" ? "desc-block desc-h" : b.t === "li" ? "desc-block desc-li" : "desc-block desc-p";
        return <p key={i} className={cls}>{content}</p>;
      })}
    </div>
  );
}

function OfficialLinksCard({ programme }: { programme: Programme }) {
  const { t } = useLang();
  const instSite = safeHref((programme.programme_websites || []).find(Boolean));
  const jupasUrl = safeHref(programme.jupas_url) || `https://www.jupas.edu.hk/en/programme/${programme.institution.toLowerCase()}/${programme.jupas_code}`;

  return (
    <section className="formula-card official-card">
      <span>{t("detail.officialPages")}</span>
      <div className="official-links">
        <a
          className="official-link"
          href={jupasUrl}
          target="_blank"
          rel="noopener noreferrer"
        >
          <strong>{t("detail.officialJupas")}</strong>
          <em>{programme.jupas_code} · {institutionLabel(programme.institution)}</em>
        </a>
        {instSite ? (
          <a
            className="official-link"
            href={instSite}
            target="_blank"
            rel="noopener noreferrer"
          >
            <strong>{t("detail.programmeWebsite")}</strong>
            <em>{shortenUrl(instSite)}</em>
          </a>
        ) : (
          <span className="official-link disabled" title={t("detail.noWebsiteRecord")}>
            <strong>{t("detail.programmeWebsite")}</strong>
            <em>{t("detail.notOnRecord")}</em>
          </span>
        )}
      </div>
    </section>
  );
}

function shortenUrl(url: string): string {
  try {
    const u = new URL(url);
    return u.host.replace(/^www\./, "") + (u.pathname.length > 1 ? u.pathname : "");
  } catch {
    return url;
  }
}

function AuditRows({ candidates, formula, basisYear, t, lang }: { candidates: CandidateScore[]; formula?: string | null; basisYear: "2025" | "2026"; t: Translate; lang: Lang }) {
  const sorted = [...candidates].sort(
    (a, b) => Number(b.used) - Number(a.used) || b.weightedScore - a.weightedScore
  );
  const used = sorted.filter((c) => c.used);

  return (
    <div className="score-audit" onClick={(event) => event.stopPropagation()}>
      <p className="score-audit-method">
        <em>{t("detail.methodBasis", { year: basisYear })}</em>
        <span>{formula || t("detail.bestSubjects")}</span>
        <b>{t("detail.counted", { used: used.length, total: sorted.length })}</b>
      </p>
      <ol className="audit-rows" aria-label={t("detail.breakdownAria")}>
        {sorted.map((candidate) => {
            // Bonus % (e.g. "+0.1x" → 10) shown in the tag, so the weight
            // cell can stay the plain "grade × weight" and the score is the
            // bonus value. % bonuses (HKUST) keep their own value string.
            const bonusPct =
              candidate.isBonus && !candidate.bonusValue?.includes("%")
                ? Math.round(parseFloat((candidate.bonusValue || "").replace(/[^0-9.]/g, "")) * 100)
                : null;
            const tag = candidate.isCompulsory
              ? t("detail.tag.compulsory")
              : candidate.isBonus
                ? bonusPct != null ? t("detail.tag.bonusPct", { pct: bonusPct }) : t("detail.tag.bonus")
                : candidate.isBestOfPool
                  ? t("detail.tag.bestOfPool")
                  : candidate.used
                    ? t("detail.tag.selected")
                    : t("detail.tag.notCounted");
            const weightLabel =
              candidate.isBonus && candidate.bonusValue?.includes("%")
                ? candidate.bonusValue
                : `× ${candidate.multiplier}`;
            return (
              <li
                key={`${candidate.subject}-${candidate.grade}-${candidate.weightedScore}`}
                className={"audit-cell " + (candidate.used ? "used" : "unused") + (candidate.isBonus ? " is-bonus" : "")}
              >
                <span className="audit-cell-subject">
                  <strong>{localizedShortSubject(candidate.subject, lang)}</strong>
                  <small>{tag}</small>
                </span>
                <span className="audit-cell-grade">
                  <em>{t("detail.grade")}</em>
                  <b>{candidate.grade}</b>
                </span>
                <span className="audit-cell-calc">
                  <em>{t("detail.weight")}</em>
                  <b>{candidate.basePoints.toFixed(1)} {weightLabel}</b>
                </span>
                <span className="audit-cell-score">
                  <em>{t("detail.score")}</em>
                  <b>{candidate.weightedScore.toFixed(2)}</b>
                </span>
              </li>
            );
          })}
        </ol>
    </div>
  );
}

function OffersBlock({ programme }: { programme: Programme }) {
  const { t } = useLang();
  const [open, setOpen] = useState(false);
  const stats = programme.offer_statistics || [];

  const appsByYear = new Map<number, OfferStatistic>();
  const offersByYear = new Map<number, OfferStatistic>();
  for (const row of stats) {
    if (!row.Year || row.Year === 0) continue;
    if (row.Type === "Application") appsByYear.set(row.Year, row);
    else if (row.Type === "Offer") offersByYear.set(row.Year, row);
  }
  const years = Array.from(new Set([...offersByYear.keys(), ...appsByYear.keys()])).sort((a, b) => b - a);
  if (years.length === 0) return null;

  const latestYear = years[0];
  const latestApps = (appsByYear.get(latestYear)?.["Band A"] as number | undefined) ?? 0;
  const latestOffers = (offersByYear.get(latestYear)?.["Band A"] as number | undefined) ?? 0;
  const latestRate = latestApps > 0 ? (latestOffers / latestApps) * 100 : null;

  let competition: string | null = null;
  if (latestOffers > 0 && latestApps > 0) {
    const ratio = latestApps / latestOffers;
    if (ratio >= 1.5) {
      competition = t("detail.compeRatio", { ratio: ratio.toFixed(1) });
    } else if (ratio >= 0.9) {
      competition = t("detail.compeEven");
    } else {
      competition = t("detail.compeFewer");
    }
  } else if (latestOffers === 0 && latestApps > 0) {
    competition = t("detail.compeNone", { year: latestYear });
  }

  return (
    <section className="offers-card formula-card">
      <div className="offers-card-eyebrow">
        <span>{t("detail.bandAOffers", { year: latestYear })}</span>
        {latestRate !== null ? (
          <b className="tally-badge offers-tally">{t("detail.rate", { rate: latestRate.toFixed(1) })}</b>
        ) : null}
      </div>
      <p className="formula-text">
        {t("detail.offersOfApps", { offers: latestOffers, apps: latestApps.toLocaleString() })}
      </p>
      {competition ? <small>{competition}</small> : null}

      <hr className="weight-divider" />
      <button
        type="button"
        className={"weight-toggle" + (open ? " open" : "")}
        aria-expanded={open}
        onClick={() => setOpen((v) => !v)}
      >
        {open ? t("detail.hideHistory", { n: years.length }) : t("detail.showHistory", { n: years.length })}
        <svg width="14" height="14" viewBox="0 0 16 16" fill="none" aria-hidden="true">
          <polyline points="3,5 8,11 13,5" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round"/>
        </svg>
      </button>

      {open ? (
        <div className="offers-body">
          <div className="offers-table" role="table" aria-label={t("detail.offerHistoryAria")}>
            <div className="offers-table-head" role="row">
              <span role="columnheader">{t("detail.col.year")}</span>
              <span role="columnheader">{t("detail.col.bandAApps")}</span>
              <span role="columnheader">{t("detail.col.offers")}</span>
              <span role="columnheader">{t("detail.col.rate")}</span>
            </div>
            {years.map((year) => {
              const appN = (appsByYear.get(year)?.["Band A"] as number | undefined) ?? 0;
              const offerN = (offersByYear.get(year)?.["Band A"] as number | undefined) ?? 0;
              const rate = appN > 0 ? (offerN / appN) * 100 : null;
              return (
                <div className="offers-table-row" role="row" key={year}>
                  <span role="cell" className="offers-table-year">{year}</span>
                  <span role="cell" className="offers-table-cell"><b>{appN}</b></span>
                  <span role="cell" className="offers-table-cell"><b>{offerN}</b></span>
                  <span role="cell" className="offers-table-cell accent">
                    <b>{rate !== null ? `${rate.toFixed(1)}%` : "–"}</b>
                  </span>
                </div>
              );
            })}
          </div>
        </div>
      ) : null}
    </section>
  );
}

function EligibilityBlock({
  eligible,
  details,
  desktopOpen,
  showPassed,
  onToggleDesktopOpen,
  onTogglePassed,
  t,
  lang,
}: {
  eligible: boolean;
  details: EligibilityDetail[];
  desktopOpen: boolean;
  showPassed: boolean;
  onToggleDesktopOpen: () => void;
  onTogglePassed: () => void;
  t: Translate;
  lang: Lang;
}) {
  const failed = details.filter((d) => !d.pass);
  const passed = details.filter((d) => d.pass);
  const sorted = [...failed, ...passed];
  const visibleRows = eligible || showPassed ? sorted : failed;

  // The eligibility rows are produced in the data worker (no language context),
  // so their fixed labels/values arrive in English; localize the known set here.
  const ELIG_LABEL: Record<string, string> = {
    CHI: "elig.chi", ENG: "elig.eng", MATH: "elig.math", CSD: "elig.csd",
    "Elective 1": "elig.elective1", "Elective 2": "elig.elective2",
  };
  const eligLabel = (label: string) => (ELIG_LABEL[label] ? t(ELIG_LABEL[label]) : label);
  const eligValue = (v?: string) =>
    !v ? t("detail.na") : v === "N/A" ? t("detail.na") : v === "None" ? t("elig.none") : v;

  const toggleLabel = eligible
    ? (desktopOpen ? t("detail.hideChecks", { n: details.length }) : t("detail.showChecks", { n: details.length }))
    : (desktopOpen ? t("detail.hideUnmet", { n: visibleRows.length }) : t("detail.showUnmet", { n: visibleRows.length }));

  return (
    <section
      className={"eligibility-card formula-card" + (eligible ? " all-passed" : " has-unmet")}
      data-all-passed={eligible ? "true" : "false"}
    >
      <div className="eligibility-card-eyebrow">
        <span>{t("detail.eligibility")}</span>
        <b className={"tally-badge eligibility-block-tally " + (eligible ? "good" : "bad")}>
          {eligible
            ? t("detail.passTally", { n: details.length, total: details.length })
            : t("detail.unmetTally", { failed: failed.length, total: details.length })}
        </b>
      </div>

      <hr className="weight-divider" />
      <button
        type="button"
        className={"weight-toggle" + (desktopOpen ? " open" : "")}
        aria-expanded={desktopOpen}
        onClick={onToggleDesktopOpen}
      >
        {toggleLabel}
        <svg width="14" height="14" viewBox="0 0 16 16" fill="none" aria-hidden="true">
          <polyline points="3,5 8,11 13,5" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round"/>
        </svg>
      </button>

      <div className={"eligibility-body" + (desktopOpen ? " desktop-open" : "")}>
        <ol className="eligibility-rows" aria-label={t("detail.checksAria")}>
          {visibleRows.map((detail) => (
            <li key={detail.label} className={"eligibility-cell " + (detail.pass ? "pass" : "fail")}>
              <span className="eligibility-cell-mark" aria-hidden="true">
                {detail.pass ? "✓" : "✕"}
              </span>
              <span className="eligibility-cell-subject">{eligLabel(detail.label)}</span>
              <span className="eligibility-cell-have">
                {detail.got?.toLowerCase() === "none" ? null : <em>{t("detail.have")}</em>}
                <b>{eligValue(detail.got)}</b>
              </span>
              <span className="eligibility-cell-need">
                <em>{t("detail.need")}</em>
                <b>{detail.need ? eligValue(detail.need) : "–"}</b>
              </span>
              {detail.note ? <span className="eligibility-cell-note">{localizeElectiveNote(detail.note, lang)}</span> : null}
            </li>
          ))}
        </ol>

        {!eligible && passed.length > 0 ? (
          <button type="button" className="eligibility-passed-toggle" onClick={onTogglePassed}>
            {showPassed
              ? t("detail.hidePassed", { n: passed.length })
              : t("detail.showPassed", { n: passed.length })}
          </button>
        ) : null}
      </div>
    </section>
  );
}

function isNewProgramme(result: ProgrammeResult): boolean {
  // A programme is "new for 2026" when JUPAS has published it but has no
  // 2025 admissions data on record yet: no Application/Offer rows in
  // offer_statistics, AND no 2025 score figures.
  const stats = result.programme.offer_statistics || [];
  const hasHistorical = stats.some((s) => s.Type === "Application" || s.Type === "Offer");
  if (hasHistorical) return false;
  const s = result.programme.scores_2025 || {};
  const anyScore =
    (s as { median?: number | null }).median != null ||
    (s as { lq?: number | null }).lq != null ||
    (s as { uq?: number | null }).uq != null ||
    (s as { mean?: number | null }).mean != null;
  return !anyScore;
}

// Thin alias over the shared slotLabel so every surface agrees on the
// JUPAS choice labels (A1–A3, B4–B6, C7–C10, D11–D15, E16–E20).
function prioritySlot(index: number) {
  return slotLabel(index);
}

// "What changed for 2026" callout. Renders the noise-filtered year_changes diff
// computed in the data pipeline as plain-language lines. Weighting changes are
// grouped by transition (e.g. "13 subjects: ×5 → ×7") so broad rescales stay
// readable; small groups list the subjects.
function YearChangesPanel({ yc, note, t, lang }: { yc: YearChanges; note: string; t: Translate; lang: Lang }) {
  const lines: string[] = [];

  for (const it of yc.items) {
    if (it.type === "formula_count") {
      lines.push(t("detail.changes.formulaCount", { from: t(`detail.formulaId.${it.from_id}`), to: t(`detail.formulaId.${it.to_id}`) }));
    } else if (it.type === "compulsory_added") {
      lines.push(t("detail.changes.compulsoryAdded", { subject: localizedShortSubject(it.subject, lang) }));
    } else if (it.type === "compulsory_removed") {
      lines.push(t("detail.changes.compulsoryRemoved", { subject: localizedShortSubject(it.subject, lang) }));
    }
  }

  // Group weighting items by (from → to) transition.
  const groups = new Map<string, { from: number; to: number; subjects: string[] }>();
  for (const it of yc.items) {
    if (it.type !== "weighting") continue;
    const key = `${it.from}->${it.to}`;
    const g = groups.get(key) ?? { from: it.from, to: it.to, subjects: [] };
    g.subjects.push(localizedShortSubject(it.subject, lang));
    groups.set(key, g);
  }
  for (const g of groups.values()) {
    lines.push(
      g.subjects.length <= 3
        ? t("detail.changes.weighting", { subjects: g.subjects.join(", "), from: g.from, to: g.to })
        : t("detail.changes.weightingMany", { n: g.subjects.length, from: g.from, to: g.to })
    );
  }

  if (yc.items.some((it) => it.type === "pool")) lines.push(t("detail.changes.pool"));
  if (!lines.length) return null;

  return (
    <div className="year-changes-card">
      <span className="year-changes-title">{t("detail.changes.title")}</span>
      <ul className="year-changes-list">
        {lines.map((line, i) => (
          <li key={i}>{line}</li>
        ))}
      </ul>
      <small className="year-changes-note">{note}</small>
    </div>
  );
}

// HKUST's scoring is a sequential graded-pool formula — English/Math ×2, then a
// tiered "best from {pool}" (e.g. Physics ×2 / ICT ×1.5 / Bio·Chem ×1), then
// best-of-other pools (M1/M2 ×2, else ×1), optionally a `better_of`. The flat
// subject_weights/best_of fields flatten this WRONGLY (Bio/Chem look fixed, the
// pool splits into separate best-1 chips), so the breakdown renders from the
// authoritative `hkust_formula_steps` instead, mirroring HKUST's own brochure.
const HKUST_SUBJ_ALIAS: Record<string, string> = {
  "Mathematics Compulsory Part": "Mathematics (Compulsory Part)",
  "Mathematics Extended Part (Algebra and Calculus) - Module 2": "Mathematics Extended Part (Module 2)",
  "Mathematics Extended Part (Calculus and Statistics) - Module 1": "Mathematics Extended Part (Module 1)",
};
function hkSubjLabel(name: string, lang: Lang): string {
  return localizedShortSubject(HKUST_SUBJ_ALIAS[name] ?? name, lang);
}
// Join a subject set for display, collapsing M1 + M2 → "M1/M2".
function hkSubjList(subjects: string[], lang: Lang): string {
  const canon = subjects.map((s) => HKUST_SUBJ_ALIAS[s] ?? s);
  const labels = canon.filter((s) => !s.includes("Module 1") && !s.includes("Module 2")).map((s) => localizedShortSubject(s, lang));
  const hasM1 = canon.some((s) => s.includes("Module 1"));
  const hasM2 = canon.some((s) => s.includes("Module 2"));
  if (hasM1 && hasM2) labels.push("M1／M2");
  else if (hasM1) labels.push("M1");
  else if (hasM2) labels.push("M2");
  return labels.join("／");
}
type HkTier = { subjects: string; weight: number };
type HkGroup = { label: string; tiers: HkTier[] };
// Turn a run of best_from_pool steps into display groups: each filtered pool is
// its own group ("Best 1 from …" + tiers); consecutive unfiltered pools merge
// into one "Best N other subjects" group (+ an implicit ×1 "other" tier).
function hkPoolGroups(poolSteps: HkustFormulaStep[], lang: Lang, t: Translate): HkGroup[] {
  const groups: HkGroup[] = [];
  let otherCount = 0;
  let otherTiers: HkTier[] = [];
  const flush = () => {
    if (otherCount === 0) return;
    groups.push({ label: t("detail.hkust.bestOther", { count: otherCount }), tiers: [...otherTiers, { subjects: t("detail.hkust.other"), weight: 1 }] });
    otherCount = 0;
    otherTiers = [];
  };
  for (const step of poolSteps) {
    if (step.subject_filter && step.subject_filter.length > 0) {
      flush();
      groups.push({
        label: t("detail.hkust.bestFrom", { subjects: hkSubjList(step.subject_filter, lang) }),
        tiers: (step.weights ?? []).map((w) => ({ subjects: hkSubjList(w.subjects, lang), weight: w.weight })),
      });
    } else {
      otherCount += 1;
      for (const w of step.weights ?? []) {
        const subjects = hkSubjList(w.subjects, lang);
        if (!otherTiers.some((ti) => ti.subjects === subjects && ti.weight === w.weight)) otherTiers.push({ subjects, weight: w.weight });
      }
    }
  }
  flush();
  return groups;
}
function HkGroupRows({ group }: { group: HkGroup }) {
  return (
    <div className="weight-hkust-group">
      <div className="weight-hkust-group-head">{group.label}</div>
      {group.tiers.map((tier, i) => (
        <div key={i} className="weight-hkust-row weight-hkust-tier">
          <span>{tier.subjects}</span>
          <span>x{tier.weight}</span>
        </div>
      ))}
    </div>
  );
}
function HkustBreakdown({ steps, lang, t }: { steps: HkustFormulaStep[]; lang: Lang; t: Translate }) {
  const required = steps.filter((s) => s.type === "required");
  const topGroups = hkPoolGroups(steps.filter((s) => s.type === "best_from_pool"), lang, t);
  const betterOf = steps.find((s) => s.type === "better_of");
  return (
    <div className="weight-hkust">
      {required.map((r, i) => (
        <div key={`r${i}`} className="weight-hkust-row">
          <span>{hkSubjLabel(r.subject ?? "", lang)}</span>
          <span>x{r.weight}</span>
        </div>
      ))}
      {topGroups.map((g, i) => <HkGroupRows key={`g${i}`} group={g} />)}
      {betterOf?.options ? (
        <div className="weight-hkust-betterof">
          <div className="weight-hkust-betterof-head">{t("detail.hkust.betterOf")}</div>
          {betterOf.options.map((opt, oi) => (
            <div key={oi} className="weight-hkust-option">
              <div className="weight-hkust-option-tag">{t("detail.hkust.option", { n: oi + 1 })}</div>
              {hkPoolGroups(opt.filter((s) => s.type === "best_from_pool"), lang, t).map((g, gi) => <HkGroupRows key={gi} group={g} />)}
            </div>
          ))}
        </div>
      ) : null}
    </div>
  );
}

function FormulaBlock({
  label,
  note,
  extraNote,
  formula,
  rawFormula,
  weights,
  pools,
  steps,
  defaultOpen,
  t,
  lang,
}: {
  label: string;
  note: string;
  extraNote?: string | null;
  formula?: string | null;
  rawFormula?: string | null;
  weights: Record<string, number>;
  pools: Array<{ count: number; subjects: string[]; weight: number }>;
  steps?: HkustFormulaStep[];
  // Show the weight breakdown expanded by default — used for recalculated /
  // simulated programmes, where the plain formula line ("Best 5") doesn't convey
  // the weighting the score actually uses (e.g. EdUHK best-of {BAFS, Econ}).
  defaultOpen?: boolean;
  t: Translate;
  lang: Lang;
}) {
  const hasWeights = (steps && steps.length > 0) || Object.keys(weights).length > 0 || pools.length > 0;
  const [weightsOpen, setWeightsOpen] = useState(defaultOpen ?? false);

  return (
    <div className="formula-card">
      <span>{label}</span>
      <p className="formula-text">{formula || t("detail.formulaNA")}</p>
      {rawFormula ? <small className="formula-official">{t("detail.formulaGen.official", { raw: rawFormula })}</small> : null}
      <small>{note}</small>
      {extraNote ? <small className="formula-official">{extraNote}</small> : null}
      {hasWeights ? (
        <>
          <hr className="weight-divider" />
          <button className={weightsOpen ? "weight-toggle open" : "weight-toggle"} type="button" onClick={() => setWeightsOpen(!weightsOpen)}>
            {t("detail.weightingDetails")}
            <svg width="14" height="14" viewBox="0 0 16 16" fill="none" xmlns="http://www.w3.org/2000/svg">
              <polyline points="3,5 8,11 13,5" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round"/>
            </svg>
          </button>
          {steps && steps.length > 0 ? (
            <div className={weightsOpen ? "weight-cloud" : "weight-cloud collapsed"}>
              <HkustBreakdown steps={steps} lang={lang} t={t} />
            </div>
          ) : (
            <div className={weightsOpen ? "weight-cloud" : "weight-cloud collapsed"}>
              {Object.entries(weights).map(([subject, weight]) => (
                <span key={subject} className="weight-item">
                  <span>{localizedShortSubject(subject, lang)}</span>
                  <span>x{weight}</span>
                </span>
              ))}
              {pools.map((pool, index) => (
                <span key={index} className="weight-item">
                  <span>{t("detail.bestOf", { count: pool.count, subjects: pool.subjects.map((s) => localizedShortSubject(s, lang)).join("/") })}</span>
                  <span>x{pool.weight}</span>
                </span>
              ))}
            </div>
          )}
        </>
      ) : <em className="muted">{t("detail.noWeighting")}</em>}
    </div>
  );
}
