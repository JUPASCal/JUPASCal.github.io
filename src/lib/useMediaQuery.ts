import { useEffect, useState } from "react";

// The single desktop/mobile breakpoint, shared so the TS call sites can't drift
// apart. Desktop is ≥ DESKTOP_MIN_WIDTH; mobile is everything below it.
export const DESKTOP_MIN_WIDTH = 921;
export const DESKTOP_MEDIA_QUERY = `(min-width: ${DESKTOP_MIN_WIDTH}px)`;
export const MOBILE_MEDIA_QUERY = `(max-width: ${DESKTOP_MIN_WIDTH - 1}px)`;

export function useMediaQuery(query: string): boolean {
  const [matches, setMatches] = useState<boolean>(() =>
    typeof window !== "undefined" ? window.matchMedia(query).matches : false
  );

  useEffect(() => {
    const mql = window.matchMedia(query);
    const handler = (event: MediaQueryListEvent | MediaQueryList) => {
      setMatches("matches" in event ? event.matches : mql.matches);
    };
    handler(mql);
    mql.addEventListener("change", handler);
    return () => mql.removeEventListener("change", handler);
  }, [query]);

  return matches;
}
