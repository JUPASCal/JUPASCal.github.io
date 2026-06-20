import { useEffect, useRef, useState } from "react";
import { institutionLabel } from "../lib/institutions";
import { slotLabel } from "../lib/slots";
import { bandLabelKey, formatDelta, formatPercent } from "../lib/results";
import { useMediaQuery, DESKTOP_MEDIA_QUERY } from "../lib/useMediaQuery";
import { useLang, pickName } from "../lib/i18n";
import type { SortKey } from "../lib/results";
import type { BenchmarkKey, ProgrammeResult } from "../types/jupas";

// Windowed-render chunk sizes. INITIAL fills a tall desktop viewport on
// first paint; CHUNK is how many more stream in each time the user nears
// the bottom. Kept generous so scrolling never visibly "waits" for rows.
const WINDOW_INITIAL = 40;
const WINDOW_CHUNK = 40;

type Props = {
  results: ProgrammeResult[];
  selectedCodes: string[];
  activeCode?: string;
  compact: boolean;
  deltaMode?: "points" | "percent";
  sortKey: SortKey;
  sortDirection: "asc" | "desc";
  // View mode: pick/unpick is a no-op and the pick button is hidden.
  // Filtering and sorting stay enabled – those don't mutate the
  // shared profile.
  readOnly?: boolean;
  onFocus: (code: string) => void;
  onPick: (code: string) => void;
  onUnpick: (code: string) => void;
  onSortChange: (sortKey: SortKey) => void;
};

