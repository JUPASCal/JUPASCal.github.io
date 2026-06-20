import { useMemo, useState, type ReactNode } from "react";
import { AppHeader } from "./AppHeader";
import { ShareButton } from "./ShareButton";
import { StepperBar } from "./StepperBar";
import { ProfileNameRow } from "./ProfileNameRow";
import { GradeTitleSummary } from "./GradeInput";
import { buildEditUrlFromCurrentHash } from "../lib/hashState";
import { institutionLabel } from "../lib/institutions";
import { analyzePortfolio, riskMeta, riskLabelKey, type PickChance, type Severity } from "../lib/analysis";
import { selectionTypeKey } from "../lib/selection";
import { useLang, pickName } from "../lib/i18n";
import type { Profile, ProgrammeResult, StudentGrades } from "../types/jupas";
import "./AnalysisView.css";

// Fields shared by the standalone page and the in-flow (Step-3 pane) body.
type AnalysisBodyProps = {
  profileName: string;
  results: (ProgrammeResult | null)[];
  // The candidate's raw DSE grades (Chi/Eng/Math/…), shown as a summary row so
  // the advisor can read the profile that produced these scores.
  grades?: StudentGrades;
  profiles?: Profile[];
  activeProfileId?: string;
  onProfileChange?: (id: string) => void;
  // Rename the active profile (pen next to the big name). Absent for received
  // shares (someone else's plan – not editable).
  onRename?: (name: string) => void;
  isReceivedShare?: boolean;
  onSaveAsProfile?: () => void;
  // Tapping a chance card jumps to that programme's DetailPanel.
  onOpenDetail?: (code: string) => void;
  // "page" = standalone share page (shows Copy link / received-share
  // chrome). "inline" = rendered inside the Step-3 stepper pane as the
  // in-flow Analysis step, where sharing lives on the flow footer (so the
  // page-only Copy link / "Calculate your own" chrome is hidden).
  // "console" = the desktop/iPad Advisor Console main panel: the profile
  // name + grades live in the left rail, so the in-body heading name, grades
  // summary and bottom detail CTA are all hidden (rows stay clickable).
  variant?: "page" | "inline" | "console";
  // Reserved slot rendered after the findings (the Advisor Console feeds the
  // alternative-suggestions block here). Ignored by page/inline.
  alternativesSlot?: ReactNode;
  // Phase 2 (alternative suggestions): the precomputed pool + add-to-plan
  // handler. Accepted now so the console can pass them; consumed when the
  // AlternativeSuggestions block is wired in.
  allResults?: ProgrammeResult[];
  onAdd?: (code: string) => void;
  // The "See each programme in detail" CTA (and the received-share "Open in
  // calculator" button). Page: leaves the share view; inline: returns to
  // the Compare list.
  onEdit: () => void;
};

// The page wrapper derives its own onEdit (handleEdit) and is always the
// "page" variant, so those two are omitted from its public props.
type Props = Omit<AnalysisBodyProps, "onEdit" | "variant"> & {
  // Audience variant – AnalysisView is the "advisor" target. Kept on the
  // prop so App can route both share buttons through one prop shape.
  mode?: "advisor" | "social";
  onExitShareMode?: () => void;
  // "Edit Profile" top-bar pill → grade selection of the current profile.
  onEditProfile?: () => void;
  // When true, play the slide-out exit (mirror of the entrance) before
  // the parent unmounts this view.
  exiting?: boolean;
  theme?: "light" | "dark";
  onThemeChange?: (theme: "light" | "dark") => void;
  // Bottom-bar "Share" — switches to the social recap-card view (mirrors
  // the Step-3 Share button). Returns the share URL (copied by ShareButton).
  onShare?: () => Promise<string>;
  // Renders the 1·2·3 stepper bar so Analysis reads as an in-flow "Step 4".
  // Tapping a step exits Analysis and jumps the calculator to that step.
  pickedCount?: number;
  onGoToStep?: (step: 1 | 2 | 3) => void;
};

