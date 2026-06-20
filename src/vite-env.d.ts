/// <reference types="vite/client" />

// Injected at build time via vite.config.ts → define.__APP_VERSION__
// Single source of truth: package.json "version".
declare const __APP_VERSION__: string;

// Injected at build time via vite.config.ts → define.__PROGRAMME_COUNT__
// Single source of truth: the unified dataset's length (never hardcode it).
declare const __PROGRAMME_COUNT__: number;
