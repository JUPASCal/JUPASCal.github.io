import { useMemo, useState } from "react";
import { institutionLabel } from "../lib/institutions";
import { effectiveBenchmarks } from "../lib/results";
import { suggestAlternatives } from "../lib/suggestions";
import { useLang, pickName } from "../lib/i18n";
import type { ProgrammeResult } from "../types/jupas";

// The "alternative / safety suggestions" block of the Advisor Console analysis.
// For the student's risky Band-A picks it lists similar-direction programmes
// they're more likely to get into, each with an "Add to plan" button. Hidden
// entirely when there are no risky Band-A picks; shows a single muted line when
// risky picks exist but nothing suitable was found. Styling reuses the existing
// .chance-* / .analysis-* idioms (see AnalysisView.css).

// Remember whether the collapsible (mobile) suggestions section is expanded, so
// it doesn't re-collapse every time the analysis re-renders / is revisited.
const SUGGEST_OPEN_KEY = "jupas-staging-suggest-open";

// How many suggestions to show before the "show more" reveal.
const INITIAL_VISIBLE = 4;

type Props = {
  results: (ProgrammeResult | null)[];
  allResults: ProgrammeResult[];
  onAdd?: (code: string) => void;
  // Replace the risky pick this backs up (forSlotIndex) with the suggestion.
  onSwap?: (slotIndex: number, code: string) => void;
  onOpenDetail?: (code: string) => void;
  readOnly?: boolean;
  // Mobile: show the block as a default-collapsed, tap-to-expand section (space
  // is tight on the Step-3 pane). Desktop omits this → always expanded.
  collapsible?: boolean;
};

export function AlternativeSuggestions({ results, allResults, onAdd, onSwap, onOpenDetail, readOnly, collapsible }: Props) {
  const { t, lang } = useLang();
  const { show, suggestions } = useMemo(
    () => suggestAlternatives(results, allResults),
    [results, allResults],
  );
  const [open, setOpen] = useState(() => {
    if (!collapsible) return true; // desktop: always expanded
    try { return localStorage.getItem(SUGGEST_OPEN_KEY) === "1"; } catch { return false; }
  });
  const toggleOpen = () => setOpen((prev) => {
    const next = !prev;
    try { localStorage.setItem(SUGGEST_OPEN_KEY, next ? "1" : "0"); } catch { /* best-effort */ }
    return next;
  });
  const [showAll, setShowAll] = useState(false);

  // Nothing to surface (no risky picks AND no backups found) → hide entirely.
  if (!show) return null;

  const count = suggestions.length > 0
    ? <span className="muted">{t("suggest.note", { n: suggestions.length })}</span>
    : null;

  const visible = showAll ? suggestions : suggestions.slice(0, INITIAL_VISIBLE);

  const body = suggestions.length === 0 ? (
    <p className="suggest-empty muted">{t("suggest.none")}</p>
  ) : (
    <>
      <p className="suggest-intro muted">{t("suggest.intro")}</p>
      <ul className="suggest-list">
            {visible.map((s) => {
              const p = s.result.programme;
              const median = effectiveBenchmarks(p).median;
              const score = s.result.calculation.totalScore;
              const tagLabel = s.band === "uq" ? t("suggest.aboveUq") : t("suggest.aboveMed");
              return (
                <li
                  key={p.jupas_code}
                  className={`suggest-row${onOpenDetail ? " is-clickable" : ""}`}
                  role={onOpenDetail ? "button" : undefined}
                  tabIndex={onOpenDetail ? 0 : undefined}
                  aria-label={onOpenDetail ? t("analysis.openDetailAria", { code: p.jupas_code, name: pickName(p, lang) }) : undefined}
                  onClick={onOpenDetail ? () => onOpenDetail(p.jupas_code) : undefined}
                  onKeyDown={onOpenDetail ? (event) => { if (event.key === "Enter" || event.key === " ") { event.preventDefault(); onOpenDetail(p.jupas_code); } } : undefined}
                >
                  <div className="suggest-main">
                    <div className="suggest-info">
                      <div className="suggest-line">
                        <span className="suggest-code">{p.jupas_code}</span>
                        <span className="suggest-inst">{institutionLabel(p.institution)}</span>
                        <span className="chance-tag tone-good suggest-tag">{tagLabel}</span>
                      </div>
                      <p className="suggest-name">{pickName(p, lang)}</p>
                      <p className="suggest-meta">
                        {t("suggest.forSlot", { slot: s.forSlot, code: s.forCode })}
                        {s.fewPlaces ? " · " + t("suggest.fewPlaces") : ""}
                      </p>
                    </div>
                  </div>
                  {(median != null && score != null) || ((onAdd || onSwap) && !readOnly) ? (
                    <div className="suggest-foot">
                      {median != null && score != null ? (
                        <span className="suggest-stat">
                          <span className="suggest-stat-cell">
                            <span className="suggest-stat-label">{t("suggest.you")}</span>
                            <span className="suggest-stat-you">{score.toFixed(1)}</span>
                          </span>
                          <span className="suggest-stat-div" aria-hidden="true" />
                          <span className="suggest-stat-cell">
                            <span className="suggest-stat-label">{t("suggest.median")}</span>
                            <span className="suggest-stat-med">{String(median)}</span>
                          </span>
                        </span>
                      ) : null}
                      {(onSwap || onAdd) && !readOnly ? (
                        <div className="suggest-actions">
                          {onSwap && !readOnly ? (
                            <button
                              type="button"
                              className="suggest-swap"
                              onClick={(event) => { event.stopPropagation(); onSwap(s.forSlotIndex, p.jupas_code); }}
                              aria-label={t("suggest.swapAria", { code: p.jupas_code, slot: s.forSlot })}
                            >
                              {t("suggest.swap", { slot: s.forSlot })}
                            </button>
                          ) : null}
                          {onAdd && !readOnly ? (
                            <button
                              type="button"
                              className="suggest-add"
                              onClick={(event) => { event.stopPropagation(); onAdd(p.jupas_code); }}
                              aria-label={t("suggest.addAria", { code: p.jupas_code, name: pickName(p, lang) })}
                            >
                              {t("suggest.add")}
                            </button>
                          ) : null}
                        </div>
                      ) : null}
                    </div>
                  ) : null}
                </li>
              );
            })}
          </ul>
          {suggestions.length > INITIAL_VISIBLE ? (
            <button type="button" className="suggest-more" onClick={() => setShowAll((v) => !v)}>
              {showAll ? t("suggest.showFewer") : t("suggest.showMore", { n: suggestions.length - INITIAL_VISIBLE })}
            </button>
          ) : null}
        </>
  );

  return (
    <section className="analysis-suggestions" aria-label={t("suggest.heading")}>
      {collapsible ? (
        <button
          type="button"
          className={`suggest-toggle${open ? " open" : ""}`}
          aria-expanded={open}
          onClick={toggleOpen}
        >
          <span className="eyebrow">{t("suggest.heading")}</span>
          <span className="suggest-toggle-end">
            {count}
            <svg className="suggest-chevron" width="14" height="14" viewBox="0 0 16 16" fill="none" aria-hidden="true">
              <polyline points="3,6 8,11 13,6" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" />
            </svg>
          </span>
        </button>
      ) : (
        <div className="analysis-section-head">
          <p className="eyebrow">{t("suggest.heading")}</p>
          {count}
        </div>
      )}
      {open ? body : null}
    </section>
  );
}
