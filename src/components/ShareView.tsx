import { useRef, useState, useEffect } from "react";
import { toPng } from "html-to-image";
import { AppHeader } from "./AppHeader";
import { ProfileNameRow } from "./ProfileNameRow";
import { ScoreScale } from "./ScoreScale";
import { buildEditUrlFromCurrentHash, readHashState, setShowScoresInHash } from "../lib/hashState";
import { institutionLabel } from "../lib/institutions";
import { bandLabelKey } from "../lib/results";
import { useLang, pickName } from "../lib/i18n";
import type { Profile, ProgrammeResult } from "../types/jupas";

type Props = {
  // Audience variant chosen via one of the two step-3 share buttons.
  // - "advisor": detailed plan view for teachers/parents reviewing.
  // - "social": recap-card view for casual sharing (image / screenshot).
  // Currently both render the same content; the visual differentiation
  // will land alongside the share-card redesign – this prop is threaded
  // through now so we don't have to re-plumb state when that happens.
  mode?: "advisor" | "social";
  profileName: string;
  results: (ProgrammeResult | null)[];
  profiles?: Profile[];
  activeProfileId?: string;
  onProfileChange?: (id: string) => void;
  // Rename the active profile (pen next to the big name). Absent for received
  // shares (someone else's plan – not editable).
  onRename?: (name: string) => void;
  // "Edit Profile" top-bar pill → grade selection of the current profile.
  onEditProfile?: () => void;
  // Optional soft-exit callback. When provided, "Edit this profile"
  // flips the parent app's shareViewMode without a page reload.
  // Falls back to the legacy URL-rewrite + reload path otherwise (used
  // when a recipient lands on the standalone share URL on cold start).
  onExitShareMode?: () => void;
  // When true, play the slide-out exit (mirror of the entrance) before
  // the parent unmounts this view.
  exiting?: boolean;
  // True when the share view is rendering a received share URL (preview
  // profile), not the user's own active profile. Changes header copy and
  // surfaces the "Save as my profile" CTA. The profile switcher is hidden
  // in this mode since it doesn't make sense to switch among someone
  // else's profiles.
  isReceivedShare?: boolean;
  onSaveAsProfile?: () => void;
  // Owner-only: builds a "Share with Teacher / Advisor" link (advisor mode)
  // that opens the analysis dashboard for the recipient. Absent for received
  // shares (the recipient doesn't re-share).
  onBuildAdvisorUrl?: () => Promise<string>;
  // Switch this same plan from the social recap to the advisor analysis view —
  // so a recipient (e.g. a teacher) who opens a shared recap can still see the
  // detailed analysis here.
  onViewAnalysis?: () => void;
  // Forwarded to AppHeader so the share view shows the same dark-mode
  // toggle as the calculator pages. Without these the AppHeader renders
  // the bare logo + info + EN trio and the moon button is missing.
  theme?: "light" | "dark";
  onThemeChange?: (theme: "light" | "dark") => void;
};


