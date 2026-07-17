import type { OfferStatistic, Programme } from "../types/jupas";

// Offer / application statistics broken down by JUPAS band. The dataset stores,
// per programme per year, an "Application" row (how many applicants put the
// programme in each band) and an "Offer" row (how many offers went to each
// band). ~95% of offers land in Band A, so a programme's Band B offer count is
// the honest signal for whether a Band B (or lower) placement is worth a slot.

type BandFigures = { offers: number; apps: number; rate: number | null };

export type BandOfferStats = {
  // True only when the programme actually has per-band OFFER rows.
  hasData: boolean;
  latestYear: number | null;
  yearsWithData: number;
  bandA: BandFigures;
  bandB: BandFigures;
  // Summed across every year with offer data.
  totalOffersA: number;
  totalOffersB: number;
};

function bandNum(row: OfferStatistic | undefined, band: "Band A" | "Band B"): number {
  const value = row?.[band];
  return typeof value === "number" ? value : 0;
}

export function getBandOfferStats(programme: Programme): BandOfferStats {
  const apps = new Map<number, OfferStatistic>();
  const offers = new Map<number, OfferStatistic>();
  for (const row of programme.offer_statistics || []) {
    if (!row.Year) continue;
    if (row.Type === "Application") apps.set(row.Year, row);
    else if (row.Type === "Offer") offers.set(row.Year, row);
  }
  const years = [...new Set([...offers.keys(), ...apps.keys()])].sort((a, b) => b - a);
  const latestYear = years.length ? years[0] : null;

  let totalOffersA = 0;
  let totalOffersB = 0;
  for (const row of offers.values()) {
    totalOffersA += bandNum(row, "Band A");
    totalOffersB += bandNum(row, "Band B");
  }

  const figures = (band: "Band A" | "Band B"): BandFigures => {
    const o = latestYear != null ? bandNum(offers.get(latestYear), band) : 0;
    const a = latestYear != null ? bandNum(apps.get(latestYear), band) : 0;
    return { offers: o, apps: a, rate: a > 0 ? (o / a) * 100 : null };
  };

  return {
    hasData: offers.size > 0,
    latestYear,
    yearsWithData: offers.size,
    bandA: figures("Band A"),
    bandB: figures("Band B"),
    totalOffersA,
    totalOffersB,
  };
}

// Whether the programme ever offers to Band B applicants. `known` is false when
// there's no offer data to judge from; when known, `takes` is false only if the
// programme gave zero Band B offers across every year on record.
export function takesBandB(programme: Programme): { known: boolean; takes: boolean; stats: BandOfferStats } {
  const stats = getBandOfferStats(programme);
  return { known: stats.hasData, takes: stats.totalOffersB > 0, stats };
}
