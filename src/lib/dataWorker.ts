/// <reference lib="webworker" />
import { buildProgrammeResult } from "./results";
import type { Programme, ProgrammeResult, StudentGrades } from "../types/jupas";

// Off-main-thread data layer for the JUPAS calculator.
//
// 1. `load` – fetches + JSON.parses the ~3.2MB unified dataset. Doing
//    this inline (the old localStorage path) blocked the main thread
//    for 100ms+ on every reload. The parsed programmes are kept here
//    AND posted back (the UI needs the raw list for the institution
//    filter + slot picker).
//
// 2. `compute` – runs the ~419 buildProgrammeResult calls (score +
//    eligibility + benchmark per programme) against a set of grades.
//    This is the work that made the step-1 grade buttons lag when it
//    ran on the main thread. Running it here keeps grade entry fully
//    reactive while results compute in the background, so step 2 is
//    ready by the time the user arrives. Results are returned "slim"
//    (no `programme` object) to keep the structured-clone transfer
//    small – the main thread re-attaches each programme by code.

type LoadRequest = { type: "load"; dataUrl: string; versionUrl: string };
type ComputeRequest = { type: "compute"; grades: StudentGrades; token: number };
type Request = LoadRequest | ComputeRequest;

// ProgrammeResult minus the (heavy, already-on-main) programme object.
export type SlimResult = Omit<ProgrammeResult, "programme"> & { code: string };

let loadedProgrammes: Programme[] = [];

// Strips UI bookkeeping keys (`<slot>:subject`, `m12:module`) so only real
// subject→grade entries reach the calc. Real subjects never contain a colon.
function visibleGrades(grades: StudentGrades): StudentGrades {
  return Object.fromEntries(Object.entries(grades).filter(([key]) => !key.includes(":")));
}

function post(message: unknown) {
  (self as unknown as Worker).postMessage(message);
}

self.onmessage = async (event: MessageEvent<Request>) => {
  const msg = event.data;
  if (!msg) return;

  if (msg.type === "load") {
    try {
      // Tiny version sidecar first so the data URL can carry a `?v=`
      // cache-buster – lets the browser cache the big JSON immutably
      // for a given version while a data update cleanly busts it.
      let version = "";
      try {
        const versionRes = await fetch(msg.versionUrl, { cache: "no-cache" });
        if (versionRes.ok) version = (await versionRes.text()).trim();
      } catch {
        // Sidecar missing – plain fetch still benefits from HTTP caching.
      }
      const dataUrl = version ? `${msg.dataUrl}?v=${encodeURIComponent(version)}` : msg.dataUrl;
      const dataRes = await fetch(dataUrl);
      if (!dataRes.ok) throw new Error(`Data request failed: ${dataRes.status}`);
      loadedProgrammes = (await dataRes.json()) as Programme[];
      post({ type: "loaded", programmes: loadedProgrammes, version });
    } catch (error) {
      post({ type: "error", message: error instanceof Error ? error.message : String(error) });
    }
    return;
  }

  if (msg.type === "compute") {
    const grades = visibleGrades(msg.grades);
    const results: SlimResult[] = loadedProgrammes.map((programme) => {
      const full = buildProgrammeResult(programme, grades);
      return {
        code: programme.jupas_code,
        calculation: full.calculation,
        eligibility: full.eligibility,
        comparisons: full.comparisons,
        band: full.band,
        hasScoreData: full.hasScoreData,
      };
    });
    post({ type: "computed", results, token: msg.token });
    return;
  }
};