export function ResultsView({ results, selectedCodes, activeCode, compact, deltaMode = "points", sortKey, sortDirection, readOnly = false, onFocus, onPick, onUnpick, onSortChange }: Props) {
  const { t, lang } = useLang();
  const slotByCode = new Map(selectedCodes.map((code, index) => [code, slotLabel(index)]));
  // Render only the view that matches the current viewport instead
  // of building both the desktop table AND the mobile cards for all
  // ~419 results (the CSS hid one, but React still rendered both –
  // 2× the DOM + reconciliation work on every filter/sort change).
  // matchMedia reads synchronously on first render so there's no
  // wrong-view flash. 920px mirrors the CSS breakpoint below.
  const isDesktop = useMediaQuery(DESKTOP_MEDIA_QUERY);

  // Windowed rendering. Building all ~419 rows (table OR cards) in one
  // commit is what made entering Step 2 lag – so we paint an initial
  // chunk immediately and stream the rest in as the user scrolls toward
  // the bottom (an IntersectionObserver sentinel with a generous preload
  // margin keeps it seamless). Resets to the first chunk whenever the
  // list identity changes (filter / sort / data update).
  const [visibleCount, setVisibleCount] = useState(WINDOW_INITIAL);
  // Callback ref so the same sentinel logic works for the table's <tr> and
  // the card list's <div> without ref-type variance gymnastics.
  const sentinelRef = useRef<Element | null>(null);
  const setSentinel = (el: Element | null) => {
    sentinelRef.current = el;
  };

  useEffect(() => {
    setVisibleCount(WINDOW_INITIAL);
  }, [results]);

  useEffect(() => {
    const node = sentinelRef.current;
    if (!node) return;
    const observer = new IntersectionObserver(
      (entries) => {
        if (entries[0]?.isIntersecting) {
          setVisibleCount((current) => Math.min(current + WINDOW_CHUNK, results.length));
        }
      },
      { rootMargin: "800px 0px" },
    );
    observer.observe(node);
    return () => observer.disconnect();
  }, [results.length, visibleCount]);

  const visibleResults = results.slice(0, visibleCount);
  const hasMore = visibleCount < results.length;

  function togglePick(code: string) {
    if (readOnly) return;
    if (selectedCodes.includes(code)) {
      onUnpick(code);
      return;
    }
    onPick(code);
  }

  // On a wide viewport the default is the full sortable table. The "Compact"
  // toggle drops to the card list — on desktop this is the only thing it does
  // (the table is already the dense view), and on the Advisor Console's narrow
  // Browse panel the table overflows horizontally, so cards read far better on
  // iPad. On mobile isDesktop is false so cards always render and `compact`
  // just controls their density (unchanged).
  const showTable = isDesktop && !compact;
  return (
    <section className="results-panel" aria-label={t("results.ariaPanel")}>
      {showTable ? (
      <div className="table-shell">
        <table className="results-table">
          <thead>
            <tr>
              <SortableHeader label={t("results.col.programme")} column="code" sortKey={sortKey} sortDirection={sortDirection} onSortChange={onSortChange} />
              <SortableHeader label={t("results.col.institution")} column="institution" sortKey={sortKey} sortDirection={sortDirection} onSortChange={onSortChange} />
              <SortableHeader label={t("results.col.status")} column="eligibility" sortKey={sortKey} sortDirection={sortDirection} onSortChange={onSortChange} />
              <SortableHeader label={t("results.col.score")} column="score" sortKey={sortKey} sortDirection={sortDirection} onSortChange={onSortChange} />
              <SortableHeader label={t("results.col.band")} column="benchmark" sortKey={sortKey} sortDirection={sortDirection} onSortChange={onSortChange} />
              <SortableHeader label={t("results.col.lqDiff")} column="lq" sortKey={sortKey} sortDirection={sortDirection} onSortChange={onSortChange} />
              <SortableHeader label={t("results.col.medianDiff")} column="median" sortKey={sortKey} sortDirection={sortDirection} onSortChange={onSortChange} />
              <SortableHeader label={t("results.col.uqDiff")} column="uq" sortKey={sortKey} sortDirection={sortDirection} onSortChange={onSortChange} />
            </tr>
          </thead>
          <tbody>
            {visibleResults.map((result) => (
              <tr
                key={result.programme.jupas_code}
                data-code={result.programme.jupas_code}
                className={activeCode === result.programme.jupas_code ? "selected" : selectedCodes.includes(result.programme.jupas_code) ? "picked" : ""}
                role={readOnly ? undefined : "button"}
                tabIndex={readOnly ? -1 : 0}
                onClick={readOnly ? undefined : () => {
                  togglePick(result.programme.jupas_code);
                  onFocus(result.programme.jupas_code);
                }}
                onKeyDown={readOnly ? undefined : (event) => {
                  if (event.key === "Enter" || event.key === " ") {
                    event.preventDefault();
                    togglePick(result.programme.jupas_code);
                    onFocus(result.programme.jupas_code);
                  }
                }}
                style={readOnly ? undefined : { cursor: "pointer" }}
              >
                <td>
                  <span className="programme-cell-head">
                    {readOnly ? null : <PickButton picked={selectedCodes.includes(result.programme.jupas_code)} onClick={() => togglePick(result.programme.jupas_code)} />}
                    <span className="programme-cell-text">
                      <strong>
                        {slotByCode.get(result.programme.jupas_code) ? <SlotBadge slot={slotByCode.get(result.programme.jupas_code)!} /> : null}
                        {result.programme.jupas_code}
                      </strong>
                      <span>{pickName(result.programme, lang)}</span>
                    </span>
                  </span>
                </td>
                <td>{institutionLabel(result.programme.institution)}</td>
                <td><StatusBadge pass={result.eligibility.eligible} /></td>
                <td>{result.calculation.totalScore.toFixed(2)}</td>
                <td><span className={`band ${result.band}`}>{t(bandLabelKey(result.band))}</span></td>
                <DeltaCell result={result} keyName="lq" deltaMode={deltaMode} />
                <DeltaCell result={result} keyName="central" deltaMode={deltaMode} />
                <DeltaCell result={result} keyName="uq" deltaMode={deltaMode} />
              </tr>
            ))}
            {hasMore ? (
              <tr ref={setSentinel} className="results-sentinel-row" aria-hidden="true">
                <td colSpan={8} />
              </tr>
            ) : null}
          </tbody>
        </table>
      </div>
      ) : (
      <div className={compact ? "result-cards compact-results" : "result-cards"}>
        {visibleResults.map((result) => (
          <div
            role={readOnly ? undefined : "button"}
            tabIndex={readOnly ? -1 : 0}
            data-code={result.programme.jupas_code}
            className={activeCode === result.programme.jupas_code ? "mobile-card selected" : selectedCodes.includes(result.programme.jupas_code) ? "mobile-card picked" : "mobile-card"}
            key={result.programme.jupas_code}
            onClick={readOnly ? undefined : () => togglePick(result.programme.jupas_code)}
            onKeyDown={readOnly ? undefined : (event) => {
              if (event.key === "Enter" || event.key === " ") {
                event.preventDefault();
                togglePick(result.programme.jupas_code);
              }
            }}
          >
            <span className="card-topline">
              <span className="card-focus-button">
                {slotByCode.get(result.programme.jupas_code) ? <SlotBadge slot={slotByCode.get(result.programme.jupas_code)!} /> : null}
                <span className="card-code">{result.programme.jupas_code}</span>
                <span>{institutionLabel(result.programme.institution)}</span>
              </span>
              <StatusBadge pass={result.eligibility.eligible} />
              {readOnly ? null : <PickButton picked={selectedCodes.includes(result.programme.jupas_code)} onClick={() => togglePick(result.programme.jupas_code)} />}
            </span>
            <div className="mobile-card-main">
              <strong>{pickName(result.programme, lang)}</strong>
              {(lang === "zh" ? result.programme.name_en : result.programme.name_zh)
                ? <small className="card-zh">{lang === "zh" ? result.programme.name_en : result.programme.name_zh}</small>
                : null}
            </div>
            <span className="compact-score-strip">
              <b>{result.calculation.totalScore.toFixed(2)}</b>
              <CompactBenchmark result={result} benchmarkKey="lq" label={t("common.lq")} deltaMode={deltaMode} />
              <CentralCompactBenchmark result={result} deltaMode={deltaMode} />
              <CompactBenchmark result={result} benchmarkKey="uq" label={t("common.uq")} deltaMode={deltaMode} />
            </span>
            <span className="card-score-row">
              <span>
                <em>{t("results.yourScore")}</em>
                <b>{result.calculation.totalScore.toFixed(2)}</b>
              </span>
              <span className={`band ${result.band}`}>{t(bandLabelKey(result.band))}</span>
            </span>
            <span className="card-benchmarks">
              <BenchmarkChip result={result} benchmarkKey="lq" label={t("common.lq")} deltaMode={deltaMode} />
              <CentralBenchmarkChip result={result} deltaMode={deltaMode} />
              <BenchmarkChip result={result} benchmarkKey="uq" label={t("common.uq")} deltaMode={deltaMode} />
            </span>
          </div>
        ))}
        {hasMore ? <div ref={setSentinel} className="results-sentinel" aria-hidden="true" /> : null}
      </div>
      )}
    </section>
  );
}

