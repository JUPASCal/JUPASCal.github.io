import { Fragment } from "react";
import type { BenchmarkBand, ProgrammeResult } from "../types/jupas";
import { effectiveBenchmarks } from "../lib/results";
import { useLang, type Translate } from "../lib/i18n";

// Short band caption used in the score-bubble aria text.
function shortBandLabel(t: Translate, band: BenchmarkBand): string {
  return {
    "above-uq": t("band.aboveUq"),
    "above-median": t("band.aboveMed"),
    "above-lq": t("band.aboveLq"),
    "below-lq": t("band.belowLq"),
    "no-score": t("band.noData"),
  }[band];
}

function fmtNum(n: number): string {
  return Number.isInteger(n) ? n.toString() : n.toFixed(1);
}

type Props = {
  result: ProgrammeResult;
  // When false, hide every number (the score bubble + the tick values) while
  // keeping the band position/marker — used by the share card's privacy toggle.
  // Defaults to true (the Compare step always shows the numbers).
  showScore?: boolean;
};

// Shared score scale — the single source of truth for the LQ/MED/UQ benchmark
// bar used by BOTH the Step-3 Compare cards (MobileComparison) and the share
// recap card (ShareView). A band-coloured score bubble is pinned above a track,
// anchored to a marker dot, with ticks positioned by their real values.
//
// Anchoring: LQ at 20% and UQ at 80% so the reference band always occupies the
// same 60% of the bar regardless of the user's score; MED slides between them by
// value. The marker extrapolates linearly past the anchors, soft-capped near the
// edges. Ticks at near-identical values merge their labels.
//
// Styling comes from the `.mc-*` classes in styles.css; the recap card scopes
// compact overrides under `.recap-bar .mc-*`.
export function ScoreScale({ result, showScore = true }: Props) {
  const { t } = useLang();
  // Central tick falls back median → mean → expected_score; `source` tells us
  // which so the tick can be labelled honestly (MED / Avg / Est).
  const { lq, median, uq, source } = effectiveBenchmarks(result.programme);
  const medLabel = source === "mean" ? "MEAN" : source === "expected" ? "EST" : "MED";
  const total = result.calculation.totalScore;
  // Eligibility gates the band signal: if the student can't apply at all, a high
  // score sitting "Above UQ" (green) is misleading, so the bubble/arrow/marker
  // get the red "not eligible" treatment that overrides the band colour. Mirrors
  // the Compare row's `.mc-row-filled.is-ineligible` rule.
  const ineligibleCls = result.eligibility.eligible ? "" : " is-ineligible";

  if (lq == null && median == null && uq == null) {
    // No benchmark – surface the calculated score (when shown) with a caption,
    // and no bar.
    return (
      <div
        className="mc-track-wrap mc-track-empty"
        role="img"
        aria-label={t("scale.ariaNoData", { score: total.toFixed(2) })}
      >
        {showScore ? (
          <div className={`mc-score-bubble band-no-score is-static${ineligibleCls}`}>{total.toFixed(2)}</div>
        ) : null}
        <span className="mc-no-data-caption">{t("scale.no2025")}</span>
      </div>
    );
  }

  // Dedupe by value first – if LQ===MED===15 they're one reference point with
  // three labels, not three ticks at the same place (which would divide-by-zero
  // in interpolation).
  const distinctRefs: Array<{ labels: string[]; value: number }> = [];
  function addRef(label: string, value: number | undefined | null) {
    if (value == null) return;
    const existing = distinctRefs.find((r) => Math.abs(r.value - value) < 0.001);
    if (existing) existing.labels.push(label);
    else distinctRefs.push({ labels: [label], value });
  }
  addRef("LQ", lq);
  addRef(medLabel, median);
  addRef("UQ", uq);
  distinctRefs.sort((a, b) => a.value - b.value);

  const anchoredRefs = distinctRefs.map((ref, idx) => {
    let pct: number;
    if (distinctRefs.length === 1) {
      pct = 50;
    } else if (distinctRefs.length === 2) {
      pct = idx === 0 ? 30 : 70;
    } else {
      // 3 distinct values: outer two at 20/80; middle slides.
      if (idx === 0) pct = 20;
      else if (idx === 2) pct = 80;
      else {
        const [low, , high] = distinctRefs;
        pct = 20 + ((ref.value - low.value) / (high.value - low.value)) * 60;
      }
    }
    return { ...ref, pct };
  });

  function positionFor(v: number): number {
    if (anchoredRefs.length === 1) {
      const delta = (v - anchoredRefs[0].value) * 6;
      return Math.max(2, Math.min(98, 50 + Math.max(-48, Math.min(48, delta))));
    }
    if (v <= anchoredRefs[0].value) {
      const a = anchoredRefs[0];
      const b = anchoredRefs[1];
      const raw = a.pct + ((v - a.value) / (b.value - a.value)) * (b.pct - a.pct);
      return Math.max(2, Math.min(98, raw));
    }
    const last = anchoredRefs.length - 1;
    if (v >= anchoredRefs[last].value) {
      const a = anchoredRefs[last - 1];
      const b = anchoredRefs[last];
      const raw = a.pct + ((v - a.value) / (b.value - a.value)) * (b.pct - a.pct);
      return Math.max(2, Math.min(98, raw));
    }
    for (let i = 0; i < last; i++) {
      const a = anchoredRefs[i];
      const b = anchoredRefs[i + 1];
      if (v >= a.value && v <= b.value) {
        return a.pct + ((v - a.value) / (b.value - a.value)) * (b.pct - a.pct);
      }
    }
    return 50;
  }

  // Merge ticks whose positions would visually collide into one chip; each label
  // keeps its own exact value ("LQ 34.8 · MED 35").
  const TICK_MERGE_PCT = 15;
  type TickItem = { label: string; value: number };
  const ticks: Array<{ items: TickItem[]; pct: number }> = [];
  for (const ref of anchoredRefs) {
    const newItems = ref.labels.map((label) => ({ label, value: ref.value }));
    const last = ticks[ticks.length - 1];
    if (last && ref.pct - last.pct < TICK_MERGE_PCT) {
      last.items.push(...newItems);
    } else {
      ticks.push({ items: newItems, pct: ref.pct });
    }
  }

  const userPct = positionFor(total);

  return (
    <div
      className="mc-track-wrap"
      role="img"
      aria-label={t("scale.ariaFull", {
        score: total.toFixed(2),
        lq: lq ?? "–",
        median: median ?? "–",
        uq: uq ?? "–",
        band: shortBandLabel(t, result.band),
      })}
    >
      {/* Inner wrapper carries `container-type` (for the bubble-arrow cqw unit)
          and the positioning context. It must NOT be the flex item itself:
          iOS/WebKit collapses a flex/grid item that has `container-type` to
          ~0 inline-size, which piled every left:%-positioned tick/marker onto
          a single point on iPhones. A plain block child sizes normally. */}
      <div className="mc-track-inner">
        {showScore ? (
          <>
            {/* Bubble is clamped (6–94%) so it never kisses the card edge. The
                arrow is a SEPARATE element pinned to the marker's x (userPct) so
                it always points at the dot — even at the scale edges — without
                needing container-query units (cqw broke on iOS). The clamp delta
                is small enough (≤~4%) that the arrow stays under the bubble. */}
            <div
              className={`mc-score-bubble band-${result.band}${ineligibleCls}`}
              style={{ left: `${Math.max(6, Math.min(94, userPct))}%` }}
              aria-label={t("scale.ariaBubble", { score: total.toFixed(2), band: shortBandLabel(t, result.band) })}
            >
              {total.toFixed(2)}
            </div>
            <span
              className={`mc-bubble-arrow band-${result.band}${ineligibleCls}`}
              style={{ left: `${userPct}%` }}
              aria-hidden="true"
            />
          </>
        ) : null}
        <div className="mc-track">
          {ticks.map((tick, i) => (
            <Fragment key={i}>
              <span className="mc-tick" style={{ left: `${tick.pct}%` }} />
              <span className="mc-tick-label" style={{ left: `${tick.pct}%` }}>
                {tick.items.map((it, idx) => (
                  <Fragment key={it.label}>
                    {idx > 0 ? <span className="mc-tick-sep" aria-hidden="true">·</span> : null}
                    <em>{it.label === "LQ" ? t("common.lq") : it.label === "UQ" ? t("common.uq") : it.label === "MEAN" ? t("common.meanAbbr") : it.label === "EST" ? t("common.estAbbr") : t("common.medAbbr")}</em>
                    {showScore ? <b>{fmtNum(it.value)}</b> : null}
                  </Fragment>
                ))}
              </span>
            </Fragment>
          ))}
          <span
            className={`mc-marker band-${result.band}${ineligibleCls}`}
            style={{ left: `${userPct}%` }}
            aria-hidden="true"
          />
        </div>
      </div>
    </div>
  );
}
