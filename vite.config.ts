import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import { readFile } from "node:fs/promises";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { resolve } from "node:path";

const projectDir = fileURLToPath(new URL(".", import.meta.url));
const pkg = JSON.parse(readFileSync(new URL("./package.json", import.meta.url), "utf-8"));
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
