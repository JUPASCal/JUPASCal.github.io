import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import { readFile } from "node:fs/promises";
import { readFileSync } from "node:fs";
import { execSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { resolve } from "node:path";

const projectDir = fileURLToPath(new URL(".", import.meta.url));
const pkg = JSON.parse(readFileSync(new URL("./package.json", import.meta.url), "utf-8"));

// Build stamp — uniquely identifies the exact deploy (for bug reports) WITHOUT a
// manual version bump. See VERSIONING.md: routine pushes aren't versioned, the
// build stamp covers per-deploy identity; only releases bump package.json.
const buildSha = (() => {
  if (process.env.GITHUB_SHA) return process.env.GITHUB_SHA.slice(0, 7); // CI (Actions)
  try { return execSync("git rev-parse --short HEAD").toString().trim(); } catch { return "dev"; }
})();
const buildDate = new Date().toISOString().slice(0, 10); // YYYY-MM-DD (build time)
// Single source of truth for the programme count: the unified dataset's length,
// read at build time and injected as __PROGRAMME_COUNT__. Avoids hardcoding the
// number in the UI (it changes whenever programmes are added/removed).
const unifiedData = JSON.parse(readFileSync(new URL("./data/processed/JUPAS_2026_Unified_Data.json", import.meta.url), "utf-8"));
const programmeCount = Array.isArray(unifiedData) ? unifiedData.length : 0;

function serveDataMiddleware() {
  return async (req: any, res: any, next: any) => {
    // Only serve the RUNTIME dataset (data/processed/*: the unified JSON +
    // its .version sidecar, fetched by the data worker). Must NOT swallow
    // /data/raw/* — `src/lib/subjects.ts` imports data/raw/subjects.canonical.json
    // as a MODULE; now that the app lives at the repo root that resolves to an
    // in-root `/data/raw/...` URL, and intercepting it here returns raw JSON
    // (application/json) where Vite needs to serve a transformed JS module,
    // which breaks the whole module graph → blank app in dev.
    if (!req.url?.startsWith("/data/processed/")) return next();
    try {
      // Strip the query string — the data worker appends a
      // `?v=<version>` cache-buster that isn't part of the
      // file path.
      const [urlPath, query] = req.url.split("?");
      const filePath = resolve(projectDir, urlPath.slice(1));
      const content = await readFile(filePath);
      const isJson = urlPath.endsWith(".json");
      res.setHeader("Content-Type", isJson ? "application/json" : "text/plain");
      // Versioned JSON (carries ?v=) is immutable for that
      // version — cache hard so reloads skip the network. The
      // tiny .version sidecar must always revalidate so a data
      // update is noticed. Un-versioned requests get a short
      // cache as a safe default.
      if (isJson && query?.includes("v=")) {
        res.setHeader("Cache-Control", "public, max-age=31536000, immutable");
      } else if (urlPath.endsWith(".version")) {
        res.setHeader("Cache-Control", "no-cache");
      } else {
        res.setHeader("Cache-Control", "public, max-age=300");
      }
      res.end(content);
    } catch {
      next();
    }
  };
}

export default defineConfig({
  define: {
    __APP_VERSION__: JSON.stringify(pkg.version),
    __PROGRAMME_COUNT__: JSON.stringify(programmeCount),
    // Admission cycle (JUPAS entry year) the data targets — see package.json
    // "admissionCycle". Independent of the app version; bump only on a data refresh.
    __ADMISSION_CYCLE__: JSON.stringify(pkg.admissionCycle ?? ""),
    __BUILD_SHA__: JSON.stringify(buildSha),
    __BUILD_DATE__: JSON.stringify(buildDate),
  },
  plugins: [
    react(),
    {
      name: "serve-data",
      configureServer(server) {
        server.middlewares.use(serveDataMiddleware());
      },
      configurePreviewServer(server) {
        server.middlewares.use(serveDataMiddleware());
      },
    },
  ],
  base: "./",
  server: {
    fs: {
      allow: ["."],
    },
    allowedHosts: [".trycloudflare.com"],
  },
});
