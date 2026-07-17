import type { StudentGrades } from "../types/jupas";
import { isCategoryCGrade, normalizeCategoryCGrade } from "./categoryC";
import { canonicalCategoryBGrade, isCategoryBGrade, isCategoryBSubject } from "./categoryB";
import { CAT_A_SUBJECTS, CAT_B_SUBJECTS, CAT_C_SUBJECTS, CORE_SUBJECTS, M12_SUBJECT, M1_SUBJECT, M2_SUBJECT } from "./subjects";
import { trimTrailingNulls } from "./arrays";

const MAX_HASH_LENGTH = 4096;
const MAX_SUBJECT_LENGTH = 180;
const MAX_GRADE_LENGTH = 40;
const MAX_PICKED_PROGRAMMES = 20;
const VALID_GRADES = new Set(["5**", "5*", "5", "4", "3", "2", "1", "A", "B", "C", "D", "E", "U"]);
// Every JUPAS code is "JS" + 4 chars from [0-9A-Z] — standard programmes are
// JS#### (4 digits), SSSDP ones are JSS<letter><2 digits> (e.g. JSSU67). The
// old /^JS\d{4}$/ silently dropped the 57 SSSDP programmes from share URLs and
// localStorage; this charset-aware pattern accepts them all and is agnostic to
// any future code shape JUPAS might introduce within that envelope.
export const PROGRAMME_CODE_PATTERN = /^JS[A-Z0-9]{4}$/;
const SLOT_SUBJECT_PATTERN = /^(elective-[1-4]|cat-c|cat-b):subject$/;
const VALID_SUBJECTS = new Set([...CORE_SUBJECTS, M12_SUBJECT, ...CAT_A_SUBJECTS, ...CAT_C_SUBJECTS, ...CAT_B_SUBJECTS]);
// Retaken-subject names also include the SPECIFIC extended-maths modules (the
// grade is stored under M1/M2, not the combined key), so accept those too.
const VALID_RETAKE_SUBJECTS = new Set([...VALID_SUBJECTS, M1_SUBJECT, M2_SUBJECT]);
const CAT_C_SET = new Set<string>(CAT_C_SUBJECTS);
const CAT_B_SET = new Set<string>(CAT_B_SUBJECTS);

// Single hash format: `#b=…` (bit-packed binary, base64url). The
// reader rejects anything else. Legacy reader paths (deflate-
// compressed `a=`, tight URLSearchParams, pre-v2 JSON-in-hash) were
// removed since nothing in the wild yet uses them.
const BINARY_PREFIX = "b=";

// Binary format constants. Layout (v2):
//   [4 bits version=2]
//   CORE (fixed):
//     [5 bits subject count N] then N × ([6 bits subject ID][4 bits grade ID])
//     [5 bits pick count M]    then M × ([1 bit present] + if present [24 bits code])
//                              code = 4 trailing chars, each a 6-bit CODE_CHARSET index
//     [1 bit sharing][1 bit showScores][1 bit mode]   (mode: 1=social, 0=advisor)
//   TAIL (byte-aligned, extensible): a sequence of TLV blocks
//     align to next byte; then repeat: [8 bits tag][8 bits byte-length][payload]
//     A reader skips tags it doesn't know via the length, so NEW optional fields
//     are added as a new tag WITHOUT a version bump or breaking old/new links.
//     tag 0 = end/padding. TAG_NAME(1) = UTF-8 profile name.
//
// v1 (pre-launch) used a 14-bit NUMERIC code and a flat name+mode tail; it was
// never public, so v2 is a clean break — the version guard makes any stray v1
// link decode to nothing rather than a wrong plan.
//
// SUBJECT_ID_LIST is APPEND-ONLY: the index is the binary ID, so reordering or
// deleting entries would break every previously-shared URL. New subjects always
// go at the end. Likewise TLV tags are append-only and never re-numbered.
const BINARY_VERSION = 2;

// Programme codes pack as 4 × 6-bit indices into this 36-symbol charset (so the
// constant "JS" prefix costs nothing and any JS+4-alphanumeric code round-trips,
// independent of the dataset — a shared link still decodes correctly after the
// catalog changes between encode and decode).
const CODE_CHARSET = "0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZ";
const CODE_CHAR_TO_ID: Record<string, number> = {};
for (let i = 0; i < CODE_CHARSET.length; i++) CODE_CHAR_TO_ID[CODE_CHARSET[i]] = i;