function SlotBadge({ slot }: { slot: string }) {
  return <span className="selected-slot-badge">{slot}</span>;
}

function PickButton({ picked, onClick }: { picked: boolean; onClick: () => void }) {
  const { t } = useLang();
  return (
    <button
      className={picked ? "pick-button picked" : "pick-button"}
      type="button"
      aria-label={picked ? t("results.removeFromCompare") : t("results.addToCompare")}
      onClick={(event) => {
        event.stopPropagation();
        onClick();
      }}
    >
      {picked ? (
        <svg width="11" height="9" viewBox="0 0 11 9" fill="none" aria-hidden="true">
          <path d="M1 4L4 7.5L10 1" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round"/>
        </svg>
      ) : null}
    </button>
  );
}

function SortableHeader({
  label,
  column,
  sortKey,
  sortDirection,
  onSortChange,
}: {
  label: string;
  column: SortKey;
  sortKey: SortKey;
  sortDirection: "asc" | "desc";
  onSortChange: (sortKey: SortKey) => void;
}) {
  const active = sortKey === column;
  return (
    <th onClick={() => onSortChange(column)}>
      <button
        className={active ? "sort-header active" : "sort-header"}
        type="button"
        onClick={(event) => {
          // The whole cell is clickable (th onClick); stop the button's own
          // click from bubbling so it doesn't toggle the sort twice.
          event.stopPropagation();
          onSortChange(column);
        }}
      >
        {label}
        <span>{active ? (sortDirection === "asc" ? "↑" : "↓") : "↕"}</span>
      </button>
    </th>
  );
}

