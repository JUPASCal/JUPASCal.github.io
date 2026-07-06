# JUPAS Cal — Excel Logic Documentation (v1.0.3, 2025 workbook)

Authoritative technical breakdown of the **legacy Excel JUPAS score calculator**
(`Archives/2025 JUPAS 計分器/下載嚟用 (v1.0.3) 2025 JUPAS Cal.xlsx`). This is the
reference for (a) the structured data migration into `jupas_2025_logic.json`, (b)
the React web app's calculator, and (c) **rebuilding a fresh annual version from
the data we hold**.

> **How to read this doc.** Sheet names are Chinese (the workbook is in Cantonese
> Chinese). Cell references are `Sheet!Cell`. "Verified" = read directly from the
> formula graph with `openpyxl`. Sections marked **PENDING** have not yet been
> exhaustively traced — see the [Coverage status](#14-coverage--exploration-status)
> table at the end.

---

## 1. Workbook map (22 sheets)

| Sheet | State | Role |
|---|---|---|
| `開始` | visible | Splash / start screen (1 cell) |
| **`主頁`** | visible | **User input + result display** (the only sheet a user touches) |
| `A123` | hidden | **Resolver**: turns a typed JS code into that programme's score/stats/eligibility |
| `All in One` | visible | "Super calculator" — full breakdown for one active programme |
| `CityU`…`SSSDP` (10) | visible | Per-institution detail/reference pages (annotations, weights, per-school notes) |
| **`計分版`** | hidden | **THE SCORING ENGINE** (474×104). Grade→score, weighting, Best-N selection |
| **`Reference Score Calculation`** | visible | **Master flat DB** (448×238): code, names, weight text, UQ/Med/LQ, quotas |
| `入學要求` | hidden | **Eligibility engine** + per-programme M1/2 / CatC / ApL gate flags |
| `Programme List (2024 & 2025)` | hidden | Programme roster / 2024↔2025 year crosswalk (DATA, §8.4) |
| `Offer Statistics` | hidden | Historical offer/application data (DATA, §8.4) |
| `Retake 扣分` | visible | Retake deduction — ⚠️ experimental/orphaned (§8.1) |
| `CUHK Ref Soc Conversion` | hidden | CUHK benchmark derivation — offline worktable (§8.2) |
| `選單` | hidden | Dropdown sources + named ranges + elective de-dup |

### Data-flow pipeline
```
主頁 (input) ──► 計分版 (engine) ──► A123 (resolver, INDEX/MATCH on JS code) ──► 主頁 (display)
                    ▲          ▲
           入學要求 (eligibility + gate flags)   Reference Score Calculation (names, weight text, stats)
```

---

## 2. Sheet `主頁` — input & display (verified)

### Input cell map
| Field | Cell | Notes |
|---|---|---|
| Chinese / English / Math (core) | `C8` / `C9` / `C10` | Grade level via dropdown |
| Citizenship & Social Dev (CSD) | `C11` | Binary `達標` / `不達標` |
| M1/M2 (Math extended) | `C12` | Optional |
| Elective 1–4 (subject) | `B15`–`B18` | Subject **name** (`B19` = a language subject, for SSSDP) |
| Elective 1–4 (grade) | `C15`–`C19` | Grade level |
| Digital-mode toggle | `D5` (`是`/`否`) | If `是`, grades are typed as numbers `0–7` in `D8:D19` instead of dropdowns |
| Include M1/2 toggle | `I5` (`是`/`否`) | Switches the score-overview between Best-N and Best-N(M) variants |
| JUPAS code to look up | `F12` | e.g. `JS4862` |
| Retake flags | `D31:D42` (`是`/`否`) | Per-subject "was this retaken this year?" |

### Outputs (read back from the engine / resolver)
- **Score overview** (no weighting): `G7/G8/I7/I8` = Best 4 / Best 5 / 3C+1X / 3C+2X, each `IF(計分版!E14=FALSE, <non-M>, <M variant>)`.
- **Per-programme row** (`F15:Q15`, mirrored at 18/21 for up to 3 picks): pulls institution, name, method, UQ/Median/LQ, **your score (`M15`)**, quota, intake, competition, and eligibility — all via the `A123` resolver.
- **2024/2025 score toggle** (`N12` etc.): historical benchmarks switch year via `A123!A1`.

---

## 3. Sheet `選單` — lookups & named ranges (verified)

- Named ranges drive the dropdowns: `等級`(grade levels `5**…U`), `丙類選修科`/`丙類科目等級`(Cat-C language subjects + their scales), `公社科`(`達標`/`不達標`), `第二/三/四選修科`.
- **Elective de-duplication**: columns `C/D/E` each = `IF(OR(this subject already chosen in another slot), "", subject)` so the same subject can't be picked twice across elective dropdowns.
- ⚠️ Three named ranges are broken `#REF!` (`第一選修科`, `數學延伸部份`, `選修科`) — vestigial; the live dropdowns use the explicit ranges. Don't rely on these names in a rebuild.

---

## 4. Sheet `計分版` — THE SCORING ENGINE (verified, exhaustive)

This is the brain. Two zones: a **header/conversion zone** (rows 1–35) and the
**per-programme block** (rows 36–470, allocated to 534).

### 4.1 Subject slot model (the 10 slots)
Every score is built from **10 subject slots**, in this fixed order:

| Slot | Engine col (grade) | Weighted col `V:AE` | Boosted `AF:AO` | Mask `AP:AY` | Meaning |
|---|---|---|---|---|---|
| 1 | K | V | AF | AP | Chinese |
| 2 | L | W | AG | AQ | English |
| 3 | M | X | AH | AR | Math (core) |
| 4 | N | *(Y — empty)* | AI | *(AS — empty)* | **CSD — computed but NOT scored** |
| 5 | O | Z | AJ | AT | M1/M2 |
| 6 | P | AA | AK | AU | Elective X1 |
| 7 | Q | AB | AL | AV | Elective X2 |
| 8 | R | AC | AM | AW | Elective X3 |
| 9 | S | AD | AN | AX | Elective X4 |
| 10 | T | AE | AO | AY | Language (SSSDP 5th) |

### 4.2 Grade → score conversion (rows 3–13)
Per-institution rows; each cell is
`IF(OR(grade invalid), 0, LOOKUP(grade, {scale})) + tiny_decimal`. **Two scales:**

- **"Bonus" 332A scale** `{1,2,3,4,5.5,7,8.5,0}` (5/5\*/5\*\* → 5.5/7/8.5): CityU (r3), PolyU (r5), CUHK (r6), HKUST (r7), HKU (r8).
- **Linear 7-point scale** `{1,2,3,4,5,6,7,0}`: HKBU (r4), LingU (r9), EdUHK (r10), HKMU (r11), and the `無加分制` no-bonus baseline (**r13**, used by SSSDP and as fallback).

**Tie-break decimals.** Each subject column adds a unique `+1e-10 … +9.5e-10`
(K=+1e-10, L=+2e-10, …, S=+9e-10, T=+0.95e-9). This guarantees no two subjects
score *exactly* equal, so `LARGE()`-based Best-N selection is deterministic.

CSD (`N`) = `IF(N2="達標",1,0)`.

### 4.3 Universal formula library (E3:E13) — the score overview
Non-weighted "what's my Best-N" numbers shown on `主頁`. Uses the **`無加分制`
row-13 scores**, cores `K13:M13` + electives `P13:S13` (M-variants add M1/2 `O13`):

| Cell | Label | Formula (essence) |
|---|---|---|
| E3 | Best 4 | `LARGE((K13:M13,P13:S13),1..4)` summed |
| E4 | Best 5 | …`,1..5` |
| E5 | 3C+1X | `SUM(K13:M13)+LARGE((P13:R13,S13),1)` |
| E6 | 3C+2X | `…+LARGE(…,1..2)` |
| E8/E9 | Best 4/5 (M) | include M1/2 `O13`: `LARGE((K13:M13,O13:S13),…)` |
| E12/E13 | 3C+1X/2X (M) | `SUM(K13:M13)+LARGE((O13:S13),…)` |

Toggles: `E14 = (主頁!I5="是")` include-M1/2; `E15 = (主頁!D5="是")` digital mode.

### 4.4 Per-programme weighted score (rows 36–470) — the core mechanism
Each row = one programme. **`J = SUMIF(AP:AY, TRUE, V:AE)`** — a *masked weighted sum*.

1. **Weighted scores** `V:AE`: `V = K$n × K` = (institution grade for that subject) × (programme's subject weight). `K$n` is the institution's scale row (see 4.7). M1/2 and language are gated:
   - `Z = IF(G="v", O$n×O, 0)` — M1/2 counts only if the programme's M1/2 flag (`G`, from `入學要求`) = `"v"`.
   - `AE = IF(H="E", T$n×T, 0)` — language counts only if the CatC flag (`H`) = `"E"`.
2. **Required-subject forcing** `AF:AO`: `AF = IF(BH=TRUE, V+99, V)`. The `+99` guarantees a *mandatory* subject ranks in the top-N. `BH:BQ` are per-programme required flags (literal `TRUE`; 121 programmes set at least one — typically English `BI` or Math `BJ`).
3. **Selection mask** `AP:AY` ("最後揀咗？" = finally selected?). Per slot, TRUE if required, **or** if the *boosted* score makes the top-N for the programme's method `E`:
   - `"Best 5"` → `> LARGE(AF:AO, 6)` (top 5 of 10)
   - `"Best 4"` → `> LARGE(AF:AO, 5)` (top 4)
   - `"3C2X"` → cores (Chi/Eng/Math) always TRUE; electives TRUE if `> LARGE(AJ:AO, 3)` (top 2 electives)
4. **Sum** `J = SUMIF(AP:AY, TRUE, V:AE)` — sums the **clean** `V:AE` values (not the +99 copies) for the selected slots. The +99 only ever biases *selection*, never the total.

> **Key elegance:** required-subject forcing and Best-N selection are decoupled
> from the summation. `+99` lives only in the ranking copy `AF:AO`; the money
> column `J` reads `V:AE`. A rebuild must preserve this separation or required
> subjects will inflate the score by 99.

### 4.5 Weight sourcing — three strategies (verified)
The weight cells `K:T` are populated **differently per institution**:

**(a) Plain constants** — most programmes: `1, 1.25, 1.5, 2, 2.5` typed by hand.

**(b) Subject-conditional weights** — when a bonus depends on *which* subject sits in an elective slot (the slot's subject name is `P1 = 主頁!B15`, etc.):
```
JS1103  P = IF(OR(P1="中國歷史","中國文學","歷史","視覺藝術"), 1.5, 1)
JS1200  P = IF(OR(P1="物理","化學","生物","經濟"), 2.5, 1)
```
For "best science ×2.5 / 2nd-best science ×1.5" rules, a **CityU helper block**
(`BT:CC`, rows 39–44) does the routing: score each elective slot only if it's a
qualifying science (`BT=IF(OR(P1=物理/化學/生物),P3,0)`), `LARGE`+`INDEX/MATCH` to
find which slot is best (`BZ`), then the 2nd-tier explicitly **excludes the
slot already used** (`IF(BT42=$BZ$40, 0, …)`) so a subject can't double-count.

**(c) Text-parsed weights — PolyU ONLY (rows 121–166).** PolyU's weighting is stored as free text in `Reference Score Calculation!P/Q/R` (primary/secondary/tertiary weighted-subject lists). A sub-table compiles it:
- Header rows 119/120 list **all 28 possible DSE subjects**.
- Each subject cell: `IF(ISNUMBER(SEARCH(subject, RSC!P98)),10, IF(…Q98…,7, IF(…R98…,5, <fallback SEARCH "其他科目">)))` → a **3-level tier 10/7/5** (with a special branch for `組合科學`/combined science).
- Each slot pulls its tier: `K121 = INDEX(BU121:CV121, MATCH("中國語文", BU120:CV120))`.

> **PolyU `10/7/5` magnitude:** the source weighting text literally uses `x10/x7/x5`
> prefixes (see §6.2), so ×10/×7/×5 ARE PolyU's stated multipliers — not an artifact.
> The only thing left to confirm by recalculation is that this magnitude reaches the
> displayed score unchanged; it's self-consistent regardless, since the student's
> score is only ever compared against PolyU benchmarks computed the same way.

**Strategy by institution:**

| Strategy | Institutions |
|---|---|
| Hand-entered constants + conditional `IF` (+ CityU `BT:CC` helper) | CityU, HKBU, CUHK, HKUST, HKU, LingU, EdUHK, HKMU, SSSDP |
| Text-parsed `SEARCH`→tier→`INDEX/MATCH` | **PolyU only** |

### 4.6 Participation gates (verified)
- **CSD**: slot 4 (`Y`, `AS`) is empty → CSD **never** contributes to score (eligibility-only).
- **M1/2**: counts only if `G="v"` (flag `入學要求!AB`).
- **Language**: counts only if `H="E"` (flag `入學要求!AC`).
- **ApL**: `I` (flag `入學要求!AD`) is carried into the engine but **not scored in the 2025 workbook** (ApL scoring was added later in the web app).

### 4.7 Per-institution scale blocks
The programme block is grouped into contiguous per-institution ranges; each uses
its own grade-scale row (`K$n`):

| Rows | Institution | Scale row | Weight strategy |
|---|---|---|---|
| 36–95 | CityU | `K$3` | manual + `BT:CC` helper |
| 97–119 | HKBU | `K$4` | manual |
| 121–166 | PolyU | `K$5` | **text-parser** |
| 168–240 | CUHK | `K$6` (some rows `K$13` no-bonus; JS4501/4502 special) | manual |
| 241–274 | HKUST | `K$7` | manual |
| 276–331 | HKU | `K$8` (retake rows ×0.9) | manual |
| 333–356 | LingU | `K$9` | manual |
| 358–384 | EdUHK | `K$9`* | manual |
| 386–414 | HKMU | `K$11` | manual |
| 416–470 | SSSDP | `K$13` (no-bonus) | manual |

\*EdUHK reuses LingU's row 9 — harmless, both are the identical linear scale.

### 4.8 Retake penalty (verified, narrow)
Only **4 HKU rows** (293, 310, 313, 314) apply a penalty:
`V = IF(K$15, K$8×K×0.9, K$8×K)` — i.e. **Chinese weighted score ×0.9** when the
Chinese-retake flag `K$15` (`= 主頁!D31` retook Chinese?) is set. Retake flags
`K15:T15` and `W15 = OR(K15:T15)` exist for all subjects but are only consumed
here in this sheet. **CUHK's retake logic is NOT in `計分版`** — it lives in the
`Retake 扣分` sheet, which is **orphaned/experimental** (§8.1) — it builds a
display only and never feeds the score.

### 4.9 Cat-C language (SSSDP) conversion
Cat-C languages (French/Japanese/German/Korean/Spanish/Urdu) use a bespoke matrix
(`AB11:AF16`) cross-walking the `C2/C1/B2…`, `N1/N2/N3`, and `A/B++…` grade scales,
resolved per institution through `AI/AJ` and surfaced via `AP11:AP20`, which
`T3:T20` (the language slot conversion) reference.

### 4.10 "For All in One" active-programme breakdown (rows 22–31)
A single-programme deep view feeding the `All in One` sheet. `B24 = 'All in One'!C8`
(active JS code); rows 23/25/27 `INDEX/MATCH` that code over the block (`36:534`)
to pull its weights and weighted values, rounded in 24/26/28. Rows 30–31 compute
the **institution-resolved grade** (`INDEX(K3:K11, MATCH(institution, J3:J11))`,
with the JS4501/4502 special-case forcing the no-bonus row).

---

## 5. Sheet `A123` — the resolver (verified)
Turns a typed JS code into a full programme record.

- Rows 21–502 mirror the master DB: `A`=code, `B`=institution, `C`=name, `D`=abbrev, `E`=method, `F/G/H`=UQ/Median/LQ, **`I`=your score (`= 計分版!J{n}`)**, `J`=quota, `K`=intake, `L`=Band-A competition, `M`=eligibility (`= 入學要求!Z{n}`).
- Active rows 16/17/18 take the typed code (`A16 = 主頁!F15`) and `INDEX(col, MATCH(code, A21:A502, 0))` to resolve every column — that's how `主頁!M15` ("你的分數") gets its value.
- Score-gap helpers (B5:H9): `your − UQ/Median/LQ`, plus a percentage variant; year toggle `A1 = (主頁!N12="是")`.

---

## 6. Sheet `Reference Score Calculation` — master DB (verified)

The "single source of truth": one programme per row (data rows 13+). Almost every
column is **raw literal DATA** (institution, names, weighting text, stats) that the
scrapers regenerate each cycle — *not catalogued here, per the logic-only rule*. The
**logic** is its schema and its few derived columns.

### 6.1 Dual-year schema (embodies the Year-Labeling Rule)
Two header rows (2 and 12) over a `A=2025年 / B=2024年` split (row 11). Columns are
grouped by year — **2024 (Y-1) drives scoring; 2025 holds current requirements**:

| Col(s) | Meaning | Year | Consumer |
|---|---|---|---|
| B | JS code | — | everything (`計分版`, `入學要求`, `A123`) |
| C / D | institution / faculty | — | display |
| E | programme name | — | `計分版!C`, `A123` |
| F | calc method (Best 4/5, 3C2X…) | — | `計分版!E`, `入學要求` |
| G/H/I/J | MEAN / UQ / Median / LQ (actual) | 2024 | `A123` stats (raw) |
| **K/L/M** | UQ / Median / LQ (**derived** — see §6.3) | 2025 | reverse-engineered benchmark |
| N/O | calc details 1/2 | 2024 | reference |
| **P/Q/R** | **weighting tiers 1/2/3** | 2024 | **PolyU parser** (`計分版` §4.5) |
| T | bonus system | 2024 | reference |
| U/V | quota / intake | — | `A123!J/K`, `入學要求!D` |
| W/X/**Y** | Band-A apps / offers / **ratio (derived)** | — | `A123!L` competition |
| Z | bonus system | 2025 | reference |
| AA/AB | entry requirement 1/2 (**derived** mirror) | 2025 | see §6.3 |
| AC | calc method | 2025 | reference |
| AD–AJ | updates / calc details / weighting tiers | 2025 | display |
| AK+ | other considerations, extra data, links | — | display |

> **Resolves the earlier `P/Q/R` vs `N/O/P` question.** The live PolyU parser reads
> **`P/Q/R` = the 2024 weighting tiers** — exactly the Year-Labeling Rule (scores use
> Y-1 logic). The stale `N/O/P` in a `計分版` comment was a previous column layout.

### 6.2 Weighting-text grammar (the format the PolyU parser depends on)
`P/Q/R` (and the 2025 set `AH/AI/AJ`) hold weightings as **text, one tier per
column**: `比重1 = ×10`, `比重2 = ×7`, `比重3 = ×5`. Cell format is `"x{N}: {subject
list}"` (e.g. `比重2 = "x7: 其他科目"`) or `"/"` for none. The parser tier-matches a
subject by **which column** it appears in; the `x{N}:` prefix confirms ×10/×7/×5 are
PolyU's real stated multipliers. **A rebuild must preserve this column-as-tier
convention** for the parser to keep working.

### 6.3 Derived (logic) columns
- **`Y` (Band-A) = `IFERROR(W/X, "新科目")`** — competition ratio = applications ÷ offers; `新科目` (new programme) on divide-by-zero.
- **`AA/AB` = `入學要求!AF/AG`** — mirror the eligibility sheet's free-text requirement columns (RSC and `入學要求` show identical requirement text).
- **`K/L/M` (derived 2025 UQ/Median/LQ)** = **`SUMIF(mask, TRUE, weighted)`** over per-programme **historical grade vectors** in the far-right columns (≈`BG:ID` — why the sheet is 238 cols wide). This is a **second embedded copy of the `計分版` engine** (§4.4) that *reverse-engineers* a weighted benchmark for institutions that publish raw grade profiles instead of weighted scores (e.g. CUHK).

### 6.4 "All in One" lookup (rows 3–9)
`B3 = 'All in One'!C8` (active code); `B7/B9 = CONCAT(code,"-2"/"-3")` handle a code
needing up to three weight variants. Mirrors the active-programme blocks in `計分版`
(§4.10) and `入學要求` (§7.7).

---

## 7. Sheet `入學要求` — eligibility engine + gate flags (verified, exhaustive)

435 programme rows (22–456); programme N is at **row 21 + N** (programme 1 = row 22).
Aligns 1:1 with the `計分版` block (`計分版!G36 = 入學要求!AB22`).

### 7.1 The student's grades live in row 3
Row 3 is the applicant's converted grades, pulled from the engine's **no-bonus
linear scale** (`計分版!K13:T13`), so eligibility is checked on the *level* scale
(5\*→6, 5\*\*→7):

| Col | L | M | N | O | P | Q | R | S | T | U | V |
|---|---|---|---|---|---|---|---|---|---|---|---|
| Subject | 中 | 英 | 數 | 公(CSD) | M1/2 | E1 | E2 | E3 | E4 | Lang(proc) | Lang(orig) |
| `row 3` | `計分版!K13` | `L13` | `M13` | `N13` | `O13` | `P13` | `Q13` | `R13` | `S13` | `IF(lang valid,3,0)` | `計分版!T2` |

`Q2:U2` = the elective subject **names** (`主頁!B15:B19`). Note: language is
flattened to a fixed `3` if any valid language grade exists — coarse.

### 7.2 Per-programme requirement levels (hand-keyed literals)
Each programme row stores its minimum levels:
- **`L:Q` = the levels USED by the checks**: 中 / 英 / 數 / 公(CSD) / E1 / E2. Baseline is `3 / 3 / 2 / 1 / 3 / 3` (中3 英3 數2 CSD-達標 + two electives ≥3), with per-programme overrides (e.g. row 300 = 英≥4).
- **`E:J` = a near-duplicate "source" set** (CSD encoded as `2` instead of `1`); **not consumed by the live checks** — treat as raw/intermediate. *(exact role unconfirmed; flagged.)*

### 7.3 The checks (`S:X`) — ⚠️ LEVEL-ONLY, not subject-specific
| Check | Formula | Meaning |
|---|---|---|
| `S` 中 | `IF(L_req > L3, 0, 1)` | core: direct level compare |
| `T` 英 | `IF(M_req > M3, 0, 1)` | core |
| `U` 數 | `IF(N_req > N3, 0, 1)` | core |
| `V` 公 | `IF(O_req > O3, 0, 1)` | CSD 達標 |
| `W` E1 | `IF(P_req > LARGE(P3:U3, 1), 0, 1)` | **best** elective ≥ level |
| `X` E2 | `IF(Q_req > LARGE(P3:U3, 2), 0, 1)` | **2nd-best** elective ≥ level |

> **Critical limitation for the rebuild:** the elective checks compare only against
> `LARGE(P3:U3, n)` — the student's best/2nd-best **by level, across ALL electives +
> M1/2 + language**. They do **NOT** verify the elective is a specific accepted
> subject (e.g. "must include Physics"). The `AB3` "subjects accepted as elective
> requirement" table is empty, and free-text subject requirements sit unused in
> `AF/AG` (`入學要求1` / `要求2`, almost all `/`). Subject-specific eligibility is
> therefore **not modelled** here — the React app later added proper elective-pool
> bipartite matching to fix exactly this.

### 7.4 The verdict (`Z`) and its variants
`Z` is the product (logical AND) of the checks → consumed as `A123!M` → `主頁` shows
`0→否`, `1→是`, `2→或有額外要求` (`2 = uncertain`):

| Variant | Count | Formula | Meaning |
|---|---|---|---|
| Standard | 348 | `=S*T*U*V*W*X` | all 6 checks must pass |
| One-elective | 15 | `=S*T*U*V*W` | drops the 2nd-elective requirement |
| Force-uncertain | ~11 | `=IF(S*T*U*V*W*X=0, 0, 2)` | pass→`2` (has non-checkable extra requirements) |
| SSSDP variant | 40 | `=IF(S*T*U*V*W>2, 2, …)` | SSSDP block (rows 416+) |
| Bespoke gate | few | `=S*…*X*AK111` | ANDs in a custom computed check |

### 7.5 Bespoke gates — embedded mini-calculators
For requirements that aren't per-subject levels (e.g. a **minimum aggregate score**),
a small calculator is embedded near the row. Example — JS3000 (PolyU): rows 108–111
recompute the student's Best-5 on PolyU's scale (`計分版!K5:T5`), build a top-5 mask,
and set `AK111 = IF(SUMIF(Best-5) < 34.5, 0, 1)`, which is multiplied into `Z107`.
So "Best-5 ≥ 34.5" becomes an eligibility gate.

### 7.6 Gate flags consumed by the engine (hand-set per programme)
- `AB{n}` → **M1/2 flag** (`v` = M1/2 participates in scoring) → `計分版!G`
- `AC{n}` → **CatC/language flag** (`E` = language counts) → `計分版!H`
- `AD{n}` → **ApL flag** (`NO`/…) → `計分版!I`

### 7.7 "For All in ONE" block (rows 17–18)
Parallel to `計分版`'s active-programme block: `B18 = 'All in One'!C8`, then
`INDEX/MATCH` that code over `22:533` to surface the active programme's requirements,
checks, verdict, and gate flags.

---

## 8. Other sheets (experimental / supporting)

### 8.1 `Retake 扣分` — retake deduction (⚠️ EXPERIMENTAL / orphaned)
A standalone reference sheet. **Nothing reads it** (0 external references), so it
**does not affect any calculated score**. Treat as an unfinished feature.
- **Inputs mirrored** (rows 3–8): the `主頁` retake-input rows + the `計分版!K15:T15` "retook this year?" flags — display only.
- **CUHK table** (rows 12–29): a *hard-coded* list of ~17 CUHK JS codes. Per row it surfaces the student's score (`INDEX 計分版!J…`), UQ/Median/LQ (from RSC), and a **per-programme deduction from `RSC!AV`** (DATA). The "combined score" column is an unfilled placeholder label (`最近3次`) — not computed.
- **HKU table** (rows 32+): per-programme rows over the HKU RSC block, with the full 10-slot per-subject breakdown (`計分版!V:AE`), a deduction from `RSC!AV`, and a "combined score" from `RSC!AQ`.
- Rows 90–92: links to CUHK/HKU official retake-policy PDFs.

> **Reality for a rebuild:** the only retake logic wired into scoring is the HKU
> Chinese `×0.9` in `計分版` (§4.8, 4 programmes). The deduction DATA exists in
> `RSC!AV/AQ` but is **never applied** to the displayed score. Treat retake as
> **not implemented**; `RSC!AV/AQ` are the only salvageable starting point.

### 8.2 `CUHK Ref Soc Conversion` — CUHK benchmark derivation (offline worktable)
A maintainer scratch sheet, **0 external references** — not part of the runtime calc
graph. Used to derive CUHK's weighted UQ/Median/LQ benchmarks from CUHK's *published
grade profiles* (CUHK discloses the admitted grade profile at each percentile, not a
weighted total).
- **Cols A–L (DATA):** per programme, three rows (UQ / M / LQ, col B) of the admitted grade profile — Chi/Eng/Maths/LS/M1-2/E1–E4 as grade levels + the published `Total` (col L).
- **Cols O–V (LOGIC):** convert each grade to a score via `IF(=5, 5.5, IF(="5*", 7, IF(="5**", 8.5, …)))` — the **CUHK bonus scale**, identical to `計分版` row 6 (§4.2).
- The conversion logic just re-implements the engine's CUHK scale; the grade profiles are DATA (regenerated yearly). It feeds nothing automatically — a manual derivation aid. CUHK's weighted benchmarks ultimately live in `RSC!K/L/M` (§6.3).

### 8.3 `All in One` — single-programme "super calculator" (display / orchestration)
The canonical detail view; **17 sheets link to it** ("go to All in One for weighting
& requirement details"). 185 formulas, but **no new calculation** — orchestration +
presentation only:
- **Input `C8`** = a manually-typed JS code. This is the **active-programme selector** that drives the active-programme blocks in `計分版` (§4.10), `入學要求` (§7.7), and `RSC` (§6.4) via `'All in One'!C8/E8`.
- Pulls the active programme's institution / name / quota / intake (RSC), basic requirements + eligibility verdict + Band-A competition (`入學要求`/RSC), and presents **both** the 2024 method/weighting (used for scoring — Year-Labeling Rule) and the 2025 method/weighting (reference). `加分制 (5**→8.5)` labels surface the scale in use.

### 8.4 `Offer Statistics` & `Programme List (2024 & 2025)` — DATA stores (schema only)
Pure literal data (0 formulas), regenerated each cycle — values not catalogued here.
- **`Offer Statistics`** (`A1:FW463`): per programme, per year (2018+), Band A–E **application** and **offer** counts — the source DATA behind `RSC!W/X` (Band-A apps/offers) → `RSC!Y` competition ratio (§6.3).
- **`Programme List (2024 & 2025)`**: a **year crosswalk** — cols A–F = 2024 (inst/code/faculty/name/abbrev), J–O = 2025 equivalent. Maps programmes across cycles (renames / code changes).

### 8.5 Per-school sheets (`CityU`…`SSSDP`) & `開始`
- **Per-school sheets**: one **filtered display** per institution — its programmes with code/name/method (RSC), Median/LQ benchmarks, **your score** (`=計分版!J{n}`, directly indexing that institution's block — e.g. `EdUHK!H2 = 計分版!J358`), the gap (`score − benchmark`), quota, and eligibility (`=入學要求!Z{n}`). **No new logic** — presentation of engine outputs; they defer weighting/requirement detail to `All in One`.
- **`開始`**: empty splash / start screen — trivial.

---

## 9. End-to-end worked trace
Type `JS4862` in `主頁!F12` →
`A123!A16 = 主頁!F15` → `B16 = INDEX(B21:B502, MATCH("JS4862", A21:A502, 0))` finds its row →
its `I`-column = `計分版!J{n}` → `J = SUMIF(mask, TRUE, weighted grades)` on **HKU's `K$8`**
scale, HKU weights, Best-5 selection → lands as `主頁!M15` "你的分數";
`A123!B5 = M15 − UQ` gives the gap vs the 2024 upper-quartile.

---

## 10. Notes for a 2026 rebuild

**What is DATA (changes yearly, per programme) vs LOGIC (stable):**

| DATA (regenerate each cycle) | Where in 2025 workbook |
|---|---|
| Institution, name, calc method | RSC `C/E/F` |
| Subject weights (incl. conditional `IF(subject,…)` rules) | `計分版` `K:T` |
| Required-subject flags | `計分版` `BH:BQ` |
| M1/2 · CatC · ApL participation flags | `入學要求` `AB/AC/AD` |
| PolyU weighting text | RSC `P/Q/R` |
| UQ / Median / LQ, quota, intake, competition | RSC `H/I/J/U/V/Y` |
| Eligibility requirements | `入學要求` |

| LOGIC (port once, keep stable) |
|---|
| Two grade→score scales + tie-break decimals |
| Best-N / 3C2X selection via `LARGE` over a 10-slot vector |
| `+99` required-subject forcing decoupled from the sum |
| Participation gates (CSD excluded; M1/2 & language gated) |
| HKU Chinese ×0.9 retake penalty |
| PolyU text→tier weight parser |
| Cat-C language conversion matrix |

**The React app already implements this model data-driven** (see
`JUPAS_2026_Unified_Data.json` + the calculator in `src/lib/`). A 2026 *Excel*
rebuild = refresh the DATA columns above and keep the LOGIC formulas intact.

**Known quirks / things to watch:**
- PolyU `10/7/5` magnitude (see §4.5) — verify by recalculation.
- Retake penalty is HKU-Chinese-only in this sheet; CUHK's is in `Retake 扣分`.
- JS4501/JS4502 (CUHK MBChB-GPS) are hard-coded onto the no-bonus scale.
- Year-labeling rule: **scores use 2025 (Y-1) logic; eligibility uses current-year requirements** (see `AGENTS.md`).

---

## 11. Structured migration target
The 2025 logic is extracted into `jupas_2025_logic.json` (admission rules,
weightings, retake penalties, metadata). That JSON + this spec are the inputs to
the web-app "brain" and to any annual rebuild.

---

## 12. Grade-to-score quick reference
- **5\*\*** = 7 (bonus scale 8.5) · **5\*** = 6 (7) · **5** = 5 (5.5) · **4** = 4 · **3** = 3 · **2** = 2 · **1** = 1 · **U** = 0
- CSD `達標` = 1 (eligibility only) · tie-break `+1e-10·(column index)`

---

## 13. Universal formula reference
| Formula | Pool | Top-N |
|---|---|---|
| Best 4 | cores + electives | 4 |
| Best 5 | cores + electives | 5 |
| 3C+1X | 3 cores + best elective | — |
| 3C+2X | 3 cores + best 2 electives | — |
| Best N (M) | + M1/2 in the pool | N |

---

## 14. Coverage & exploration status

| Sheet / area | Status |
|---|---|
| `主頁` input/display | ✅ Verified |
| `選單` lookups | ✅ Verified |
| `計分版` engine (all regions) | ✅ Verified — exhaustive |
| `A123` resolver | ✅ Verified |
| `Reference Score Calculation` | ✅ Verified — schema + derived columns (§6) |
| `入學要求` eligibility engine | ✅ Verified — exhaustive (§7) |
| `Retake 扣分` | ✅ Verified — ⚠️ experimental/orphaned, never affects score (§8.1) |
| `Offer Statistics` | ✅ DATA store — schema only (§8.4) |
| `Programme List (2024 & 2025)` | ✅ DATA store — year crosswalk (§8.4) |
| `CUHK Ref Soc Conversion` | ✅ Verified — offline worktable, not runtime (§8.2) |
| `All in One` | ✅ Verified — display/orchestration (§8.3) |
| Per-school sheets (CityU…SSSDP) | ✅ Verified — display views (§8.5) |
| `開始` | ✅ Trivial (empty splash) |
</content>
</invoke>
