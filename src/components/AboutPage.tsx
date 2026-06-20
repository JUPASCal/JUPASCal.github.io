import { useLang } from "../lib/i18n";
import { useTheme } from "../lib/theme";
import { AppHeader } from "./AppHeader";

// Leave the #about route and return to the calculator without a full reload:
// drop the fragment, then nudge App's hashchange listener so it re-renders
// the home route. Keeps in-memory calculator state warm.
function goHome() {
  window.history.replaceState(
    window.history.state,
    "",
    window.location.pathname + window.location.search,
  );
  window.dispatchEvent(new Event("hashchange"));
}

export function AboutPage() {
  const { t } = useLang();
  const [theme, setTheme] = useTheme();

  return (
    // Shares .app-shell.layout-mobile with the calculator/share views so it
    // inherits the mobile scroll container (html/body are overflow:hidden on
    // mobile — without this the page can't scroll). .about-view just narrows
    // the readable column.
    <main className="app-shell layout-mobile about-view">
      <AppHeader theme={theme} onThemeChange={setTheme} onBack={goHome} onBrandClick={goHome} inlineSettings />

      <article className="about-doc">
        <header className="about-hero">
          <p className="eyebrow">{t("about.eyebrow")}</p>
          <h1 className="about-title">
            JUPASCal <span className="about-title-year">2026</span>
          </h1>
          <p className="about-lede">{t("about.lede")}</p>
        </header>

        <ul className="about-facts">
          <li>
            <strong>10</strong>
            <span>{t("about.facts.institutions")}</span>
          </li>
          <li>
            <strong>{__PROGRAMME_COUNT__}</strong>
            <span>{t("about.facts.programmes")}</span>
          </li>
          <li>
            <strong>2025</strong>
            <span>{t("about.facts.baselines")}</span>
          </li>
        </ul>

        <section className="about-card">
          <span className="about-card-icon" aria-hidden="true">
            <svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
              <path d="M3 3v18h18" />
              <path d="M7 14l3-4 3 3 4-6" />
            </svg>
          </span>
          <div className="about-card-text">
            <h2>{t("about.scores.h")}</h2>
            <p>{t("about.scores.p")}</p>
          </div>
        </section>

        <section className="about-card">
          <span className="about-card-icon" aria-hidden="true">
            <svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
              <ellipse cx="12" cy="5" rx="8" ry="3" />
              <path d="M4 5v14c0 1.7 3.6 3 8 3s8-1.3 8-3V5" />
              <path d="M4 12c0 1.7 3.6 3 8 3s8-1.3 8-3" />
            </svg>
          </span>
          <div className="about-card-text">
            <h2>{t("about.more.h")}</h2>
            <p>{t("about.more.p")}</p>
          </div>
        </section>

        <section className="about-card">
          <span className="about-card-icon" aria-hidden="true">
            <svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
              <circle cx="12" cy="12" r="9" />
              <path d="M12 8v5" />
              <path d="M12 16.5h.01" />
            </svg>
          </span>
          <div className="about-card-text">
            <h2>{t("about.disclaimer.h")}</h2>
            <p>{t("about.disclaimer.p")}</p>
          </div>
        </section>

        <section className="about-card">
          <span className="about-card-icon" aria-hidden="true">
            <svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
              <rect x="5" y="11" width="14" height="10" rx="2" />
              <path d="M8 11V7a4 4 0 0 1 8 0v4" />
            </svg>
          </span>
          <div className="about-card-text">
            <h2>{t("about.privacy.h")}</h2>
            <p>{t("about.privacy.p")}</p>
          </div>
        </section>

        <section className="about-card">
          <span className="about-card-icon" aria-hidden="true">
            <svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
              <path d="M21 11.5a8.38 8.38 0 0 1-.9 3.8 8.5 8.5 0 0 1-7.6 4.7 8.38 8.38 0 0 1-3.8-.9L3 21l1.9-5.7a8.38 8.38 0 0 1-.9-3.8 8.5 8.5 0 0 1 4.7-7.6 8.38 8.38 0 0 1 3.8-.9h.5a8.48 8.48 0 0 1 8 8v.5z" />
            </svg>
          </span>
          <div className="about-card-text">
            <h2>{t("about.source.h")}</h2>
            <p>{t("about.source.p.pre")}</p>
            <div className="about-source-actions">
              <a
                className="about-source-btn"
                href="https://forms.gle/f2V4m5TrWpKSySPD8"
                target="_blank"
                rel="noreferrer"
              >
                {t("about.source.form")}
              </a>
              <a
                className="about-source-btn is-secondary"
                href="https://github.com/JUPASCal/JUPASCal.github.io"
                target="_blank"
                rel="noreferrer"
              >
                {t("about.source.github")}
              </a>
            </div>
          </div>
        </section>

        <footer className="about-version">
          <span>
            {__APP_VERSION__.includes("-beta") ? <><strong>{t("about.beta")}</strong> · </> : null}
            {t("about.version")} <code>{__APP_VERSION__}</code>
            {__ADMISSION_CYCLE__ ? <> · {t("about.cycle", { year: __ADMISSION_CYCLE__ })}</> : null}
            {" · "}{t("about.build")} <code>{__BUILD_SHA__}</code> ({__BUILD_DATE__})
          </span>
          <span className="about-social">
            <a
              href="https://github.com/JUPASCal/JUPASCal.github.io"
              target="_blank"
              rel="noreferrer"
              aria-label="GitHub"
            >
              <svg viewBox="0 0 24 24" width="19" height="19" fill="currentColor" aria-hidden="true">
                <path d="M12 .5C5.6.5.5 5.6.5 12c0 5.1 3.3 9.4 7.9 10.9.6.1.8-.25.8-.55 0-.27-.01-1-.02-1.95-3.2.7-3.88-1.54-3.88-1.54-.53-1.34-1.3-1.7-1.3-1.7-1.06-.72.08-.71.08-.71 1.17.08 1.79 1.2 1.79 1.2 1.04 1.79 2.73 1.27 3.4.97.1-.76.41-1.27.74-1.56-2.55-.29-5.24-1.28-5.24-5.69 0-1.26.45-2.28 1.19-3.09-.12-.29-.52-1.46.11-3.05 0 0 .97-.31 3.18 1.18a11.1 11.1 0 0 1 5.8 0c2.2-1.49 3.17-1.18 3.17-1.18.63 1.59.23 2.76.11 3.05.74.81 1.19 1.83 1.19 3.09 0 4.42-2.69 5.39-5.25 5.68.42.36.8 1.08.8 2.18 0 1.57-.02 2.84-.02 3.23 0 .31.21.67.81.55A11.5 11.5 0 0 0 23.5 12C23.5 5.6 18.4.5 12 .5z" />
              </svg>
            </a>
            <a
              href="https://www.instagram.com/thejackjai"
              target="_blank"
              rel="noreferrer"
              aria-label="Instagram @thejackjai"
            >
              <svg viewBox="0 0 24 24" width="19" height="19" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                <rect x="3" y="3" width="18" height="18" rx="5" />
                <circle cx="12" cy="12" r="4" />
                <circle cx="17.5" cy="6.5" r="0.7" fill="currentColor" stroke="none" />
              </svg>
            </a>
            <a
              href="https://www.threads.com/@thejackjai"
              target="_blank"
              rel="noreferrer"
              aria-label="Threads @thejackjai"
            >
              <svg viewBox="0 0 24 24" width="19" height="19" fill="currentColor" aria-hidden="true">
                <path d="M16.2 11.3c-.1 0-.2-.1-.3-.1-.2-3-1.8-4.7-4.5-4.7-1.6 0-2.9.7-3.7 2l1.4 1c.6-.9 1.4-1.4 2.3-1.4 1.6 0 2.5 1 2.7 2.9-.7-.2-1.4-.3-2.2-.3-2.4 0-3.9 1.1-4.1 2.7-.1.9.3 1.8 1 2.4.7.6 1.6.9 2.6.9 1.4 0 2.5-.5 3.3-1.5.5-.6.8-1.3 1-2.2.7.4 1.2 1 1.4 1.7.4 1-.1 2.5-1.7 3.4-1.4.8-3.7 1.3-6 .1-2.6-1.4-4.1-3.9-4.1-7.3 0-4.6 2.4-7.6 6.1-7.6 4 0 5.7 2.4 6.2 3.9l1.5-.7c-.7-2-2.9-4.8-7.7-4.8C5 1.8 1.8 5.5 1.8 11c0 4.1 1.9 7.4 5.3 9.1 1.5.8 3.2 1.1 4.7 1.1 2 0 3.7-.5 5-1.5 2-1.4 3-3.7 2.4-5.6-.4-1.4-1.4-2.4-2.9-3zm-4.3 3.3c-1.2.1-2.3-.4-2.4-1.2-.1-.6.4-1.3 2.1-1.4h.5c.6 0 1.2.1 1.7.2-.2 1.7-1.1 2.3-1.9 2.4z" />
              </svg>
            </a>
          </span>
        </footer>
      </article>
    </main>
  );
}
