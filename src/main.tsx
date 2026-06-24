import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { preloadHashState } from "./lib/hashState";
import { LangProvider } from "./lib/i18n";
import "./styles.css";
// Solid-colour fallbacks for browsers without color-mix() (Safari < 16.2 — old
// iPhones/Androids). Auto-generated; wrapped in @supports so modern browsers
// skip it entirely. Imported after styles.css so it follows the source it backs.
import "./legacy-color-fallbacks.css";

function renderBootError(error: unknown) {
  const root = document.getElementById("root");
  if (!root) return;
  const isDev = import.meta.env.DEV;
  const message = error instanceof Error ? error.message : String(error || "Unknown error");
  // Build the fallback DOM node-by-node and set the error text via textContent
  // rather than interpolating it into an innerHTML string — keeps this safe even
  // if a future boot-error path ever carries externally-influenced text.
  const main = document.createElement("main");
  main.style.cssText = "min-height:100vh;padding:24px;font-family:system-ui,-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;background:#f8f0ea;color:#2b2521";
  const h1 = document.createElement("h1");
  h1.style.cssText = "font-size:20px;margin:0 0 8px";
  h1.textContent = "JUPASCal could not start";
  const p = document.createElement("p");
  p.style.cssText = "margin:0 0 12px;color:#665c55";
  p.textContent = isDev
    ? "Try a hard refresh. If this stays visible, send this error:"
    : "Try a hard refresh. If this stays visible, please come back later.";
  if (isDev) {
    const pre = document.createElement("pre");
    pre.style.cssText = "white-space:pre-wrap;background:#fff;border:1px solid #e2d6cc;border-radius:10px;padding:12px;font-size:12px";
    pre.textContent = message;
    main.append(h1, p, pre);
  } else {
    main.append(h1, p);
  }
  root.replaceChildren(main);
}

// Dynamic-import App AFTER the hash cache is hydrated. App.tsx has module-level
// constants (`INITIAL_HASH_STATE` etc.) that call readHashState() at evaluation
// time — if App were statically imported, those would run before
// preloadHashState() populated the cache. Decode is synchronous now, but the
// async boot ordering is kept as a hook for any future async startup work.
preloadHashState()
  .catch(() => null)
  .then(async () => {
    const { default: App } = await import("./App");
    createRoot(document.getElementById("root")!).render(
      <StrictMode>
        <LangProvider>
          <App />
        </LangProvider>
      </StrictMode>,
    );
  })
  .catch(renderBootError);