// Standalone Analysis page (desktop / received share): the full mobile-style
// chrome – header, the 1·2·3 stepper bar (Compare active), the AnalysisBody,
// and a Back/Share footer. On mobile the user's own plan no longer uses this:
// App renders <AnalysisBody variant="inline"> as the Step-3 pane's third
// sub-view so it slides in like every other step (see App.tsx).
export function AnalysisView({
  profileName,
  results,
  grades,
  profiles,
  activeProfileId,
  onProfileChange,
  onRename,
  onExitShareMode,
  onEditProfile,
  exiting,
  isReceivedShare,
  onSaveAsProfile,
  theme,
  onThemeChange,
  onOpenDetail,
  onShare,
  pickedCount,
  onGoToStep,
}: Props) {
  const { t, lang } = useLang();
  async function handleEdit() {
    if (onExitShareMode) {
      onExitShareMode();
      return;
    }
    const editUrl = await buildEditUrlFromCurrentHash();
    window.history.replaceState(null, "", editUrl);
    window.location.reload();
  }

  // Just the count of non-null picks — no need to run the full (heavy) analysis
  // here; AnalysisBody does that once for the body itself.
  const total = results.filter(Boolean).length;

  return (
    <main className={`app-shell layout-mobile share-view analysis-view${exiting ? " is-exiting" : ""}`}>
      <AppHeader theme={theme} onThemeChange={onThemeChange} onEditProfile={onEditProfile} />

      {/* Same stepper bar as Steps 1-3 (Compare stays active) so Analysis
          reads as an in-flow continuation, not a separate page. Tapping a
          step leaves Analysis and jumps the calculator there. */}
      <StepperBar step={3} pickedCount={pickedCount ?? total} onStepChange={onGoToStep ?? (() => {})} />

      <AnalysisBody
        variant="page"
        profileName={profileName}
        results={results}
        grades={grades}
        profiles={profiles}
        activeProfileId={activeProfileId}
        onProfileChange={onProfileChange}
        onRename={onRename}
        isReceivedShare={isReceivedShare}
        onSaveAsProfile={onSaveAsProfile}
        onOpenDetail={onOpenDetail}
        onEdit={handleEdit}
      />

      {/* Floating action bar, mirroring the Step 1-3 footer: Back returns to
          the calculator; Share opens the social recap card. */}
      <footer className="stepper-footer analysis-footer">
        <div className="stepper-footer-left">
          <button type="button" className="ghost-button" onClick={handleEdit}>
            <ArrowIcon /> {t("common.back")}
          </button>
        </div>
        <div className="stepper-footer-right">
          {onShare ? (
            <ShareButton onShare={onShare} label={t("analysis.shareLabel")} title={t("analysis.shareTitle")} />
          ) : null}
        </div>
      </footer>
    </main>
  );
}

