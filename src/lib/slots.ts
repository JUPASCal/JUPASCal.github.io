// JUPAS choice labels. JUPAS numbers all 20 choices 1–20 and prefixes a
// band letter — the number is the choice's OVERALL rank, NOT a count
// within the band. So:
//   A1, A2, A3            (choices 1–3)
//   B4, B5, B6            (choices 4–6)
//   C7, C8, C9, C10       (choices 7–10)
//   D11, D12, D13, D14, D15  (choices 11–15)
//   E16, E17, E18, E19, E20  (choices 16–20)
// `index` is 0-based (0 = A1).
export function slotLabel(index: number): string {
  const n = index + 1;
  if (index < 3) return `A${n}`;
  if (index < 6) return `B${n}`;
  if (index < 10) return `C${n}`;
  if (index < 15) return `D${n}`;
  if (index < 20) return `E${n}`;
  return `#${n}`;
}

// The first six choices (Band A + Band B) — used by the compact preference
// pill rows. Kept in sync with slotLabel(0..5).
export const PRIORITY_SLOTS = ["A1", "A2", "A3", "B4", "B5", "B6"] as const;
