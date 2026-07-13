# JUPASCal · JUPAS Score Calculator 2026 (Hong Kong DSE)

A free, open-source, **unofficial JUPAS score calculator** for Hong Kong DSE
students. Enter your HKDSE grades, build your A1–B6 programme list, and the tool
estimates your admission score for every JUPAS programme (400+ across 10
institutions) and compares it against historical admission data — a fast **DSE
score calculator** that works out each programme's own weighting for you.

🔗 **Live site: <https://jupascal.com>** — no account, no download, no ads.

> [!IMPORTANT]
> **This is an unofficial, educational tool — not affiliated with JUPAS or any
> university.** Scores are *estimates* based on published formulas and past
> admission statistics; they are not predictions or guarantees of admission.
> Always confirm details with the official JUPAS and institution sources. Use it
> to get a rough sense of where you stand, nothing more.

## What it does

- **Score estimation** — applies each institution's own weighting/formula
  (Best-5, Best-6, subject multipliers, bonus subjects, M1/M2 handling, …) to
  your grades.
- **Eligibility checks** — verifies minimum and elective-subject requirements
  per programme.
- **Portfolio analysis** — an advisor-style read of your Band-A choices: per-slot
  risk, and "safer options in the same direction" suggestions.
- **Shareable plans** — your grades + choices encode into the URL (no account, no
  server), so a plan can be shared or handed to a teacher.
- **Bilingual** — English / 繁體中文.

Everything runs **client-side** — there is no backend. Your grades never leave
your browser except in a share link you choose to create.

## Tech stack

React 19 + TypeScript + Vanilla CSS, built with Vite. Deployed to GitHub Pages
via GitHub Actions on every push to `main`. Score computation runs in a Web
Worker to keep grade entry responsive.

## Local development

Requires Node.js 20+.

```bash
npm install
npm run dev      # starts Vite on http://localhost:5174
npm run build    # type-check + production build into dist/
```

Validation harnesses for the calculation/analysis logic:

```bash
npm run audit              # eligibility
npm run audit:analysis     # portfolio-analysis fuzz
npm run audit:suggestions  # safer-option suggestions
npm run audit:selection    # non-academic requirements
npm run audit:apl          # Applied Learning (Category B) model consistency
```

## Data pipeline

The app ships a single processed dataset
(`data/processed/JUPAS_2026_Unified_Data.json`). It's regenerated from
per-institution scrapers and source PDFs/Excel under `scripts/` — only needed if
you're updating the data for a new admission cycle:

```bash
python -m venv .venv && source .venv/bin/activate
pip install -r requirements.txt
playwright install chromium     # for the Playwright-based scrapers
python scripts/utils/unify_2026_data.py
python scripts/utils/validate_unified.py
```

The programme count is **not** hardcoded — it's derived at build time from the
dataset length, and new JUPAS-listed programmes are auto-included by the
unification step.

## Project structure

```
index.html, src/, vite.config.ts   the React app (repo root)
data/processed/                    the runtime dataset the app fetches
data/raw/                          source files + subject vocabulary
scripts/extraction/                per-institution scrapers
scripts/utils/                     unification + validation
scripts/*.mjs                      JS audit harnesses (npm run audit*)
docs/manuals/                      architecture & calculation notes
.github/workflows/deploy.yml       build + deploy to GitHub Pages
```

## Data sources & attribution

The admission data is compiled from **publicly available** JUPAS and university
sources (programme requirements, weightings, and past admission statistics). That
data belongs to its respective owners and is **not** covered by this project's
license — it's bundled here only to make the calculator usable. If you reuse this
project, you are responsible for your own use of that data.

## License

The source code is licensed under the **[MIT License](LICENSE)** — you're free to
use, copy, modify, and distribute it, with attribution. Contributions are very
welcome.

A couple of notes:

- This license covers the **code only**. The bundled admission data is
  third-party (see *Data sources & attribution* above) and is not yours to
  relicense — use it responsibly.
- "JUPAS Cal" and **jupascal.com** refer to this official project. Please don't
  run a copy in a way that impersonates the official site or implies its
  endorsement — the goal is to help students, not to confuse them.

## Disclaimer

JUPAS Cal is provided "as is", without warranty of any kind. The estimates may be
incomplete or wrong. The authors are not responsible for any decision made based
on this tool. Always rely on official JUPAS and institutional information for
real admission decisions.
