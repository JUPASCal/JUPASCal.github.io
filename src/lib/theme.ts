import { useEffect, useState } from "react";

export type Theme = "light" | "dark";

const THEME_KEY = "jupas-staging-theme";

// Mirrors CalculatorApp's theme bootstrap so routes rendered OUTSIDE the
// calculator (e.g. the About page, which App renders directly) resolve the
// same saved preference / OS default.
export function loadTheme(): Theme {
  const saved = localStorage.getItem(THEME_KEY);
  if (saved === "light" || saved === "dark") return saved;
  return window.matchMedia?.("(prefers-color-scheme: dark)").matches ? "dark" : "light";
}

// Self-contained theme state for standalone routes. Applies `data-theme` to
// <html> and persists to the shared localStorage key, so toggling here and
// returning to the calculator (which re-reads the key on mount) stays in sync.
export function useTheme(): [Theme, (next: Theme) => void] {
  const [theme, setTheme] = useState<Theme>(() => loadTheme());
  useEffect(() => {
    document.documentElement.dataset.theme = theme;
    localStorage.setItem(THEME_KEY, theme);
  }, [theme]);
  return [theme, setTheme];
}
