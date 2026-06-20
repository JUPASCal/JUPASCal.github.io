// Lazy-loaded full programme details (overview + links).
//
// The unified dataset (loaded up front for the whole programme list) carries
// only a ~280-char plain-text preview of each description. The full structured
// overview — headings, paragraphs, list items, and the links institutions embed
// — plus the tuition "more info" URL are fetched on demand the first time any
// programme detail page opens, then cached for the rest of the session, so the
// detail panel can show everything without bloating first load.
//
// Built by `scripts/utils/build_programme_details.py`; bundled into dist by the
// deploy workflow.

// One inline run of the overview: plain text, or a link when `href` is present.
export type DescSpan = { text: string; href?: string };
// A block of the overview: heading / paragraph / list item.
export type DescBlock = { t: "h" | "p" | "li"; spans: DescSpan[] };
export type ProgrammeDetail = {
  blocks?: DescBlock[];
  tuition_url?: string;
};

const DETAILS_URL = `/data/processed/programme_details_2026.json?v=${__APP_VERSION__}`;

let cache: Promise<Record<string, ProgrammeDetail>> | null = null;

export function loadProgrammeDetails(): Promise<Record<string, ProgrammeDetail>> {
  if (!cache) {
    cache = fetch(DETAILS_URL)
      .then((res) => (res.ok ? (res.json() as Promise<Record<string, ProgrammeDetail>>) : {}))
      // Network/parse failure is non-fatal: the detail panel falls back to the
      // trimmed preview already in the unified data.
      .catch(() => ({}));
  }
  return cache;
}