export function ShareView({ mode: _mode = "advisor", profileName, results, profiles, activeProfileId, onProfileChange, onRename, onEditProfile, onExitShareMode, exiting, isReceivedShare, onSaveAsProfile, onBuildAdvisorUrl, onViewAnalysis, theme, onThemeChange }: Props) {
  const { t, lang } = useLang();
  const resultsNonNull = results.filter((r): r is ProgrammeResult => r !== null);

  const recapRef = useRef<HTMLDivElement | null>(null);
  const [downloadState, setDownloadState] = useState<"idle" | "rendering" | "done" | "error">("idle");
  // Pre-rendered recap image, cached so a share tap can reach navigator.share()
  // fast enough to keep the tap's transient user-activation. Without it the
  // heavy html-to-image render between click and share() lets the activation
  // lapse, and Android/Samsung then silently refuse to open the share portal.
  const sharePngRef = useRef<File | null>(null);

  async function handleEdit() {
    // Soft path: parent owns view-mode state, just flip it.
    if (onExitShareMode) {
      onExitShareMode();
      return;
    }
    // Legacy path: cold-start recipient view where parent didn't pass the
    // callback. Rewrite the URL to drop the sharing flag and reload.
    const editUrl = await buildEditUrlFromCurrentHash();
    window.history.replaceState(null, "", editUrl);
    window.location.reload();
  }

  function handleCreate() {
    window.location.href = window.location.origin + window.location.pathname;
  }

  const safeFileName = (profileName.replace(/[^a-z0-9-_]+/gi, "_").slice(0, 32) || "jupas-plan");

  async function renderRecapPng(): Promise<string | null> {
    const node = recapRef.current;
    if (!node) return null;
    const cardW = node.offsetWidth;
    const cardH = node.offsetHeight;
    // Export the rounded card on a padded, SOLID background frame. This makes
    // the PNG fully opaque — so it has no transparent corners that show as
    // black/white notches when posted to Instagram Stories — and gives the
    // card's drop shadow room to render instead of being clipped to a hard
    // rectangle. The frame colour follows the page background (theme-aware).
    // pixelRatio 3 keeps it crisp when shared large (~1470px wide).
    const PAD = 44;
    const bg = getComputedStyle(document.body).backgroundColor || "#ffffff";
    // The captured node (`frame`) must NOT carry the offscreen positioning:
    // html-to-image keeps the cloned root's `position`/`left`, so a fixed
    // `left:-99999px` frame would render its content off its own canvas → a
    // blank PNG. So the offscreen positioning lives on an outer `holder`, and
    // the `frame` we capture stays statically positioned.
    const holder = document.createElement("div");
    holder.style.cssText = "position:fixed;left:-99999px;top:0;";
    const frame = document.createElement("div");
    frame.style.cssText = `display:inline-block;padding:${PAD}px;background:${bg};`;
    const clone = node.cloneNode(true) as HTMLElement;
    clone.style.margin = "0";
    clone.style.width = `${cardW}px`;
    frame.appendChild(clone);
    holder.appendChild(frame);
    document.body.appendChild(holder);
    try {
      const w = cardW + PAD * 2;
      const h = cardH + PAD * 2;
      return await toPng(frame, {
        pixelRatio: 3,
        cacheBust: true,
        width: w,
        height: h,
        style: { margin: "0", width: `${w}px`, height: `${h}px` },
      });
    } finally {
      document.body.removeChild(holder);
    }
  }

  // Returns the recap as a File. Uses the pre-rendered cache when available
  // (instant → share() stays inside the tap's activation window); otherwise
  // renders one on the spot (slower; only when the user taps before pre-render
  // finishes). Returns null if rendering failed.
  async function getRecapFile(name: string): Promise<File | null> {
    const cached = sharePngRef.current;
    if (cached) return new File([cached], name, { type: "image/png" });
    const dataUrl = await renderRecapPng();
    if (!dataUrl) return null;
    const blob = await (await fetch(dataUrl)).blob();
    return new File([blob], name, { type: "image/png" });
  }

  async function handleDownload() {
    setDownloadState("rendering");
    try {
      const dataUrl = await renderRecapPng();
      if (!dataUrl) throw new Error("recap card not mounted");
      const link = document.createElement("a");
      link.download = `${safeFileName}-jupas-recap.png`;
      link.href = dataUrl;
      link.click();
      setDownloadState("done");
      window.setTimeout(() => setDownloadState("idle"), 1800);
    } catch (error) {
      console.error("Failed to render recap image", error);
      setDownloadState("error");
      window.setTimeout(() => setDownloadState("idle"), 2400);
    }
  }

  const shareUrl = typeof window !== "undefined" ? window.location.href : "";
  const shareText = t("share.shareText", { name: profileName, count: resultsNonNull.length });

  const [shareState, setShareState] = useState<"idle" | "sharing" | "done" | "error">("idle");
  const [copyState, setCopyState] = useState<"idle" | "done">("idle");
  const [toast, setToast] = useState<{ text: string; tone: "info" | "success" | "error" } | null>(null);

  function showToast(text: string, tone: "info" | "success" | "error" = "success", ms = 2200) {
    setToast({ text, tone });
    window.setTimeout(() => setToast(null), ms);
  }

  // Resilient clipboard write. `navigator.clipboard.writeText` is gated by
  // permission/UA-policy on Firefox + Brave and can reject even from a
  // user-gesture handler. Falls back to the legacy execCommand path which
  // doesn't need permissions. Returns true iff the text actually landed
  // in the clipboard.
  async function copyTextToClipboard(text: string): Promise<boolean> {
    try {
      if (navigator.clipboard?.writeText) {
        await navigator.clipboard.writeText(text);
        return true;
      }
    } catch {
      // Fall through to execCommand fallback below.
    }
    try {
      const ta = document.createElement("textarea");
      ta.value = text;
      ta.setAttribute("readonly", "");
      ta.style.position = "fixed";
      ta.style.top = "0";
      ta.style.left = "0";
      ta.style.width = "1px";
      ta.style.height = "1px";
      ta.style.opacity = "0";
      ta.style.pointerEvents = "none";
      document.body.appendChild(ta);
      ta.focus();
      ta.select();
      ta.setSelectionRange(0, text.length);
      const ok = document.execCommand("copy");
      document.body.removeChild(ta);
      return ok;
    } catch {
      return false;
    }
  }

  async function handleNativeShare() {
    setShareState("sharing");
    try {
      const file = await getRecapFile(`${safeFileName}-jupas-recap.png`);
      // 1) Native share WITH the image (mobile Safari/Chrome, Windows share).
      if (file && navigator.canShare && navigator.canShare({ files: [file] })) {
        // iOS Safari strips the file when files + text/title are combined, so
        // pass files alone there; Android/Samsung keep both.
        await navigator.share(isIOS() ? { files: [file] } : { files: [file], text: shareText });
        setShareState("done");
        showToast(t("share.toast.sheetOpened"), "success");
        window.setTimeout(() => setShareState("idle"), 1500);
        return;
      }
      // 2) No native image-share (desktop Edge / Firefox / browsers without
      //    Web Share for files): hand the user the IMAGE so they can share it
      //    themselves — copy it to the clipboard, else download it. (We don't
      //    fall back to the link here: the point of this button is the image.)
      if (file) {
        const copied = await copyImageToClipboard(file);
        if (copied) {
          setShareState("done");
          showToast(t("share.toast.imgCopied"), "success", 3200);
          window.setTimeout(() => setShareState("idle"), 1500);
          return;
        }
        const a = document.createElement("a");
        a.download = `${safeFileName}-jupas-recap.png`;
        a.href = URL.createObjectURL(file);
        a.click();
        setShareState("done");
        showToast(t("share.toast.imgSaved"), "info", 3600);
        window.setTimeout(() => setShareState("idle"), 1500);
        return;
      }
      // 3) Image couldn't be rendered at all → last resort, copy the link.
      const ok = await copyTextToClipboard(shareUrl);
      showToast(ok ? t("share.toast.linkCopiedShare") : t("share.toast.cantShareDownload"), ok ? "success" : "error", ok ? 2200 : 3600);
      setShareState("done");
      window.setTimeout(() => setShareState("idle"), 1500);
    } catch (error) {
      // User cancelled the share sheet – treat as silent abort.
      if ((error as Error)?.name === "AbortError") {
        setShareState("idle");
        return;
      }
      console.error("Failed to share recap", error);
      setShareState("error");
      showToast(t("share.toast.cantShare"), "error");
      window.setTimeout(() => setShareState("idle"), 2400);
    }
  }

  function openIntent(url: string) {
    window.open(url, "_blank", "noopener,noreferrer");
  }

  function isMobileLike(): boolean {
    if (typeof navigator === "undefined") return false;
    return /android|iphone|ipad|ipod|mobile/i.test(navigator.userAgent);
  }

  function isIOS(): boolean {
    if (typeof navigator === "undefined") return false;
    // iPadOS 13+ reports as "MacIntel" with maxTouchPoints > 1, so we
    // sniff that case too.
    return /iphone|ipad|ipod/i.test(navigator.userAgent) ||
      (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1);
  }

  async function copyImageToClipboard(blob: Blob): Promise<boolean> {
    try {
      if (typeof ClipboardItem === "undefined" || !navigator.clipboard?.write) return false;
      await navigator.clipboard.write([new ClipboardItem({ "image/png": blob })]);
      return true;
    } catch {
      return false;
    }
  }

  // navigator.share() field-strip workaround for iOS Safari. WebKit has a
  // long-standing bug (3+ yrs, surfaced on Apple Dev Forums for FB / WhatsApp
  // / IG) where combining `files` with `title`/`text`/`url` strips the file
  // and shares only the text. On iOS we MUST pass files alone.
  async function shareFilesSafely(file: File, fallbackText: string): Promise<"shared" | "aborted" | "unsupported"> {
    if (!navigator.canShare || !navigator.canShare({ files: [file] })) {
      return "unsupported";
    }
    const payload: ShareData = isIOS() ? { files: [file] } : { files: [file], text: fallbackText };
    try {
      await navigator.share(payload);
      return "shared";
    } catch (e) {
      if ((e as Error)?.name === "AbortError") return "aborted";
      return "unsupported";
    }
  }

  // Instagram Stories: only Web Share API can deliver the image
  // pre-attached on web – IG's direct-prefill (UIPasteboard with custom
  // UTType identifiers) is reachable only from native apps. So we use
  // Web Share with iOS field-strip, and fall back to deep link + clipboard
  // copy when Web Share isn't available (e.g. desktop).
  async function handleInstagramShare() {
    setShareState("sharing");
    try {
      // Filename doubles as the prompt – iOS shows it at the top of the share
      // sheet, named after the destination app. Uses the pre-rendered cache so
      // share() fires within the tap's activation window (Android/Samsung).
      const file = await getRecapFile(`Share-to-Instagram-${safeFileName}.png`);
      if (!file) throw new Error("recap card not mounted");
      const blob: Blob = file;

      // Show the prompt BEFORE invoking the share sheet – the sheet covers
      // most of the screen, and once `await navigator.share()` resolves
      // (after the user picks an app or dismisses), the user has already
      // left the page. A pre-share toast at the top stays visible behind
      // the sheet, where the user can actually read it.
      const willShowSheet = navigator.canShare && navigator.canShare({ files: [file] });
      if (willShowSheet && isMobileLike()) {
        showToast(t("share.toast.pickInstagram"), "success", 30000);
      }

      const result = await shareFilesSafely(file, `${shareText}\n${shareUrl}`);
      if (result === "shared") {
        setToast(null);
        setShareState("done");
        window.setTimeout(() => setShareState("idle"), 1500);
        return;
      }
      if (result === "aborted") {
        setToast(null);
        setShareState("idle");
        return;
      }

      // Web Share unsupported – copy the image to clipboard and open
      // Instagram. (Skip the <a download> on mobile: iOS Safari treats
      // it as a navigation to the data URL and replaces the page, which
      // blocks the deep link from running.)
      const copied = await copyImageToClipboard(blob);
      if (!copied && !isMobileLike()) {
        const a = document.createElement("a");
        a.download = `Share-to-Instagram-${safeFileName}.png`;
        a.href = URL.createObjectURL(file);
        a.click();
      }

      if (isMobileLike()) {
        showToast(t("share.toast.openingInstagram"), "info", 4400);
        window.location.href = "instagram-stories://share";
      } else {
        showToast(
          copied ? t("share.toast.igDesktopCopied") : t("share.toast.igDesktopSaved"),
          "info",
          4200,
        );
        window.open("https://www.instagram.com/", "_blank", "noopener,noreferrer");
      }
      setShareState("done");
      window.setTimeout(() => setShareState("idle"), 1500);
    } catch (error) {
      if ((error as Error)?.name === "AbortError") {
        setShareState("idle");
        return;
      }
      console.error("Failed to share to Instagram", error);
      setShareState("error");
      showToast(t("share.toast.cantShare"), "error");
      window.setTimeout(() => setShareState("idle"), 2400);
    }
  }

  // Threads: Web Share API path is the cleanest – picking Threads from the
  // iOS share sheet delivers the image natively attached to a new post.
  // (Pre-fix the share sheet appeared to work but was stripping the file
  // due to the iOS Safari files+text WebKit bug.) Fallback uses the
  // threads.net/intent/post universal link with clipboard image.
  async function handleThreadsShare() {
    setShareState("sharing");
    try {
      // Filename doubles as the prompt – iOS shows it at the top of the share
      // sheet, named after the destination app. Uses the pre-rendered cache so
      // share() fires within the tap's activation window (Android/Samsung).
      const file = await getRecapFile(`Share-to-Threads-${safeFileName}.png`);
      if (!file) throw new Error("recap card not mounted");
      const blob: Blob = file;

      // Show the prompt BEFORE invoking the share sheet so it stays
      // visible at the top of the screen while the sheet is open.
      const willShowSheet = navigator.canShare && navigator.canShare({ files: [file] });
      if (willShowSheet && isMobileLike()) {
        showToast(t("share.toast.pickThreads"), "success", 30000);
      }

      const result = await shareFilesSafely(file, `${shareText}\n${shareUrl}`);
      if (result === "shared") {
        setToast(null);
        setShareState("done");
        window.setTimeout(() => setShareState("idle"), 1500);
        return;
      }
      if (result === "aborted") {
        setToast(null);
        setShareState("idle");
        return;
      }

      const copied = await copyImageToClipboard(blob);
      if (!copied && !isMobileLike()) {
        const a = document.createElement("a");
        a.download = `Share-to-Threads-${safeFileName}.png`;
        a.href = URL.createObjectURL(file);
        a.click();
      }
      const intentUrl = `https://www.threads.net/intent/post?text=${encodeURIComponent(`${shareText}\n${shareUrl}`)}`;
      window.open(intentUrl, "_blank", "noopener,noreferrer");
      showToast(
        copied ? t("share.toast.threadsPaste") : t("share.toast.threadsAttach"),
        "info",
        4000,
      );
      setShareState("done");
      window.setTimeout(() => setShareState("idle"), 1500);
    } catch (error) {
      if ((error as Error)?.name === "AbortError") {
        setShareState("idle");
        return;
      }
      console.error("Failed to share to Threads", error);
      setShareState("error");
      showToast(t("share.toast.cantShare"), "error");
      window.setTimeout(() => setShareState("idle"), 2400);
    }
  }

  // WhatsApp: same image-first flow as Threads/Instagram. The Web Share sheet
  // is the only way to hand an actual image to WhatsApp from the web (wa.me
  // links carry text only), so we try that first; otherwise copy the image to
  // the clipboard and open WhatsApp with the text/link to paste alongside.
  async function handleWhatsAppShare() {
    setShareState("sharing");
    try {
      // Uses the pre-rendered cache so share() fires within the tap's
      // activation window (Android/Samsung won't open the portal otherwise).
      const file = await getRecapFile(`Share-to-WhatsApp-${safeFileName}.png`);
      if (!file) throw new Error("recap card not mounted");
      const blob: Blob = file;

      const willShowSheet = navigator.canShare && navigator.canShare({ files: [file] });
      if (willShowSheet && isMobileLike()) {
        showToast(t("share.toast.pickWhatsapp"), "success", 30000);
      }

      const result = await shareFilesSafely(file, `${shareText}\n${shareUrl}`);
      if (result === "shared") {
        setToast(null);
        setShareState("done");
        window.setTimeout(() => setShareState("idle"), 1500);
        return;
      }
      if (result === "aborted") {
        setToast(null);
        setShareState("idle");
        return;
      }

      // Web Share unsupported (e.g. desktop): copy the image so it can be
      // pasted, then open WhatsApp with the text + link.
      const copied = await copyImageToClipboard(blob);
      if (!copied && !isMobileLike()) {
        const a = document.createElement("a");
        a.download = `Share-to-WhatsApp-${safeFileName}.png`;
        a.href = URL.createObjectURL(file);
        a.click();
      }
      openIntent(`https://wa.me/?text=${encodeURIComponent(`${shareText}\n${shareUrl}`)}`);
      showToast(
        copied ? t("share.toast.waPaste") : t("share.toast.waAttach"),
        "info",
        4000,
      );
      setShareState("done");
      window.setTimeout(() => setShareState("idle"), 1500);
    } catch (error) {
      if ((error as Error)?.name === "AbortError") {
        setShareState("idle");
        return;
      }
      console.error("Failed to share to WhatsApp", error);
      setShareState("error");
      showToast(t("share.toast.cantShare"), "error");
      window.setTimeout(() => setShareState("idle"), 2400);
    }
  }

  async function handleCopyLink() {
    const ok = await copyTextToClipboard(shareUrl);
    if (ok) {
      setCopyState("done");
      showToast(t("share.toast.linkCopiedClip"), "success");
      window.setTimeout(() => setCopyState("idle"), 1500);
    } else {
      setCopyState("idle");
      showToast(t("share.toast.cantCopyAddr"), "error", 3200);
    }
  }

  // "Share with Teacher / Advisor": builds an advisor-mode link that opens the
  // detailed analysis dashboard for the recipient, then native-shares or copies
  // it. Different from the social buttons above (which share the recap image).
  const [advisorState, setAdvisorState] = useState<"idle" | "working" | "done">("idle");
  async function handleShareAdvisor() {
    if (!onBuildAdvisorUrl) return;
    setAdvisorState("working");
    try {
      const url = await onBuildAdvisorUrl();
      if (navigator.share) {
        await navigator.share({
          title: t("share.advisorShareTitle", { name: profileName }),
          text: t("share.advisorShareText", { name: profileName }),
          url,
        });
        setAdvisorState("done");
        showToast(t("share.toast.sheetOpened"), "success");
      } else {
        const ok = await copyTextToClipboard(url);
        setAdvisorState(ok ? "done" : "idle");
        showToast(
          ok ? t("share.toast.advisorCopied") : t("share.toast.cantCopy"),
          ok ? "success" : "error",
          ok ? 2600 : 3200,
        );
      }
    } catch (error) {
      if ((error as Error)?.name === "AbortError") { setAdvisorState("idle"); return; }
      showToast(t("share.toast.cantShare"), "error");
      setAdvisorState("idle");
    }
    window.setTimeout(() => setAdvisorState("idle"), 1800);
  }

  const supportsNativeShare = typeof navigator !== "undefined" && (typeof navigator.share === "function");
  const [showScores, setShowScores] = useState<boolean>(() => readHashState()?.showScores === true);

  useEffect(() => {
    setShowScoresInHash(showScores);
  }, [showScores]);

  // Pre-render the recap image whenever the plan changes, so a share tap can
  // call navigator.share() immediately (within the tap's activation window) and
  // the OS share portal actually opens on Android/Samsung. Keyed on the visible
  // content (picks + name + score toggle); rendered after a short settle delay.
  const planKey = [0, 1, 2].map((i) => results[i]?.programme.jupas_code ?? "·").join(",") + "|" + profileName + "|" + (showScores ? "s" : "n");
  useEffect(() => {
    let cancelled = false;
    sharePngRef.current = null;
    const t = window.setTimeout(async () => {
      try {
        const dataUrl = await renderRecapPng();
        if (cancelled || !dataUrl) return;
        const blob = await (await fetch(dataUrl)).blob();
        if (cancelled) return;
        sharePngRef.current = new File([blob], `${safeFileName}-jupas-recap.png`, { type: "image/png" });
      } catch {
        // Leave the cache empty; share handlers fall back to a live render.
      }
    }, 350);
    return () => { cancelled = true; window.clearTimeout(t); };
  }, [planKey]); // eslint-disable-line react-hooks/exhaustive-deps

  const downloadLabel =
    downloadState === "rendering"
      ? t("share.dl.rendering")
      : downloadState === "done"
        ? t("share.dl.done")
        : downloadState === "error"
          ? t("share.dl.error")
          : t("share.dl.idle");

  return (
    <main className={`app-shell layout-mobile share-view${exiting ? " is-exiting" : ""}`}>
      <AppHeader theme={theme} onThemeChange={onThemeChange} onEditProfile={onEditProfile} />

      <section className="panel share-panel" aria-label={t("share.panelAria")}>
        <div className="panel-heading share-panel-heading">
          <div className="step-title-content">
            <p className="eyebrow">
              {isReceivedShare ? t("share.eyebrowReceived") : t("share.eyebrowOwn")}
            </p>
            <ProfileNameRow
              name={profileName}
              profiles={profiles}
              activeProfileId={activeProfileId}
              onRename={onRename}
              onProfileChange={onProfileChange}
              editable={!isReceivedShare}
            />
          </div>
          <div className="share-panel-actions">
            {isReceivedShare && onSaveAsProfile ? (
              <button type="button" className="share-action" onClick={onSaveAsProfile}>
                {t("share.saveAsProfile")}
              </button>
            ) : null}
            {/* Own shares: no "Edit this profile" button — back/hardware-back
                returns to Step 3. Received shares keep the only way in. */}
            {isReceivedShare ? (
              <button type="button" className="share-action" onClick={handleEdit}>
                {t("share.openInCalc")}
              </button>
            ) : null}
          </div>
        </div>

        <div className="share-panel-body">
        <div className="recap-card" ref={recapRef} aria-label={t("share.recapAria")}>
          <div className="recap-card-top">
            <span>JUPASCal · 2026</span>
            <b>{profileName}</b>
          </div>

          <div className="recap-bars">
            {["A1", "A2", "A3"].map((slot, index) => {
              const result = results[index] ?? null;
              // Skip empty slots entirely — only filled A1–A3 picks show.
              if (!result) return null;
              return (
                <div key={slot} className={`recap-bar filled band-${result.band}`}>
                  <div className="recap-bar-headline">
                    <span className="recap-bar-slot">{slot}</span>
                    <strong>{result.programme.jupas_code}</strong>
                    <span className="recap-bar-inst">{institutionLabel(result.programme.institution)}</span>
                    <b className={`band ${result.band}`}>{t(bandLabelKey(result.band))}</b>
                    <em className="recap-bar-name">
                      <span className="recap-bar-name-en">{shortenProgrammeName(pickName(result.programme, lang))}</span>
                      {(lang === "zh" ? result.programme.name_en : result.programme.name_zh) ? (
                        <span className="recap-bar-name-zh">{shortenProgrammeName(lang === "zh" ? result.programme.name_en : result.programme.name_zh)}</span>
                      ) : null}
                    </em>
                  </div>
                  <ScoreScale result={result} showScore={showScores} />
                </div>
              );
            })}
          </div>
          <p className="recap-footnote">{t("share.recapFootnote")}</p>
        </div>

        <label className="recap-toggle">
          <input
            type="checkbox"
            checked={showScores}
            onChange={(event) => setShowScores(event.target.checked)}
          />
          <span>{t("share.showScoresToggle")}</span>
        </label>

        <div className="share-action-row" aria-label={t("share.shareThisAria")}>
          <button
            type="button"
            className="share-action icon-only primary"
            onClick={() => handleNativeShare()}
            disabled={shareState === "sharing"}
            aria-label={supportsNativeShare ? t("share.shareViaTitle") : t("share.copyLinkToShare")}
            title={shareState === "sharing" ? t("share.opening") : shareState === "done" ? t("share.shared") : t("share.shareViaTitle")}
          >
            <ShareIcon />
          </button>
          <button
            type="button"
            className="share-action icon-only whatsapp"
            onClick={handleWhatsAppShare}
            aria-label={t("share.shareWhatsapp")}
            title={t("share.whatsapp")}
          >
            <WhatsAppIcon />
          </button>
          <button
            type="button"
            className="share-action icon-only threads"
            onClick={handleThreadsShare}
            aria-label={t("share.shareThreads")}
            title={t("share.threadsTitle")}
          >
            <ThreadsIcon />
          </button>
          <button
            type="button"
            className="share-action icon-only instagram"
            onClick={handleInstagramShare}
            aria-label={t("share.shareInstagram")}
            title={t("share.instagramTitle")}
          >
            <InstagramIcon />
          </button>
          <button
            type="button"
            className="share-action icon-only download"
            onClick={handleDownload}
            disabled={downloadState === "rendering"}
            aria-label={downloadLabel}
            title={downloadLabel}
          >
            <DownloadIcon />
          </button>
          <button
            type="button"
            className="share-action icon-only link"
            onClick={handleCopyLink}
            aria-label={copyState === "done" ? t("share.linkCopied") : t("share.copyLink")}
            title={copyState === "done" ? t("share.linkCopiedBang") : t("share.copyLink")}
          >
            <LinkIcon />
          </button>
        </div>

        {onViewAnalysis ? (
          <button type="button" className="share-action share-view-analysis" onClick={onViewAnalysis}>
            <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
              <line x1="6" y1="20" x2="6" y2="12" />
              <line x1="12" y1="20" x2="12" y2="6" />
              <line x1="18" y1="20" x2="18" y2="14" />
            </svg>
            {t("share.viewAnalysis")}
          </button>
        ) : null}

        {onBuildAdvisorUrl ? (
          <div className="share-advisor">
            <div className="share-advisor-text">
              <strong>{t("share.advisorTitle")}</strong>
              <span>{t("share.advisorDesc")}</span>
            </div>
            <button
              type="button"
              className="share-action share-advisor-btn"
              onClick={handleShareAdvisor}
              disabled={advisorState === "working"}
            >
              <LinkIcon />
              {advisorState === "done" ? t("share.advisorReady") : advisorState === "working" ? t("share.advisorPreparing") : t("share.advisorBtn")}
            </button>
          </div>
        ) : null}
        </div>
      </section>

      <p className="share-disclaimer">{t("share.disclaimer")}</p>

      <footer className="share-footer">
        <p className="muted">{t("share.footerPrompt")}</p>
        <button type="button" className="share-action" onClick={handleCreate}>
          {t("share.calcYourOwn")}
        </button>
      </footer>

      {toast ? (
        <div className={`share-toast share-toast-${toast.tone}`} role="status" aria-live="polite">
          {toast.text}
        </div>
      ) : null}
    </main>
  );
}

