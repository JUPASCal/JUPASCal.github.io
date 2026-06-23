import { useEffect, useRef, useState } from "react";
import type { ReactNode } from "react";
import type { BenchmarkBand } from "../types/jupas";
import type { Filters, SortKey } from "../lib/results";
import { institutionLabel } from "../lib/institutions";
import { useLang, type Translate } from "../lib/i18n";
import "./FiltersBar.css";


type Props = {
  filters: Filters;
  open: boolean;
  institutions: string[];
  total: number;
  shown: number;
  selectedCount: number;
  selectedOnly: boolean;
  compactResults: boolean;
  deltaMode: "points" | "percent";
  sortKey: SortKey;
  sortDirection: "asc" | "desc";
  showStepEyebrow?: boolean;
  onFiltersChange: (filters: Filters) => void;
  onOpenChange: (open: boolean) => void;
  onSelectedOnlyChange: (selectedOnly: boolean) => void;
  onCompactResultsChange: (compact: boolean) => void;
  onDeltaModeChange: (mode: "points" | "percent") => void;
  onSortChange: (sortKey: SortKey) => void;
  onReviewSelected: () => void;
  onResetSelected: () => void;
  selectedOrder?: ReactNode;
};

const bands: Array<BenchmarkBand | "all"> = ["all", "above-uq", "above-median", "above-lq", "below-lq", "no-score"];
const sortOptions: SortKey[] = ["code", "lq", "median", "uq", "quota"];

