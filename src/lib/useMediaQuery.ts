import { useEffect, useState } from "react";

// The single desktop/mobile breakpoint, shared so the TS call sites can't drift
// apart. Desktop is ≥ DESKTOP_MIN_WIDTH; mobile is everything below it.
export const DESKTOP_MIN_WIDTH = 921;
export const DESKTOP_MEDIA_QUERY = `(min-width: ${DESKTOP_MIN_WIDTH}px)`;
export const MOBILE_MEDIA_QUERY = `(max-width: ${DESKTOP_MIN_WIDTH - 1}px)`;

// True for a physically small, touch-first PHONE (Android phone / iPhone). The
// desktop/mobile split is width-based (921px), which is correct when the viewport
// reflects the device — but an installed Android PWA (or a phone in Chrome's
// "Desktop site" mode) can report a ≥921px layout width and render the desktop
// console on a phone. Gating desktop on `!isMobileDevice()` forces such phones to
// the mobile layout. Deliberately EXCLUDES iPads / Android tablets (no phone UA
// token, `userAgentData.mobile` false, min screen dimension > 500px), so
// iPad-landscape keeps the desktop layout as intended. Static per session.
export function isMobileDevice(): boolean {
  if (typeof navigator === "undefined" || typeof window === "undefined") return false;
  const uaData = (navigator as Navigator & { userAgentData?: { mobile?: boolean } }).userAgentData;
  if (uaData && typeof uaData.mobile === "boolean" && uaData.mobile) return true;
  if (/Android.+Mobile|iPhone|iPod|Windows Phone|IEMobile|BlackBerry|Opera Mini/i.test(navigator.userAgent || "")) {
    return true;
  }
  // Fallback for a UA-masked phone (desktop-site mode / some WebAPKs): a
  // touch-first pointer on a physically small screen. `screen.*` reports the
  // device, not the (possibly overridden) layout viewport, so the ≤500px
  // min-dimension ceiling still excludes iPads and touch laptops.
  try {
    const coarse = window.matchMedia("(pointer: coarse)").matches;
    const s = window.screen;
    const minDim = Math.min(s?.width ?? 9999, s?.height ?? 9999);
    if (coarse && minDim > 0 && minDim <= 500) return true;
  } catch {
    // matchMedia / screen unavailable — fall through to false.
  }
  return false;
}

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