function shortenProgrammeName(raw: string | undefined | null): string {
  if (!raw) return "";
  // Trim only the descriptive tail (Features / Majors / 特點 / 主修 …) + the
  // "(Hons)" marker, keeping the core name and its discipline bracket. Stripping
  // ALL brackets cropped Chinese names to just the degree (理學士（生物科學）→
  // 理學士). The card ellipsis-truncates anything still over-long.
  const cleaned = String(raw)
    .replace(/\s*[(（](?:hons|honours|榮譽)[)）]/gi, "")
    .replace(/\s*[(（[［]?\s*(?:features?|majors?|streams?|options?|speciali[sz]ations?|concentrations?|特點|主修|副修|專修|專業|方向|選項)\s*[:：].*$/i, "")
    .replace(/\s{2,}/g, " ")
    .trim();
  return cleaned || String(raw).trim();
}

function ShareIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 16 16" fill="none" aria-hidden="true">
      <path d="M8 1.5v9M4.5 5l3.5-3.5L11.5 5M2 11v3h12v-3" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round"/>
    </svg>
  );
}

function DownloadIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 16 16" fill="none" aria-hidden="true">
      <path d="M8 1.5v9M4 7l4 4 4-4M2 14h12" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round"/>
    </svg>
  );
}

function LinkIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 16 16" fill="none" aria-hidden="true">
      <path d="M9 4l2-2a2.5 2.5 0 0 1 3.5 3.5L12 8M7 12l-2 2a2.5 2.5 0 0 1-3.5-3.5L4 8M6 10l4-4" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/>
    </svg>
  );
}

function WhatsAppIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
      <path d="M17.5 14.4c-.3-.1-1.7-.8-2-.9-.3-.1-.5-.1-.7.1-.2.2-.7.9-.9 1.1-.2.2-.3.2-.6.1-.3-.1-1.2-.5-2.3-1.5-.9-.8-1.4-1.7-1.6-2-.2-.3 0-.5.1-.6.1-.1.3-.3.4-.5.1-.2.2-.3.3-.5.1-.2 0-.4 0-.5-.1-.1-.7-1.6-.9-2.2-.2-.6-.5-.5-.7-.5h-.6c-.2 0-.5.1-.8.4-.3.3-1 1-1 2.5s1 2.9 1.2 3.1c.1.2 2.1 3.3 5.2 4.6.7.3 1.3.5 1.7.6.7.2 1.4.2 1.9.1.6-.1 1.7-.7 2-1.4.2-.7.2-1.2.2-1.4-.1-.2-.3-.3-.6-.4zM12 2C6.5 2 2 6.5 2 12c0 1.8.5 3.5 1.3 4.9L2 22l5.3-1.4c1.4.8 3 1.2 4.7 1.2 5.5 0 10-4.5 10-10S17.5 2 12 2zm0 18c-1.5 0-3-.4-4.2-1.2l-.3-.2-3.1.8.8-3-.2-.3C4.4 14.9 4 13.5 4 12c0-4.4 3.6-8 8-8s8 3.6 8 8-3.6 8-8 8z"/>
    </svg>
  );
}

function ThreadsIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
      <path d="M16.2 11.3c-.1 0-.2-.1-.3-.1-.2-3-1.8-4.7-4.5-4.7-1.6 0-2.9.7-3.7 2l1.4 1c.6-.9 1.4-1.4 2.3-1.4 1.6 0 2.5 1 2.7 2.9-.7-.2-1.4-.3-2.2-.3-2.4 0-3.9 1.1-4.1 2.7-.1.9.3 1.8 1 2.4.7.6 1.6.9 2.6.9 1.4 0 2.5-.5 3.3-1.5.5-.6.8-1.3 1-2.2.7.4 1.2 1 1.4 1.7.4 1-.1 2.5-1.7 3.4-1.4.8-3.7 1.3-6 .1-2.6-1.4-4.1-3.9-4.1-7.3 0-4.6 2.4-7.6 6.1-7.6 4 0 5.7 2.4 6.2 3.9l1.5-.7c-.7-2-2.9-4.8-7.7-4.8C5 1.8 1.8 5.5 1.8 11c0 4.1 1.9 7.4 5.3 9.1 1.5.8 3.2 1.1 4.7 1.1 2 0 3.7-.5 5-1.5 2-1.4 3-3.7 2.4-5.6-.4-1.4-1.4-2.4-2.9-3zm-4.3 3.3c-1.2.1-2.3-.4-2.4-1.2-.1-.6.4-1.3 2.1-1.4h.5c.6 0 1.2.1 1.7.2-.2 1.7-1.1 2.3-1.9 2.4z"/>
    </svg>
  );
}

function InstagramIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <rect x="3" y="3" width="18" height="18" rx="5"/>
      <circle cx="12" cy="12" r="4"/>
      <circle cx="17.5" cy="6.5" r="0.6" fill="currentColor"/>
    </svg>
  );
}