export function FiltersBar({ filters, open, institutions, total, shown, selectedCount, selectedOnly, compactResults, deltaMode, sortKey, sortDirection, showStepEyebrow = true, onFiltersChange, onOpenChange, onSelectedOnlyChange, onCompactResultsChange, onDeltaModeChange, onSortChange, onReviewSelected, onResetSelected, selectedOrder }: Props) {
  const { t } = useLang();
  const activeFilterCount = filters.institutions.length + Number(filters.eligibleOnly) + Number(filters.band !== "all") + Number(filters.interview !== "all") + Number(selectedOnly);
  const [sortOpen, setSortOpen] = useState(false);

  // Mobile: while the search input is focused, the four toolbar pills fold into
  // a single stand-in button so the field — and the example tips in its
  // placeholder — get the full row width. Re-expands on blur (Enter, which
  // blurs below; tapping the stand-in; or tapping anywhere away).
  const [searchFocused, setSearchFocused] = useState(false);
  const searchInputRef = useRef<HTMLInputElement | null>(null);
  const sentinelRef = useRef<HTMLDivElement>(null);
  const [isStuck, setIsStuck] = useState(false);

  useEffect(() => {
    if (!showStepEyebrow) return;
    const sentinel = sentinelRef.current;
    if (!sentinel) return;
    const updateStuck = () => {
      setIsStuck(sentinel.getBoundingClientRect().top <= 45);
    };
    const observer = new IntersectionObserver(
      ([entry]) => setIsStuck(!entry.isIntersecting),
      { threshold: 0 },
    );
    observer.observe(sentinel);
    updateStuck();
    const updateSoon = () => window.requestAnimationFrame(updateStuck);
    document.addEventListener("visibilitychange", updateSoon);
    window.addEventListener("pageshow", updateSoon);
    window.addEventListener("focus", updateSoon);
    window.addEventListener("scroll", updateSoon, true);
    return () => {
      observer.disconnect();
      document.removeEventListener("visibilitychange", updateSoon);
      window.removeEventListener("pageshow", updateSoon);
      window.removeEventListener("focus", updateSoon);
      window.removeEventListener("scroll", updateSoon, true);
    };
  }, [showStepEyebrow]);

  // Info popover (mobile) – explains the step + its less-obvious gestures.
  // Mirrors the Step 3 "ⓘ" pattern: a corner button toggling a panel that
  // dismisses on outside click or Escape.
  const [infoOpen, setInfoOpen] = useState(false);
  useEffect(() => {
    if (!infoOpen) return;
    const close = () => setInfoOpen(false);
    const onKey = (event: KeyboardEvent) => { if (event.key === "Escape") setInfoOpen(false); };
    const t = window.setTimeout(() => document.addEventListener("click", close), 0);
    document.addEventListener("keydown", onKey);
    return () => {
      window.clearTimeout(t);
      document.removeEventListener("click", close);
      document.removeEventListener("keydown", onKey);
    };
  }, [infoOpen]);

  return (
    <div className={`${open ? "filters-sticky-group filters-open" : "filters-sticky-group"}${isStuck ? " is-stuck" : ""}`}>
      {showStepEyebrow ? <div ref={sentinelRef} aria-hidden="true" className="sticky-sentinel" /> : null}
      <div className="filters-topline">
        <div className="filters-title">
          {showStepEyebrow ? <p className="eyebrow">{t("filters.eyebrow")}</p> : null}
          <h2>{t("filters.title")}</h2>
          <p className="filters-title-count">{t("filters.count", { shown, total })}</p>
        </div>
        {showStepEyebrow ? (
          <div className="step2-info">
            <button
              type="button"
              className="step2-info-button"
              aria-label={t("filters.aboutStep")}
              aria-expanded={infoOpen}
              onClick={(event) => { event.stopPropagation(); setInfoOpen((v) => !v); }}
            >
              <svg width="15" height="15" viewBox="0 0 16 16" aria-hidden="true">
                <circle cx="8" cy="8" r="7" fill="none" stroke="currentColor" strokeWidth="1.5" />
                <circle cx="8" cy="4.6" r="0.9" fill="currentColor" />
                <path d="M8 7v5" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
              </svg>
            </button>
            {infoOpen ? (
              <div className="step2-info-pop" role="dialog" aria-label={t("filters.howAria")} onClick={(event) => event.stopPropagation()}>
                <p className="step2-info-title">{t("filters.selectingTitle")}</p>
                <p className="step2-info-lede">{t("filters.selectingLede")}</p>
                <ul className="step2-info-list">
                  <li>
                    <span className="step2-info-ic" aria-hidden="true">
                      <svg width="15" height="15" viewBox="0 0 16 16" fill="none"><circle cx="7" cy="7" r="4.3" stroke="currentColor" strokeWidth="1.5"/><path d="M10.4 10.4 14 14" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round"/></svg>
                    </span>
                    <span><b>{t("filters.tip.search.b")}</b>{t("filters.tip.search.t")}</span>
                  </li>
                  <li>
                    <span className="step2-info-ic" aria-hidden="true">
                      <svg width="15" height="15" viewBox="0 0 16 16" fill="none"><path d="M2 4h12M4 8h8M6 12h4" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round"/></svg>
                    </span>
                    <span><b>{t("filters.tip.filter.b")}</b>{t("filters.tip.filter.t")}</span>
                  </li>
                  <li>
                    <span className="step2-info-ic" aria-hidden="true">
                      <svg width="15" height="15" viewBox="0 0 16 16" fill="none"><path d="M3 4h10M3 8h10M3 12h10" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round"/></svg>
                    </span>
                    <span><b>{t("filters.tip.compact.b")}</b>{t("filters.tip.compact.t")}</span>
                  </li>
                  <li>
                    <span className="step2-info-ic" aria-hidden="true">
                      <svg width="15" height="15" viewBox="0 0 16 16" fill="none"><path d="M4.5 4.5 11.5 11.5" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round"/><circle cx="5" cy="5" r="1.6" stroke="currentColor" strokeWidth="1.4"/><circle cx="11" cy="11" r="1.6" stroke="currentColor" strokeWidth="1.4"/></svg>
                    </span>
                    <span><b>{t("filters.tip.delta.b")}</b>{t("filters.tip.delta.t")}</span>
                  </li>
                  <li>
                    <span className="step2-info-ic" aria-hidden="true">
                      <svg width="15" height="15" viewBox="0 0 16 16" fill="none"><path d="M3.5 8.5 6.5 11.5 12.5 4.5" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round"/></svg>
                    </span>
                    <span><b>{t("filters.tip.tap.b")}</b>{t("filters.tip.tap.t")}</span>
                  </li>
                  <li>
                    <span className="step2-info-ic" aria-hidden="true">
                      <svg width="15" height="15" viewBox="0 0 16 16"><g fill="currentColor"><circle cx="6" cy="4" r="1"/><circle cx="10" cy="4" r="1"/><circle cx="6" cy="8" r="1"/><circle cx="10" cy="8" r="1"/><circle cx="6" cy="12" r="1"/><circle cx="10" cy="12" r="1"/></g></svg>
                    </span>
                    <span><b>{t("filters.tip.drag.b")}</b>{t("filters.tip.drag.t")}</span>
                  </li>
                  <li>
                    <span className="step2-info-ic" aria-hidden="true">
                      <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><path d="M3 6h18M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2m3 0v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6"/></svg>
                    </span>
                    <span><b>{t("filters.tip.remove.b")}</b>{t("filters.tip.remove.t")}</span>
                  </li>
                </ul>
              </div>
            ) : null}
          </div>
        ) : null}
        <div className="filters-controls">
          <div className="search-row">
            <label className="search-field">
              <span>{t("filters.programmeSearch")}</span>
              <input
                ref={searchInputRef}
                value={filters.query}
                placeholder={t("filters.searchPlaceholder")}
                onChange={(event) => onFiltersChange({ ...filters, query: event.target.value })}
                onFocus={() => setSearchFocused(true)}
                onBlur={() => setSearchFocused(false)}
                onKeyDown={(event) => {
                  // Enter dismisses the on-screen keyboard (iPad) — there's no
                  // submit, results filter live, so blur is the useful action.
                  if (event.key === "Enter") {
                    event.preventDefault();
                    event.currentTarget.blur();
                  }
                }}
              />
              {filters.query ? (
                <button
                  type="button"
                  className="search-clear"
                  aria-label={t("filters.clearSearch")}
                  onClick={() => onFiltersChange({ ...filters, query: "" })}
                >
                  <svg width="14" height="14" viewBox="0 0 16 16" fill="none" aria-hidden="true">
                    <path d="M4 4l8 8M12 4l-8 8" stroke="currentColor" strokeWidth="1.85" strokeLinecap="round"/>
                  </svg>
                </button>
              ) : null}
            </label>
            {/* Toolbar group: transparent (display:contents) on desktop so the
                console layout is unchanged; a single segmented "( | | | )"
                control on mobile to save space (shared border, divided cells). */}
            <div className={searchFocused ? "search-toolbar is-collapsed" : "search-toolbar"}>
            {/* Mobile-only stand-in: the single small button the four pills fold
                into while the search field is focused. Tapping it blurs the
                input, which re-expands the group. Hidden on desktop + when not
                collapsed (CSS). */}
            <button
              type="button"
              className="search-toolbar-expand"
              aria-label={t("filters.showTools")}
              tabIndex={-1}
              onMouseDown={(event) => event.preventDefault()}
              onClick={() => searchInputRef.current?.blur()}
            >
              <svg width="16" height="16" viewBox="0 0 16 16" fill="none" aria-hidden="true">
                <circle cx="3.4" cy="8" r="1.25" fill="currentColor" />
                <circle cx="8" cy="8" r="1.25" fill="currentColor" />
                <circle cx="12.6" cy="8" r="1.25" fill="currentColor" />
              </svg>
            </button>
            <button
              className={compactResults ? "compact-toggle active" : "compact-toggle"}
              type="button"
              aria-pressed={compactResults}
              title={compactResults ? t("filters.compactToComfort") : t("filters.compactToRows")}
              onClick={() => onCompactResultsChange(!compactResults)}
            >
              <svg width="16" height="16" viewBox="0 0 16 16" fill="none" aria-hidden="true">
                <path d="M3 4h10M3 8h10M3 12h10" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round"/>
              </svg>
              <span>{t("filters.compact")}</span>
            </button>
            {/* Mobile-only single-icon % toggle (the desktop console uses the
                segmented .delta-toggle below). Flips the benchmark diffs — and
                the diff sort — between points and %. */}
            <button
              className={deltaMode === "percent" ? "delta-toggle-icon active" : "delta-toggle-icon"}
              type="button"
              aria-pressed={deltaMode === "percent"}
              aria-label={t("filters.deltaModeAria")}
              title={deltaMode === "percent" ? t("filters.deltaPtsTitle") : t("filters.deltaPctTitle")}
              onClick={() => onDeltaModeChange(deltaMode === "percent" ? "points" : "percent")}
            >
              <span aria-hidden="true">%</span>
            </button>
            <button
              className={sortOpen ? "sort-toggle active" : "sort-toggle"}
              type="button"
              aria-expanded={sortOpen}
              aria-controls="programme-sort-panel"
              title={t("filters.sort")}
              onClick={() => {
                setSortOpen((current) => !current);
                if (open) onOpenChange(false);
              }}
            >
              <svg width="16" height="16" viewBox="0 0 16 16" fill="none" aria-hidden="true">
                <path d="M5 3v10m0 0-2.5-2.5M5 13l2.5-2.5M11 13V3m0 0L8.5 5.5M11 3l2.5 2.5" stroke="currentColor" strokeWidth="1.55" strokeLinecap="round" strokeLinejoin="round"/>
              </svg>
              <span className="sort-toggle-label">{t("filters.sort")}</span>
            </button>
            <div className="delta-toggle" role="group" aria-label={t("filters.deltaModeAria")}>
              <button
                type="button"
                className={deltaMode === "points" ? "active" : ""}
                aria-pressed={deltaMode === "points"}
                title={t("filters.deltaPtsTitle")}
                onClick={() => onDeltaModeChange("points")}
              >
                {t("filters.deltaPts")}
              </button>
              <button
                type="button"
                className={deltaMode === "percent" ? "active" : ""}
                aria-pressed={deltaMode === "percent"}
                title={t("filters.deltaPctTitle")}
                onClick={() => onDeltaModeChange("percent")}
              >
                {t("filters.deltaPct")}
              </button>
            </div>
            <button
              className={open ? "filter-toggle active" : "filter-toggle"}
              type="button"
              aria-expanded={open}
              aria-controls="programme-filter-panel"
              onClick={() => {
                onOpenChange(!open);
                if (!open) setSortOpen(false);
              }}
            >
              <svg width="16" height="16" viewBox="0 0 16 16" fill="none" xmlns="http://www.w3.org/2000/svg" aria-hidden="true">
                <path d="M2 4h12M4 8h8M6 12h4" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round"/>
              </svg>
              <span className="filter-toggle-label">{t("filters.filter")}</span>
              {activeFilterCount ? <span className="filter-badge">{activeFilterCount}</span> : null}
            </button>
            </div>
          </div>
        </div>
      </div>
      {selectedOrder}

      <section
        id="programme-sort-panel"
        className={sortOpen ? "sort-panel" : "sort-panel mobile-closed"}
        aria-label={t("filters.sortPanelAria")}
      >
        <div className="panel-collapse-inner">
        <div className="sort-option-grid">
          {sortOptions.map((option) => (
            <button
              key={option}
              type="button"
              className={sortKey === option ? "pill active" : "pill"}
              onClick={() => onSortChange(option)}
            >
              {sortLabel(t, option)}
              {sortKey === option ? <span className="sort-direction-mark">{sortDirection === "asc" ? "↑" : "↓"}</span> : null}
            </button>
          ))}
        </div>
        </div>
      </section>

      <section
        id="programme-filter-panel"
        className={open ? "filters-panel" : "filters-panel mobile-closed"}
        aria-label={t("filters.panelAria")}
      >
        <div className="panel-collapse-inner">
        <div className="institution-filter-group" aria-label={t("filters.institutionAria")}>
          <button
            className={filters.institutions.length === 0 ? "pill institution-reset active" : "pill institution-reset"}
            type="button"
            onClick={() => onFiltersChange({ ...filters, institutions: [] })}
          >
            {t("filters.all")}
          </button>
          <div className="institution-pills">
            {institutions.map((institution) => (
              <button
                key={institution}
                className={filters.institutions.includes(institution) ? "pill active" : "pill"}
                type="button"
                onClick={() => onFiltersChange({ ...filters, institutions: toggleInstitution(filters.institutions, institution) })}
              >
                {institutionLabel(institution)}
              </button>
            ))}
          </div>
        </div>

        <div className="advanced-filters">
          <button
            type="button"
            className={selectedOnly ? "pill selected-only-pill active" : "pill selected-only-pill"}
            disabled={selectedCount === 0}
            onClick={() => onSelectedOnlyChange(!selectedOnly)}
          >
            {t("filters.selectedOnly")}
          </button>
          <button
            type="button"
            className={filters.eligibleOnly ? "pill active" : "pill"}
            onClick={() => onFiltersChange({ ...filters, eligibleOnly: !filters.eligibleOnly })}
          >
            {t("filters.eligibleOnly")}
          </button>
          <label className="score-range-filter interview-filter">
            <span className="filter-label-text">{t("filters.interview")}</span>
            <select value={filters.interview} onChange={(event) => onFiltersChange({ ...filters, interview: event.target.value as Filters["interview"] })}>
              <option value="all">{t("filters.interviewAny")}</option>
              <option value="after">{t("filters.interviewAfter")}</option>
              <option value="before">{t("filters.interviewBefore")}</option>
            </select>
          </label>
          <label className="score-range-filter">
            <span className="filter-label-text">{t("filters.scoreRange")}</span>
            <select value={filters.band} onChange={(event) => onFiltersChange({ ...filters, band: event.target.value as BenchmarkBand | "all" })}>
              {bands.map((band) => <option key={band} value={band}>{band === "all" ? t("filters.anyScoreRange") : labelBand(t, band)}</option>)}
            </select>
          </label>
        </div>
        </div>
      </section>
    </div>
  );
}

function toggleInstitution(selected: string[], institution: string) {
  if (selected.includes(institution)) return selected.filter((item) => item !== institution);
  return [...selected, institution];
}

function labelBand(t: Translate, band: BenchmarkBand) {
  return {
    "above-uq": t("bandLong.aboveUq"),
    "above-median": t("bandLong.aboveMed"),
    "above-lq": t("bandLong.aboveLq"),
    "below-lq": t("bandLong.belowLq"),
    "no-score": t("bandLong.noScore"),
  }[band];
}

function sortLabel(t: Translate, sortKey: SortKey) {
  return {
    benchmark: t("filters.sort.benchmark"),
    code: t("filters.sort.code"),
    name: "Alphabetical",
    institution: t("results.col.institution"),
    eligibility: t("results.col.status"),
    score: t("results.col.score"),
    lq: t("filters.sort.lqDiff"),
    median: t("filters.sort.medianDiff"),
    uq: t("filters.sort.uqDiff"),
    quota: t("filters.sort.quota"),
  }[sortKey];
}
