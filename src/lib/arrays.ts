// Drop trailing null slots from a sparse picks array while preserving interior
// gaps — e.g. [A, null, B, null, null] → [A, null, B]. The plan stores picks
// positionally (A1, A2, …), so a trailing empty slot is meaningless, but an
// interior null keeps the later slots' labels stable until the user collapses it.
export function trimTrailingNulls<T>(arr: (T | null)[]): (T | null)[] {
  let lastNonNull = -1;
  for (let i = arr.length - 1; i >= 0; i--) {
    if (arr[i] !== null) {
      lastNonNull = i;
      break;
    }
  }
  return arr.slice(0, lastNonNull + 1);
}
