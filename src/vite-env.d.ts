/// <reference types="vite/client" />

// Injected at build time via vite.config.ts → define.__APP_VERSION__
// Single source of truth: package.json "version".
declare const __APP_VERSION__: string;

// Injected at build time via vite.config.ts → define.__PROGRAMME_COUNT__
// Single source of truth: the unified dataset's length (never hardcode it).
declare const __PROGRAMME_COUNT__: number;

// Admission cycle (JUPAS entry year, e.g. "2026") from package.json
// "admissionCycle". Independent of __APP_VERSION__; see VERSIONING.md.
declare const __ADMISSION_CYCLE__: string;

// Auto build stamp (git short SHA + YYYY-MM-DD) injected at build time.
// Identifies the exact deploy; never set by hand. See VERSIONING.md.
declare const __BUILD_SHA__: string;
declare const __BUILD_DATE__: string;
