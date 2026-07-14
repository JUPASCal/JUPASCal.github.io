import type { Programme } from "../types/jupas";

// Programmes whose SCORING runs on the 2026 weighting because their 2025
// benchmarks are already on that basis: the institution republished
// recalculated scores (CityU across the board, CUHK JS4725), or the benchmark
// was rebuilt onto the new weighting (HKBU introduced-weighting programmes,
// CUHK grade-profile simulations, HKUST Engineering's official simulated
// scores). Everything else scores on true 2025 logic per the Year-Labeling
// Rule. UI year labels ("Calculated based on {year} formula", "Method
// ({year})") read this so they state the basis actually used.
const BASES_2026 = new Set([
  "cityu_2026_recalculated",
  "cuhk_2026_recalculated",
  "cuhk_2026_simulated",
  "eduhk_2026_recalculated",
  "hkbu_2026_simulated",
]);

export function scoringBasisYear(programme: Programme): "2025" | "2026" {
  if (BASES_2026.has(programme.score_basis ?? "")) return "2026";
  // HKUST Engineering benchmarks are HKUST's own simulated 2026-formula
  // scores, and the single formula recipe in our data is the 2026 one.
  if (programme.institution === "HKUST" && programme.faculty === "School of Engineering") return "2026";
  return "2025";
}