// Extensible-tail TLV tags. APPEND-ONLY — never renumber or reuse.
const TAG_NAME = 1;
const TAG_EXT_GRADES = 2;
// Category B (Applied Learning). ApL subjects can't ride the 6-bit subject-ID
// space (it's full at 36/64 and the ApL list grows across chunks) and ApL result
// names aren't DSE grades, so they get their own tag: a sequence of
// [1-byte subjLen][subj UTF-8][1-byte gradeLen][grade UTF-8] records. Subject is
// stored as TEXT (not an index) so a shared link still decodes after the ApL
// catalog changes — same robustness guarantee as the programme-code packing.
const TAG_APL = 3;
// Retaken subjects (HKDSE repeater). Payload = a sequence of
// [1-byte subjLen][subj UTF-8] records. Subject stored as TEXT (like TAG_APL)
// so a shared link round-trips independent of the subject-ID catalog.
const TAG_RETAKE = 4;
const SUBJECT_ID_LIST: readonly string[] = [
  "Chinese Language",
  "English Language",
  "Mathematics (Compulsory Part)",
  "Citizenship and Social Development",
  "Mathematics Extended Part (Module 1 or 2)",
  "Mathematics Extended Part (Module 1)",
  "Mathematics Extended Part (Module 2)",
  "Biology",
  "Chemistry",
  "Physics",
  "Economics",
  "Geography",
  "History",
  "Chinese History",
  "Information and Communication Technology",
  "Business, Accounting and Financial Studies",
  "Design and Applied Technology",
  "Health Management and Social Care",
  "Tourism and Hospitality Studies",
  "Chinese Literature",
  "Literature in English",
  "Technology and Living (Food Science and Technology)",
  "Visual Arts",
  "Music",
  "Physical Education",
  "Ethics and Religious Studies",
  "Integrated Science",
  "Combined Science: Biology + Chemistry",
  "Combined Science: Biology + Physics",
  "Combined Science: Physics + Chemistry",
  "French: Advanced Diploma of French Language Studies / Diploma of French Language Studies",
  "German: Goethe-Certificate",
  "Japanese: Japanese-Language Proficiency Test",
  "Korean: Test of Proficiency in Korean II",
  "Spanish: Diploma of Spanish as a Foreign Language",
  "Urdu: Urdu (International)",
];
const SUBJECT_TO_ID: Record<string, number> = {};
SUBJECT_ID_LIST.forEach((s, i) => { SUBJECT_TO_ID[s] = i; });

const GRADE_TO_ID: Record<string, number> = {
  "5**": 0, "5*": 1, "5": 2, "4": 3, "3": 4, "2": 5, "1": 6, "U": 7,
  "A": 8, "B": 9, "C": 10, "D": 11, "E": 12,
};
const ID_TO_GRADE: Record<number, string> = {};
for (const [g, i] of Object.entries(GRADE_TO_ID)) ID_TO_GRADE[i] = g;

export type HashState = {
  grades: StudentGrades;
  pickedCodes: (string | null)[];
  sharing: boolean;
  showScores?: boolean;
  /** Canonical names of subjects the candidate retook (HKDSE repeater). */
  retakenSubjects?: string[];
  /** Profile name (active profile when URL was generated). Optional –
   *  carried through the URL so a recipient saving the preview can
   *  default to the sender's name instead of "Imported plan". */
  name?: string;
  /** Share audience the URL was generated for. "advisor" = detailed
   *  Analysis read, "social" = recap card. Absent/older URLs decode to
   *  "advisor". Only meaningful when `sharing` is true. */
  mode?: "advisor" | "social";
};

const MAX_PROFILE_NAME_BYTES = 63;

// Max profile-name LENGTH (characters), enforced on every create/rename in App
// and on the rename input's maxLength. Kept under the byte budget above so a
// name never gets truncated when packed into a share URL.
export const MAX_PROFILE_NAME = 15;

function sanitizeGrade(grade: unknown): string | undefined {
  if (typeof grade !== "string" || grade.length > MAX_GRADE_LENGTH) return undefined;
  const upper = grade.trim().toUpperCase();
  if (VALID_GRADES.has(upper)) return upper;
  const catC = normalizeCategoryCGrade(grade);
  if (catC && isCategoryCGrade(catC)) return catC;
  return undefined;
}

