# Versioning

JUPAS Cal is a **continuously-deployed website** — every push to `main` builds and
deploys via GitHub Actions. Because there are no downstream package consumers, the
version exists to (a) identify exactly what's deployed and (b) signal meaningful
updates. We split that into **three independent parts** — don't conflate them.

> TL;DR for agents: **a routine push does NOT change any version.** Only bump
> `package.json` `"version"` when you're cutting a *release*. The exact deploy is
> always identified automatically by the build stamp.

## The three parts

| Part | Where | When it changes | Who sets it |
|------|-------|-----------------|-------------|
| **App version** (semver) | `package.json` `"version"` | only on a **release** | a human/agent, by hand |
| **Admission cycle** (entry year) | `package.json` `"admissionCycle"` | only when the **data year** changes | a human/agent, by hand |
| **Build stamp** (`git short SHA` + date) | injected at build time (`__BUILD_SHA__` / `__BUILD_DATE__`) | every deploy | **automatic — never touch** |

All three show in the About footer, e.g.:
`Public Beta · v0.1.0-beta.1 · 2026 entry · build a1b2c3d (2026-06-20)`

## When do I bump the app version?

**Default: you don't.** A normal change → just push to `main`. The build stamp makes
that deploy uniquely identifiable, so there's no need to touch `"version"`.

Bump `"version"` **only when cutting a release worth announcing**, following semver:

- **Now — public beta:** stay on `0.1.0-beta.N`. Bump `N` for **each release worth
  announcing** — any *user-facing* fix or feature batch (e.g. corrected admission
  calculations, a new view), tagged + with notes. The app is feature-complete, so
  most releases are bug-fix/minor-feature batches — version them. *Trivial/internal*
  pushes (cosmetic tweaks, refactors, docs, CI) stay routine: no bump, the build
  stamp identifies the deploy.
- **Stable launch:** set **`1.0.0`** (drop `-beta`) when you declare it stable.
- **After 1.0.0:**
  - **PATCH** `1.0.x` — bug fixes, copy/data corrections.
  - **MINOR** `1.x.0` — new features. **The annual data refresh is a MINOR** (bump
    `version` *and* `admissionCycle` together; title the release "vX.Y.0 — 2027 cycle").
  - **MAJOR** `x.0.0` — overhauls / breaking UX or data-model changes.

Versions only ever go **up** (semver precedence). Never reuse or lower a number.

## How to cut a release (procedure)

1. Edit `package.json` `"version"` (and `"admissionCycle"` if the data year changed).
2. Commit.
3. Push to `main` → CI builds, stamps the exact commit, and deploys.
4. Tag it and publish notes:
   ```bash
   git tag v1.2.0 && git push upstream v1.2.0
   gh release create v1.2.0 --title "v1.2.0 — <summary>" --notes "<changelog>"
   ```

## Routine pushes (the common case)

Just push to `main`. **Do not bump `"version"`.** The deploy is still uniquely
identified by its build stamp, which is exactly what a bug report needs.

## Why not bump every push?

Manual per-push bumping is toil and easy to forget, and a monotonic "beta.NNN"
counter conveys nothing. The build stamp already gives every deploy a precise,
automatic identity, so the human version is freed up to mean something — "this is a
release" — instead of just "another push".
