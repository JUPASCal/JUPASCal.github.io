import { Fragment, useEffect, useRef, useState } from "react";
import type { ReactNode } from "react";
import { institutionLabel } from "../lib/institutions";
import { bandLabelKey, formatDelta, formatPercent } from "../lib/results";
import { slotLabel } from "../lib/slots";
import { useLang, pickName, type Lang, type Translate } from "../lib/i18n";
import { localizedShortSubject } from "../lib/subjectsI18n";
import { getSelection, selectionTypeKey, selectionTimingKey, selectionSalienceKey, translateSelectionText } from "../lib/selection";
import { loadProgrammeDetails, type DescBlock, type ProgrammeDetail } from "../lib/programmeDetails";
import type { CandidateScore, EligibilityDetail, OfferStatistic, Programme, ProgrammeResult } from "../types/jupas";
import "./DetailPanel.css";


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

export function DetailPanel({ results, activeCode, reviewRequest, onActiveCodeChange, onRemove, readOnly = false, previewCode, suggestionSlots, onAddToPlan, onSwapToSlot }: Props) {
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
              <p className="eyebrow">{isSuggested(programme.jupas_code) ? (backupSlotOf(programme.jupas_code) ? t("detail.backupFor", { slot: backupSlotOf(programme.jupas_code)! }) : t("detail.suggested")) : prioritySlot(rawActiveIndex)} · {institutionLabel(programme.institution)} · {programme.jupas_code}</p>
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
              {isNewProgramme(result)
                ? null
                : result.hasScoreData
                  ? t("detail.calc2025")
                  : t("detail.noData2025")}
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
                formula={programme.formula_2025 || programme.formula_2026 || null}
                t={t}
                lang={lang}
              />
            ) : null}
          </div>
          {result.comparisons.length ? (
            <div className="benchmark-grid">
              {result.comparisons.map((comparison) => (
                <div className={comparison.delta >= 0 ? "benchmark-card positive-card" : "benchmark-card negative-card"} key={comparison.key}>
                  <span>{t(`common.${comparison.key}`)}</span>
                  <strong>{comparison.score}</strong>
                  <small>
                    <b>{formatDelta(comparison.delta)}</b>
                    <em>{formatPercent(comparison.percent)}</em>
                  </small>
                </div>
              ))}
            </div>
          ) : <p className="muted">{t("detail.noBenchmark")}</p>}
          {programme.scores_2025?.score_type === "estimated" ? (
            <p className="warning">{t("detail.estimatedNotePre")}<b>{t("detail.estimatedNoteBold")}</b>{t("detail.estimatedNotePost")}</p>
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
        />

        {selection.items.length > 0 ? (
          <>
            <hr className="grade-section-divider" />
            <section className="detail-selection">
              <p className="eyebrow">{t("detail.selection.heading")}</p>
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
          </>
        ) : null}

        <hr className="grade-section-divider" />

        <section>
          <div className="formula-year-grid">
            {isNewProgramme(result) ? null : (
              <FormulaBlock
                label={t("detail.formula2025Label")}
                note={t("detail.formula2025Note")}
                formula={programme.formula_2025}
                weights={programme.subject_weights_2025 || {}}
                pools={programme.best_of_weights_2025 || []}
                t={t}
                lang={lang}
              />
            )}
            <FormulaBlock
              label={t("detail.formula2026Label")}
              note={t("detail.formula2026Note")}
              formula={programme.formula_2026}
              weights={programme.subject_weights_2026 || {}}
              pools={programme.best_of_weights_2026 || []}
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

function AuditRows({ candidates, formula, t, lang }: { candidates: CandidateScore[]; formula?: string | null; t: Translate; lang: Lang }) {
  const sorted = [...candidates].sort(
    (a, b) => Number(b.used) - Number(a.used) || b.weightedScore - a.weightedScore
  );
  const used = sorted.filter((c) => c.used);

  return (
    <div className="score-audit" onClick={(event) => event.stopPropagation()}>
      <p className="score-audit-method">
        <em>{t("detail.method2025")}</em>
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
}: {
  eligible: boolean;
  details: EligibilityDetail[];
  desktopOpen: boolean;
  showPassed: boolean;
  onToggleDesktopOpen: () => void;
  onTogglePassed: () => void;
  t: Translate;
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
              {detail.note ? <span className="eligibility-cell-note">{detail.note}</span> : null}
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

function FormulaBlock({
  label,
  note,
  formula,
  weights,
  pools,
  t,
  lang,
}: {
  label: string;
  note: string;
  formula?: string | null;
  weights: Record<string, number>;
  pools: Array<{ count: number; subjects: string[]; weight: number }>;
  t: Translate;
  lang: Lang;
}) {
  const hasWeights = Object.keys(weights).length > 0 || pools.length > 0;
  const [weightsOpen, setWeightsOpen] = useState(false);

  return (
    <div className="formula-card">
      <span>{label}</span>
      <p className="formula-text">{formula || t("detail.formulaNA")}</p>
      <small>{note}</small>
      {hasWeights ? (
        <>
          <hr className="weight-divider" />
          <button className={weightsOpen ? "weight-toggle open" : "weight-toggle"} type="button" onClick={() => setWeightsOpen(!weightsOpen)}>
            {t("detail.weightingDetails")}
            <svg width="14" height="14" viewBox="0 0 16 16" fill="none" xmlns="http://www.w3.org/2000/svg">
              <polyline points="3,5 8,11 13,5" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round"/>
            </svg>
          </button>
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
        </>
      ) : <em className="muted">{t("detail.noWeighting")}</em>}
    </div>
  );
}