// The analysis content itself – panel heading, verdict, per-pick chances,
// findings and the detail CTA, plus the disclaimer. Rendered both inside the
// standalone page (above) and inline as the Step-3 pane's Analysis sub-view.
export function AnalysisBody({
  profileName,
  results,
  grades,
  profiles,
  activeProfileId,
  onProfileChange,
  onRename,
  isReceivedShare,
  onSaveAsProfile,
  onOpenDetail,
  onEdit,
  variant = "page",
  alternativesSlot,
}: AnalysisBodyProps) {
  const { t, lang } = useLang();
  const isConsole = variant === "console";
  // Band B and below are collapsed by default – Band A is what matters.
  const [showLower, setShowLower] = useState(false);
  const [linkCopied, setLinkCopied] = useState(false);
  const analysis = useMemo(() => analyzePortfolio(results, t, lang), [results, t, lang]);
  const { total, eligibleCount, bandA, bandB, findings, verdict } = analysis;
  // "Strong" here = green for its slot (safe/fair): a genuine shot. Amber/
  // orange/red picks (risky / highly risky / unsafe) don't count toward it.
  const realisticA = bandA.filter((p) => p.tier === "safe" || p.tier === "fair").length;

  function handleCreate() {
    window.location.href = window.location.origin + window.location.pathname;
  }

  // Copy the current page URL (already the share link for this view). Only
  // on an explicit click – we no longer auto-copy when entering the page.
  async function handleCopyLink() {
    const url = window.location.href;
    let ok = false;
    try {
      if (navigator.clipboard?.writeText) {
        await navigator.clipboard.writeText(url);
        ok = true;
      }
    } catch {
      // fall through to the legacy path
    }
    if (!ok) {
      try {
        const ta = document.createElement("textarea");
        ta.value = url;
        ta.style.position = "fixed";
        ta.style.opacity = "0";
        document.body.appendChild(ta);
        ta.focus();
        ta.select();
        ok = document.execCommand("copy");
        document.body.removeChild(ta);
      } catch {
        ok = false;
      }
    }
    if (ok) {
      setLinkCopied(true);
      setTimeout(() => setLinkCopied(false), 2000);
    }
  }

  const statsLine = total
    ? t("analysis.stats", { total, eligible: eligibleCount, strong: realisticA, bandA: bandA.length })
    : t("analysis.noPicks");

  return (
    <>
      <section className="panel analysis-panel" aria-label={t("analysis.panelAria")}>
        <div className="panel-heading share-panel-heading">
          <div className="step-title-content">
            <p className="eyebrow">{isReceivedShare ? t("analysis.eyebrowShared") : t("analysis.eyebrowOwn")}</p>
            {/* Console: the profile name + switcher live in the left rail. */}
            {isConsole ? null : (
              <ProfileNameRow
                name={profileName}
                profiles={profiles}
                activeProfileId={activeProfileId}
                onRename={onRename}
                onProfileChange={onProfileChange}
                editable={!isReceivedShare}
              />
            )}
            <p className="share-panel-stats">{statsLine}</p>
          </div>
          <div className="share-panel-actions">
            {isReceivedShare && onSaveAsProfile ? (
              <button type="button" className="ghost-button" onClick={onSaveAsProfile}>
                {t("share.saveAsProfile")}
              </button>
            ) : null}
            {/* Copy link / Open-in-calculator are page-only: inline, sharing
                lives on the flow footer and the calculator is right there. */}
            {variant === "page" && !isReceivedShare ? (
              <button type="button" className="ghost-button" onClick={handleCopyLink}>
                {linkCopied ? t("share.linkCopied") : t("share.copyLink")}
              </button>
            ) : null}
            {variant === "page" && isReceivedShare ? (
              <button type="button" className="ghost-button" onClick={onEdit}>
                {t("share.openInCalc")}
              </button>
            ) : null}
          </div>
        </div>

        <div className="share-panel-body">
          {isReceivedShare ? (
            <div className="analysis-viewmode-badge">
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                <path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z" />
                <circle cx="12" cy="12" r="3" />
              </svg>
              {t("share.viewModeBadge")}
            </div>
          ) : null}

          {/* Console: the full GradeInput is in the left rail, so the summary
              row would be redundant. */}
          {!isConsole && grades && Object.keys(grades).length > 0 ? (
            <section className="analysis-grades">
              <p className="eyebrow">{t("analysis.gradesHeading")}</p>
              <GradeTitleSummary grades={grades} />
            </section>
          ) : null}

          <div className={`analysis-verdict tone-${verdict.tone}`} role="status">
            <span className="analysis-verdict-icon" aria-hidden="true">
              <SeverityIcon severity={verdict.tone} />
            </span>
            <div className="analysis-verdict-text">
              <strong>{verdict.headline}</strong>
              <span>{verdict.sub}</span>
            </div>
          </div>

          {/* Per-pick chances. Band A leads (where most offers land);
              Band B and below are collapsed by default – they rarely
              decide anything. */}
          <section className="analysis-chances">
            <ChanceGroup
              eyebrow={t("analysis.bandAEyebrow")}
              note={t("analysis.bandANote")}
              picks={bandA}
              emptyHint={t("analysis.bandAEmpty")}
              onOpenDetail={onOpenDetail}
            />
            {bandB.length > 0 ? (
              <div className="chance-lower">
                <button
                  type="button"
                  className={`chance-lower-toggle${showLower ? " open" : ""}`}
                  aria-expanded={showLower}
                  onClick={() => setShowLower((v) => !v)}
                >
                  {showLower ? t("analysis.hideLower", { n: bandB.length }) : t("analysis.showLower", { n: bandB.length })}
                  <svg width="13" height="13" viewBox="0 0 16 16" fill="none" aria-hidden="true">
                    <polyline points="3,5 8,11 13,5" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" />
                  </svg>
                </button>
                {showLower ? (
                  <ChanceGroup
                    eyebrow={t("analysis.bandBEyebrow")}
                    note={t("analysis.bandBNote")}
                    picks={bandB}
                    muted
                    onOpenDetail={onOpenDetail}
                  />
                ) : null}
              </div>
            ) : null}
          </section>

          <section className="analysis-findings">
            <div className="analysis-section-head">
              <p className="eyebrow">{t("analysis.keyPoints")}</p>
              <span className="muted">{t("analysis.notes", { n: findings.length })}</span>
            </div>
            <ul className="analysis-finding-list">
              {findings.map((finding) => (
                <li key={finding.id} className={`analysis-finding tone-${finding.severity}`}>
                  <span className="analysis-finding-mark" aria-hidden="true">
                    <SeverityIcon severity={finding.severity} />
                  </span>
                  <div className="analysis-finding-body">
                    <strong>{finding.title}</strong>
                    <p>{finding.detail}</p>
                    {finding.slots && finding.slots.length > 0 ? (
                      <span className="analysis-finding-slots">
                        {finding.slots.map((ref) =>
                          onOpenDetail ? (
                            <button
                              key={ref.code}
                              type="button"
                              className="analysis-slot-chip is-link"
                              onClick={() => onOpenDetail(ref.code)}
                              aria-label={t("analysis.openDetailAria", { code: ref.code, name: ref.slot })}
                            >
                              <b>{ref.slot}</b> · {ref.code}
                            </button>
                          ) : (
                            <span key={ref.code} className="analysis-slot-chip">
                              <b>{ref.slot}</b> · {ref.code}
                            </span>
                          ),
                        )}
                      </span>
                    ) : null}
                  </div>
                </li>
              ))}
            </ul>
          </section>

          {/* Advisor Console feeds the alternative-suggestions block here. */}
          {alternativesSlot ?? null}

          {/* Console rows are already clickable to open detail, so the big
              "see each programme" CTA is dropped there. */}
          {isConsole ? null : (
            <button type="button" className="analysis-detail-cta" onClick={onEdit}>
              <span>{t("analysis.detailCta")}</span>
              <small>{t("analysis.detailCtaSub")}</small>
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                <line x1="5" y1="12" x2="19" y2="12" />
                <polyline points="12 5 19 12 12 19" />
              </svg>
            </button>
          )}
        </div>
      </section>

      <p className="share-disclaimer">{t("analysis.disclaimer")}</p>

      {variant === "page" && isReceivedShare ? (
        <footer className="share-footer">
          <p className="muted">{t("analysis.wantOwn")}</p>
          <button type="button" className="ghost-button" onClick={handleCreate}>
            {t("share.calcYourOwn")}
          </button>
        </footer>
      ) : null}
    </>
  );
}

function ArrowIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <line x1="19" y1="12" x2="5" y2="12" />
      <polyline points="12 19 5 12 12 5" />
    </svg>
  );
}

function ChanceGroup({
  eyebrow,
  note,
  picks,
  muted,
  emptyHint,
  onOpenDetail,
}: {
  eyebrow: string;
  note: string;
  picks: PickChance[];
  muted?: boolean;
  emptyHint?: string;
  onOpenDetail?: (code: string) => void;
}) {
  return (
    <div className={muted ? "chance-group is-muted" : "chance-group"}>
      <div className="chance-group-head">
        <span className="chance-group-eyebrow">{eyebrow}</span>
        <span className="chance-group-note">{note}</span>
      </div>
      {picks.length > 0 ? (
        <ul className="chance-list">
          {picks.map((pick) => (
            <ChanceRow key={pick.slot} pick={pick} onOpenDetail={onOpenDetail} />
          ))}
        </ul>
      ) : emptyHint ? (
        <p className="chance-empty">{emptyHint}</p>
      ) : null}
    </div>
  );
}

function ChanceRow({ pick, onOpenDetail }: { pick: PickChance; onOpenDetail?: (code: string) => void }) {
  const { t, lang } = useLang();
  const meta = chanceMeta(pick);
  const { programme } = pick.result;
  // Soft factors are context, not alarms – a non-academic requirement isn't a
  // risk. The chance tag's colour + the findings carry the actual risk signal.
  const notes: string[] = [];
  if (pick.selection.length > 0) {
    notes.push(pick.selection.map((it) => t(selectionTypeKey(it.type))).join(" · "));
  }
  if (pick.fewPlaces) notes.push(t("analysis.notesFewPlaces"));

  const body = (
    <>
      <span className="chance-slot">{pick.slot}</span>
      <span className="chance-prog">
        <span className="chance-prog-top">
          <strong>{programme.jupas_code}</strong>
          <small>{institutionLabel(programme.institution)}</small>
        </span>
        <em>{pickName(programme, lang)}</em>
        {notes.length > 0 ? <span className="chance-note">{notes.join(" · ")}</span> : null}
      </span>
      <span className={`chance-tag tone-${meta.tone}`}>{t(chanceLabelKey(pick))}</span>
      {onOpenDetail ? (
        <svg className="chance-chevron" width="13" height="13" viewBox="0 0 16 16" fill="none" aria-hidden="true">
          <polyline points="6,3 11,8 6,13" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
      ) : null}
    </>
  );

  // Clickable when a detail handler is provided – opens the programme's
  // DetailPanel in the calculator.
  if (onOpenDetail) {
    return (
      <li>
        <button
          type="button"
          className="chance-row chance-row-button"
          onClick={() => onOpenDetail(programme.jupas_code)}
          aria-label={t("analysis.openDetailAria", { code: programme.jupas_code, name: pickName(programme, lang) })}
        >
          {body}
        </button>
      </li>
    );
  }
  return <li className="chance-row">{body}</li>;
}