function sanitizeSubject(subject: unknown): string | undefined {
  if (typeof subject !== "string") return undefined;
  const trimmed = subject.trim();
  if (!trimmed || trimmed.length > MAX_SUBJECT_LENGTH) return undefined;
  return trimmed;
}

function sanitizeSelectedSubject(subject: unknown): string | undefined {
  const sanitized = sanitizeSubject(subject);
  return sanitized && VALID_SUBJECTS.has(sanitized) ? sanitized : undefined;
}

function sanitizePickedCodes(codes: unknown): (string | null)[] {
  if (!Array.isArray(codes)) return [];
  const sanitized = codes
    .map((code) => {
      if (typeof code !== "string") return null;
      const trimmed = code.trim().toUpperCase();
      return PROGRAMME_CODE_PATTERN.test(trimmed) ? trimmed : null;
    })
    .slice(0, MAX_PICKED_PROGRAMMES);

  return trimTrailingNulls(sanitized);
}

export function sanitizeGrades(rawGrades: unknown): StudentGrades {
  if (!rawGrades || typeof rawGrades !== "object" || Array.isArray(rawGrades)) return {};
  const grades: StudentGrades = {};
  for (const [rawSubject, rawGrade] of Object.entries(rawGrades)) {
    const subject = sanitizeSubject(rawSubject);
    if (subject && SLOT_SUBJECT_PATTERN.test(subject)) {
      const selectedSubject = sanitizeSelectedSubject(rawGrade);
      if (selectedSubject) grades[subject] = selectedSubject;
      continue;
    }
    // ApL subject → ApL result level (not a DSE grade): keep the canonical form.
    if (subject && CAT_B_SET.has(subject)) {
      const aplGrade = typeof rawGrade === "string" ? canonicalCategoryBGrade(rawGrade) : undefined;
      if (aplGrade) grades[subject] = aplGrade;
      continue;
    }
    const grade = sanitizeGrade(rawGrade);
    if (subject && grade) grades[subject] = grade;
  }
  return grades;
}

// --- base64url helpers (no padding) ---