function DeltaCell({ result, keyName, deltaMode }: { result: ProgrammeResult; keyName: "lq" | "central" | "uq"; deltaMode: "points" | "percent" }) {
  const { t } = useLang();
  const comparison = keyName === "central" ? centralComparison(result) : result.comparisons.find((item) => item.key === keyName);
  const positive = comparison && comparison.delta >= 0;
  const showMeanLabel = keyName === "central" && comparison?.key === "mean";
  return (
    <td className={comparison ? "benchmark-cell" : "muted"}>
      {comparison ? (
        <>
          {showMeanLabel ? <em className="benchmark-cell-label">{t("common.mean")}</em> : null}
          <strong>{comparison.score.toFixed(2)}</strong>
          <span className={positive ? "positive-text" : "negative-text"}>
            {deltaMode === "percent" ? formatPercent(comparison.percent) : formatDelta(comparison.delta)}
          </span>
        </>
      ) : "-"}
    </td>
  );
}

function StatusBadge({ pass }: { pass: boolean }) {
  const { t } = useLang();
  return <span className={pass ? "status pass" : "status fail"}>{pass ? t("results.eligible") : t("results.checkReq")}</span>;
}

function benchmarkDiff(comparison: { delta: number; percent: number } | undefined, deltaMode: "points" | "percent") {
  if (!comparison) return "-";
  return deltaMode === "percent" ? formatPercent(comparison.percent) : formatDelta(comparison.delta);
}

function BenchmarkChip({ result, benchmarkKey, label, deltaMode = "points" }: { result: ProgrammeResult; benchmarkKey: BenchmarkKey; label: string; deltaMode?: "points" | "percent" }) {
  const comparison = result.comparisons.find((item) => item.key === benchmarkKey);
  const positive = comparison ? comparison.delta >= 0 : false;
  return (
    <span className={!comparison ? "benchmark-chip muted" : positive ? "benchmark-chip positive" : "benchmark-chip negative"}>
      <em>{label}</em>
      <strong>{comparison ? comparison.score.toFixed(2) : "-"}</strong>
      <b>{benchmarkDiff(comparison, deltaMode)}</b>
    </span>
  );
}

function CentralBenchmarkChip({ result, deltaMode = "points" }: { result: ProgrammeResult; deltaMode?: "points" | "percent" }) {
  const { t } = useLang();
  const comparison = centralComparison(result);
  return (
    <BenchmarkChip
      result={result}
      benchmarkKey={comparison?.key === "mean" ? "mean" : "median"}
      label={comparison?.key === "mean" ? t("common.mean") : t("common.median")}
      deltaMode={deltaMode}
    />
  );
}

function CompactBenchmark({ result, benchmarkKey, label, deltaMode = "points" }: { result: ProgrammeResult; benchmarkKey: BenchmarkKey; label: string; deltaMode?: "points" | "percent" }) {
  const comparison = result.comparisons.find((item) => item.key === benchmarkKey);
  const positive = comparison ? comparison.delta >= 0 : false;
  return (
    <span className={!comparison ? "compact-benchmark muted" : positive ? "compact-benchmark positive" : "compact-benchmark negative"}>
      <em>{label}</em>
      <strong>{benchmarkDiff(comparison, deltaMode)}</strong>
    </span>
  );
}

function CentralCompactBenchmark({ result, deltaMode = "points" }: { result: ProgrammeResult; deltaMode?: "points" | "percent" }) {
  const { t } = useLang();
  const comparison = centralComparison(result);
  return (
    <CompactBenchmark
      result={result}
      benchmarkKey={comparison?.key === "mean" ? "mean" : "median"}
      label={comparison?.key === "mean" ? t("common.meanAbbr") : t("results.medShort")}
      deltaMode={deltaMode}
    />
  );
}

function centralComparison(result: ProgrammeResult) {
  return result.comparisons.find((item) => item.key === "median" || item.key === "mean");
}