function chanceMeta(pick: PickChance): ReturnType<typeof riskMeta> {
  if (pick.isBandA) return riskMeta(pick.tier);
  if (pick.tier === "blocked" || pick.tier === "unknown") return riskMeta(pick.tier);
  if (pick.tier === "risky" || pick.tier === "safe" || pick.tier === "fair") {
    return { label: "Possible", tone: "good" };
  }
  return { label: "Unlikely", tone: "neutral" };
}

function chanceLabelKey(pick: PickChance): string {
  if (pick.isBandA || pick.tier === "blocked" || pick.tier === "unknown") return riskLabelKey(pick.tier);
  if (pick.tier === "risky" || pick.tier === "safe" || pick.tier === "fair") return "risk.lowerPossible";
  return "risk.lowerUnlikely";
}

function SeverityIcon({ severity }: { severity: Severity }) {
  if (severity === "good") {
    return (
      <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
        <path d="M22 11.08V12a10 10 0 1 1-5.93-9.14" />
        <polyline points="22 4 12 14.01 9 11.01" />
      </svg>
    );
  }
  if (severity === "info") {
    return (
      <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
        <circle cx="12" cy="12" r="10" />
        <line x1="12" y1="16" x2="12" y2="12" />
        <line x1="12" y1="8" x2="12.01" y2="8" />
      </svg>
    );
  }
  // critical / warning share the alert-triangle.
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M10.29 3.86 1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z" />
      <line x1="12" y1="9" x2="12" y2="13" />
      <line x1="12" y1="17" x2="12.01" y2="17" />
    </svg>
  );
}