function bytesToBase64Url(bytes: Uint8Array): string {
  let binary = "";
  for (let i = 0; i < bytes.length; i++) binary += String.fromCharCode(bytes[i]);
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

function base64UrlToBytes(value: string): Uint8Array {
  const padded = value.replace(/-/g, "+").replace(/_/g, "/") + "=".repeat((4 - (value.length % 4)) % 4);
  const binary = atob(padded);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return bytes;
}

// --- bit packer / unpacker for the binary v2 format ---

class BitWriter {
  private bytes: number[] = [];
  private cur = 0;
  private bitsInCur = 0;
  write(value: number, bits: number): void {
    for (let i = bits - 1; i >= 0; i--) {
      this.cur = (this.cur << 1) | ((value >> i) & 1);
      this.bitsInCur++;
      if (this.bitsInCur === 8) {
        this.bytes.push(this.cur);
        this.cur = 0;
        this.bitsInCur = 0;
      }
    }
  }
  // Flush any partial byte (zero-padded) so subsequent writes start on a byte
  // boundary. Used before the byte-aligned TLV tail.
  align(): void {
    if (this.bitsInCur > 0) {
      this.bytes.push(this.cur << (8 - this.bitsInCur));
      this.cur = 0;
      this.bitsInCur = 0;
    }
  }
  finish(): Uint8Array {
    this.align();
    return new Uint8Array(this.bytes);
  }
}

class BitReader {
  private pos = 0;
  constructor(private readonly bytes: Uint8Array) {}
  read(bits: number): number {
    let value = 0;
    for (let i = 0; i < bits; i++) {
      const byteIdx = this.pos >> 3;
      const bitIdx = 7 - (this.pos & 7);
      const bit = byteIdx < this.bytes.length ? (this.bytes[byteIdx] >> bitIdx) & 1 : 0;
      value = (value << 1) | bit;
      this.pos++;
    }
    return value;
  }
  // Advance to the next byte boundary (mirrors BitWriter.align on decode).
  align(): void {
    this.pos = (this.pos + 7) & ~7;
  }
  // Whole bytes left from the current (assumed byte-aligned) position.
  bytesLeft(): number {
    return this.bytes.length - (this.pos >> 3);
  }
}

function encodeBinary(state: HashState): string {
  const w = new BitWriter();
  w.write(BINARY_VERSION, 4);

  // Subjects with grades. Skip slot-mapping entries (elective-N:subject /
  // cat-c:subject / cat-b:subject) – they're recoverable on read.
  const subjects: Array<[number, number]> = [];
  const extendedGrades: Array<[number, string]> = [];
  const aplGrades: Array<[string, string]> = [];
  for (const [subject, grade] of Object.entries(state.grades)) {
    if (subject.includes(":subject")) continue;
    // ApL: not in the 6-bit subject space and not a DSE grade — carried by TAG_APL.
    if (isCategoryBSubject(subject)) {
      if (isCategoryBGrade(grade)) aplGrades.push([subject, grade]);
      continue;
    }
    const sid = SUBJECT_TO_ID[subject];
    const gid = GRADE_TO_ID[grade];
    if (sid === undefined) continue;
    if (gid === undefined) {
      const sanitized = sanitizeGrade(grade);
      if (sanitized) extendedGrades.push([sid, sanitized]);
      continue;
    }
    subjects.push([sid, gid]);
  }
  // 5 bits = max 31 entries; SUBJECT_ID_LIST has 36 so cap at 31. In practice
  // a candidate has 4 cores + up to 4 electives + 1 M1/M2 + 1 Cat-C ≈ 10.
  if (subjects.length > 31) subjects.length = 31;
  w.write(subjects.length, 5);
  for (const [sid, gid] of subjects) {
    w.write(sid, 6);
    w.write(gid, 4);
  }

  // Picks – preserve sparse-array order with a present bit. Present picks carry
  // 24 bits (4 chars × 6-bit charset); absent slots cost just the 1 present bit.
  const picks = state.pickedCodes.slice(0, MAX_PICKED_PROGRAMMES);
  w.write(picks.length, 5);
  for (const code of picks) {
    if (code && PROGRAMME_CODE_PATTERN.test(code)) {
      w.write(1, 1);
      for (let i = 2; i < 6; i++) w.write(CODE_CHAR_TO_ID[code[i]], 6);
    } else {
      w.write(0, 1);
    }
  }

  // Core flags.
  w.write(state.sharing ? 1 : 0, 1);
  w.write(state.showScores ? 1 : 0, 1);
  w.write(state.mode === "social" ? 1 : 0, 1);

  // Extensible byte-aligned TLV tail. The profile name is the first tag; any
  // future optional field is just another tag and needs no version bump.
  w.align();
  const nameRaw = (state.name || "").trim();
  if (nameRaw) {
    const bytes = new TextEncoder().encode(nameRaw).slice(0, MAX_PROFILE_NAME_BYTES);
    writeTLV(w, TAG_NAME, bytes);
  }
  const extBytes = encodeExtendedGrades(extendedGrades);
  if (extBytes.length > 0) writeTLV(w, TAG_EXT_GRADES, extBytes);
  const aplBytes = encodeAplGrades(aplGrades);
  if (aplBytes.length > 0) writeTLV(w, TAG_APL, aplBytes);
  const retakeBytes = encodeRetakenSubjects(state.retakenSubjects || []);
  if (retakeBytes.length > 0) writeTLV(w, TAG_RETAKE, retakeBytes);

  return BINARY_PREFIX + bytesToBase64Url(w.finish());
}

// Write one byte-aligned TLV block: [8-bit tag][8-bit byte length][payload].
// `bytes` must already be ≤ 255 long (the only writer, the name, is capped well
// under that). Assumes the writer is byte-aligned.
function writeTLV(w: BitWriter, tag: number, bytes: Uint8Array): void {
  w.write(tag, 8);
  w.write(bytes.length & 0xFF, 8);
  for (const b of bytes) w.write(b, 8);
}

function decodeBinary(payload: string): HashState | null {
  try {
    const bytes = base64UrlToBytes(payload);
    if (bytes.length === 0) return null;
    const r = new BitReader(bytes);
    const version = r.read(4);
    if (version !== BINARY_VERSION) return null;

    const rawGrades: Record<string, unknown> = {};
    const n = r.read(5);
    for (let i = 0; i < n; i++) {
      const sid = r.read(6);
      const gid = r.read(4);
      const subject = SUBJECT_ID_LIST[sid];
      const grade = ID_TO_GRADE[gid];
      if (subject && grade) rawGrades[subject] = grade;
    }
    const grades = reassignElectiveSlots(sanitizeGrades(rawGrades));

    const m = r.read(5);
    const rawPicks: (string | null)[] = [];
    for (let i = 0; i < m; i++) {
      const present = r.read(1);
      if (present !== 1) { rawPicks.push(null); continue; }
      let chars = "";
      let ok = true;
      for (let k = 0; k < 4; k++) {
        const ch = CODE_CHARSET[r.read(6)];
        if (ch === undefined) ok = false; else chars += ch;
      }
      rawPicks.push(ok ? `JS${chars}` : null);
    }
    const pickedCodes = sanitizePickedCodes(rawPicks);

    const sharing = r.read(1) === 1;
    const showScores = r.read(1) === 1;
    const mode: "advisor" | "social" = r.read(1) === 1 ? "social" : "advisor";

    // Extensible TLV tail. Unknown tags are skipped via their length, so a newer
    // link with extra fields still decodes here; an older link with fewer tags
    // simply runs out of bytes (read(8) → 0 → tag 0 → stop).
    r.align();
    let name: string | undefined;
    const extRawGrades: Record<string, unknown> = {};
    const aplRawGrades: Record<string, string> = {};
    let retakenSubjects: string[] | undefined;
    while (r.bytesLeft() >= 2) {
      const tag = r.read(8);
      if (tag === 0) break; // padding / end of tail
      const len = r.read(8);
      if (len > r.bytesLeft()) break; // truncated/corrupt — stop safely
      const buf = new Uint8Array(len);
      for (let i = 0; i < len; i++) buf[i] = r.read(8);
      if (tag === TAG_NAME && len <= MAX_PROFILE_NAME_BYTES) {
        try {
          const decoded = new TextDecoder().decode(buf).trim();
          if (decoded) name = decoded;
        } catch {
          // garbage bytes – ignore, leave name undefined
        }
      } else if (tag === TAG_EXT_GRADES) {
        Object.assign(extRawGrades, decodeExtendedGrades(buf));
      } else if (tag === TAG_APL) {
        Object.assign(aplRawGrades, decodeAplGrades(buf));
      } else if (tag === TAG_RETAKE) {
        retakenSubjects = decodeRetakenSubjects(buf);
      }
      // Unknown tags: payload already consumed, loop continues.
    }
    Object.assign(grades, sanitizeGrades(extRawGrades));
    // ApL grades are pre-validated in decodeAplGrades (subject ∈ Cat-B, valid
    // result level), so they bypass sanitizeGrades (which only knows DSE grades).
    Object.assign(grades, aplRawGrades);
    reassignElectiveSlots(grades);

    // Only keep retaken marks for subjects that actually decoded a grade — a
    // stale mark (subject dropped) is meaningless and would never penalise.
    if (retakenSubjects) retakenSubjects = retakenSubjects.filter((s) => s in grades);

    if (Object.keys(grades).length === 0 && pickedCodes.length === 0) return null;
    return { grades, pickedCodes, sharing, showScores, name, mode, ...(retakenSubjects && retakenSubjects.length ? { retakenSubjects } : {}) };
  } catch (e) {
    console.error("Failed to decode binary hash", e);
    return null;
  }
}

function encodeExtendedGrades(items: Array<[number, string]>): Uint8Array {
  if (items.length === 0) return new Uint8Array();
  const bytes: number[] = [];
  const encoder = new TextEncoder();
  for (const [sid, grade] of items) {
    const gradeBytes = encoder.encode(grade).slice(0, MAX_GRADE_LENGTH);
    if (bytes.length + 2 + gradeBytes.length > 255) break;
    bytes.push(sid & 0xFF, gradeBytes.length & 0xFF, ...gradeBytes);
  }
  return new Uint8Array(bytes);
}

function decodeExtendedGrades(bytes: Uint8Array): Record<string, string> {
  const out: Record<string, string> = {};
  const decoder = new TextDecoder();
  let i = 0;
  while (i + 2 <= bytes.length) {
    const sid = bytes[i++];
    const len = bytes[i++];
    if (i + len > bytes.length) break;
    const subject = SUBJECT_ID_LIST[sid];
    const grade = decoder.decode(bytes.slice(i, i + len));
    i += len;
    if (subject && grade) out[subject] = grade;
  }
  return out;
}

// TAG_APL payload: a sequence of [subjLen][subj UTF-8][gradeLen][grade UTF-8].
// Subject + grade both stored as text (see TAG_APL note) so it round-trips
// independent of the ApL catalog. Capped to one TLV byte-length (255).
function encodeAplGrades(items: Array<[string, string]>): Uint8Array {
  if (items.length === 0) return new Uint8Array();
  const bytes: number[] = [];
  const encoder = new TextEncoder();
  for (const [subject, grade] of items) {
    const sBytes = encoder.encode(subject).slice(0, MAX_SUBJECT_LENGTH);
    const gBytes = encoder.encode(grade).slice(0, MAX_GRADE_LENGTH);
    if (bytes.length + 2 + sBytes.length + gBytes.length > 255) break;
    bytes.push(sBytes.length & 0xFF, ...sBytes, gBytes.length & 0xFF, ...gBytes);
  }
  return new Uint8Array(bytes);
}

function decodeAplGrades(bytes: Uint8Array): Record<string, string> {
  const out: Record<string, string> = {};
  const decoder = new TextDecoder();
  let i = 0;
  while (i + 1 <= bytes.length) {
    const sLen = bytes[i++];
    if (i + sLen + 1 > bytes.length) break;
    const subject = decoder.decode(bytes.slice(i, i + sLen));
    i += sLen;
    const gLen = bytes[i++];
    if (i + gLen > bytes.length) break;
    const grade = decoder.decode(bytes.slice(i, i + gLen));
    i += gLen;
    // Only accept a recognised ApL subject + result level (stored canonically).
    const canonical = canonicalCategoryBGrade(grade);
    if (CAT_B_SET.has(subject) && canonical) out[subject] = canonical;
  }
  return out;
}

// TAG_RETAKE payload: a sequence of [subjLen][subj UTF-8] records. Subjects
// stored as text so the link round-trips independent of the subject catalog.
function encodeRetakenSubjects(subjects: string[]): Uint8Array {
  if (subjects.length === 0) return new Uint8Array();
  const bytes: number[] = [];
  const encoder = new TextEncoder();
  for (const subject of subjects) {
    if (!VALID_RETAKE_SUBJECTS.has(subject)) continue;
    const sBytes = encoder.encode(subject).slice(0, MAX_SUBJECT_LENGTH);
    if (bytes.length + 1 + sBytes.length > 255) break;
    bytes.push(sBytes.length & 0xFF, ...sBytes);
  }
  return new Uint8Array(bytes);
}

function decodeRetakenSubjects(bytes: Uint8Array): string[] {
  const out: string[] = [];
  const decoder = new TextDecoder();
  let i = 0;
  while (i + 1 <= bytes.length) {
    const sLen = bytes[i++];
    if (i + sLen > bytes.length) break;
    const subject = decoder.decode(bytes.slice(i, i + sLen));
    i += sLen;
    if (VALID_RETAKE_SUBJECTS.has(subject) && !out.includes(subject)) out.push(subject);
  }
  return out;
}

// Reassign elective-1..4 / cat-c slot subjects from the order non-core
// subjects appear in `grades`. Used by both binary and parseHashState
// decode paths.
function reassignElectiveSlots(grades: StudentGrades): StudentGrades {
  const CORE = new Set([
    "Chinese Language",
    "English Language",
    "Mathematics (Compulsory Part)",
    "Citizenship and Social Development",
    "Mathematics Extended Part (Module 1)",
    "Mathematics Extended Part (Module 2)",
    "Mathematics Extended Part (Module 1 or 2)",
  ]);
  let electiveCount = 1;
  for (const subject of Object.keys(grades)) {
    if (CORE.has(subject) || subject.includes(":subject")) continue;
    if (CAT_C_SET.has(subject)) {
      if (!grades["cat-c:subject"]) grades["cat-c:subject"] = subject;
      continue;
    }
    if (CAT_B_SET.has(subject)) {
      if (!grades["cat-b:subject"]) grades["cat-b:subject"] = subject;
      continue;
    }
    if (electiveCount > 4) continue;
    const slot = `elective-${electiveCount}:subject`;
    if (!grades[slot]) {
      grades[slot] = subject;
      electiveCount++;
    }
  }
  return grades;
}

function hasEncodableContent(state: HashState): boolean {
  if (state.name && state.name.trim()) return true;
  if (state.pickedCodes.some(Boolean)) return true;
  for (const [subject, grade] of Object.entries(state.grades)) {
    if (!grade) continue;
    if (subject.includes(":subject")) continue;
    if (subject in SUBJECT_TO_ID) return true;
    if (isCategoryBSubject(subject)) return true;
  }
  return false;
}

function encodeHash(state: HashState): string {
  // Empty state → drop the hash entirely so the URL is just the path.
  // Otherwise always emit `#b=…` – single uniform format.
  if (!hasEncodableContent(state)) return "";
  return encodeBinary(state);
}

function decodeHash(hash: string): HashState | null {
  if (!hash) return null;
  if (hash.length > MAX_HASH_LENGTH) return null;
  if (!hash.startsWith(BINARY_PREFIX)) return null;
  return decodeBinary(hash.slice(BINARY_PREFIX.length));
}

// --- module-level cache + sync read ---

let cachedState: HashState | null = null;
let cachedHash: string | null = null;

// Binary decode is synchronous now (no more DecompressionStream), so
// preload doesn't need to be async. The signature stays a Promise so
// main.tsx's `preloadHashState().finally(...)` keeps working without
// changes, and so we have a hook to introduce async startup work later.
export function preloadHashState(): Promise<HashState | null> {
  const hash = window.location.hash.slice(1);
  cachedHash = hash;
  cachedState = decodeHash(hash);
  return Promise.resolve(cachedState);
}

export function readHashState(): HashState | null {
  const current = window.location.hash.slice(1);
  if (current !== cachedHash) {
    cachedHash = current;
    cachedState = current ? decodeHash(current) : null;
  }
  return cachedState;
}

// --- writers ---

function scheduleWrite(state: HashState | null) {
  const hash = state ? encodeHash(state) : "";
  cachedHash = hash;
  cachedState = state;
  const url = hash ? `#${hash}` : window.location.pathname + window.location.search;
  // Mark the entry as app-owned (jcOwn) and keep any existing state. The mobile
  // back-button trap (App.tsx) uses this marker to tell its own history entries
  // apart from foreign/pasted URLs — independent of the URL's (possibly stale)
  // plan content, since lower entries keep the plan as it was when last current.
  const prev = (window.history.state ?? {}) as Record<string, unknown>;
  window.history.replaceState({ ...prev, jcOwn: true }, "", url);
}

export function writeHashState(
  grades: StudentGrades,
  pickedCodes: (string | null)[],
  name?: string,
  retakenSubjects?: string[],
) {
  const hasContent = Object.keys(grades).length > 0 || pickedCodes.some(Boolean);
  if (!hasContent) {
    scheduleWrite(null);
    return;
  }
  scheduleWrite({ grades, pickedCodes, sharing: false, showScores: false, name, retakenSubjects });
}

// Pure encoder (no side effects) for the non-sharing calc-URL hash a
// profile would produce. Used to recognise "this incoming URL is exactly
// my own profile" – e.g. browser-back out of my own ShareView lands on my
// own calc URL, which must NOT be treated as a foreign share / view-mode.
// Returns the hash WITHOUT the leading "#".
export function encodeProfileHash(
  grades: StudentGrades,
  pickedCodes: (string | null)[],
  name?: string,
  retakenSubjects?: string[],
): string {
  return encodeHash({ grades, pickedCodes, sharing: false, showScores: false, name, retakenSubjects });
}

// `buildShareUrl` stays a Promise so consumers that already `await` it
// (ShareButton, enterShareMode) don't need to be touched.
export function buildShareUrl(
  grades: StudentGrades,
  pickedCodes: (string | null)[],
  showScores = false,
  name?: string,
  mode?: "advisor" | "social",
  retakenSubjects?: string[],
): Promise<string> {
  const hash = encodeHash({ grades, pickedCodes, sharing: true, showScores, name, mode, retakenSubjects });
  const base = `${window.location.origin}${window.location.pathname}${window.location.search}`;
  return Promise.resolve(hash ? `${base}#${hash}` : base);
}

export function setShowScoresInHash(showScores: boolean) {
  const current = cachedState;
  if (!current) return;
  scheduleWrite({ ...current, showScores });
}

export function buildEditUrlFromCurrentHash(): Promise<string> {
  const current = cachedState;
  const base = `${window.location.origin}${window.location.pathname}${window.location.search}`;
  if (!current) return Promise.resolve(base);
  const hash = encodeHash({ ...current, sharing: false, showScores: false });
  return Promise.resolve(hash ? `${base}#${hash}` : base);
}
