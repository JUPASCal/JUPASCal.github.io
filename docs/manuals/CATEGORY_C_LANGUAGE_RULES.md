# Category C Other Language Rules - 2026 Working Notes

Status: implemented for exact Category C UI levels and subject-aware scoring. The calculator now accepts exact source-level inputs such as `N1`, `C2`, `Grade 6`, and `A++`, while old broad `A-E` saved/shared values remain supported.

These notes capture institution-specific handling of HKDSE Category C / Other Language subjects for 2026 entry, based on the source screenshots and text supplied on 2026-06-23. The purpose is to separate source evidence from implementation decisions before changing the calculator.

## Implementation Questions

Category C rules have two separate meanings and must not be merged casually:

1. **Elective eligibility**: whether a Category C subject can satisfy an elective requirement.
2. **Admission-score conversion**: what point value a language qualification receives in the score formula.

The current unified data model mostly stores a generic `score_conversion_table.category_c` keyed by broad A-E grades. These sources are more detailed: they often map each language qualification directly to institution-specific points, and some schools use subject-specific thresholds for elective eligibility.

Implemented layer:

- `src/lib/categoryC.ts`: web-app Category C score and elective policy.
- `scripts/utils/calculation_engine.py`: mirrored Python reference conversion.
- `scripts/utils/test_category_c_policies.py`: focused policy regression checks.

Compatibility choice:

- New UI input writes exact reported levels (`N1`, `C2`, `Grade 6`, `A++`, etc.).
- Old broad `A-E` values remain accepted and map to each language's descending source buckets where possible.
- Share URLs keep the compact legacy grade IDs for common DSE grades. Exact Category C strings are stored in an append-only extended-grade TLV tail in `src/lib/hashState.ts`, so future values such as ApL attainment labels can be added without redesigning the URL header.

## UGC / HKMU Institutions

### CityUHK

Source: user screenshot Image #1.

Score conversion for Category C Other Language subjects for 2026 entry:

| Language | 7 | 5.5 | 4 | 3 |
|---|---|---|---|---|
| Japanese | N1 | N2 | N3 | - |
| Korean | Grade 6 | Grade 5 | Grade 4 | Grade 3 |
| French / German / Spanish | C2 | C1 | B2 | B1, A2 |
| Urdu | A++, A+, A | B++, B+ | B, C | D, E |

### HKBU

Source: user screenshot Image #2.

Score conversion for 2025 onwards:

| Language | 7 | 5.5 | 4 | 2.5 | 1 |
|---|---|---|---|---|---|
| Japanese | N1 | N2 | N3 | - | - |
| French / German / Spanish | C1, C2 | B1, B2 | A2 | - | - |
| Korean | Level 6 | Levels 4, 5 | Level 3 | - | - |
| Urdu | A++, A+, A | B++ | B+, B | C, D | E* |

### PolyU

Source: user screenshot Image #3.

Score conversion for 2025 Other Language subject grade attainments:

| Language | 8.5 | 7 | 5.5 | 4 | 3 |
|---|---|---|---|---|---|
| Japanese | N1 | - | N2 | - | N3 |
| Korean | 6 | 5 | - | 4 | 3 |
| French / German / Spanish | C2 | C1 | B2 | B1 | A2 |

Open item: the supplied PolyU screenshot does not show Urdu in the visible table area.

### CUHK

Source: user screenshot Image #4 plus user note.

General rule from screenshot: unless otherwise specified by individual programmes, pass results of an Other Language subject can be used in admission score calculation.

Score conversion:

| Language | 7 | 5.5 | 4 | 3 |
|---|---|---|---|---|
| French / German / Spanish | C2 | C1 | B2 | B1, A2 |
| Japanese | N1 | N2 | N3 | - |
| Korean | Grade 6 | Grade 5 | Grade 4 | Grade 3 |
| Urdu | A++, A+, A | B++, B+, B | C | D, E |

Programme-level exceptions called out by user: `JS4550`, `JS4601`, `JS4648`, `JS4719`. These should be verified directly before implementation because they may override general elective/scoring handling.

### HKUST

Source: user screenshot Image #5.

For 2025 HKDSE onwards, HKUST uses a detailed Category C conversion table.

| Language | 8.5 | 7 | 5.5 | 4 | 3 | 2.5 | 2 | 1 |
|---|---|---|---|---|---|---|---|---|
| French | C2 | C1 | B2 | B1 | A2 | - | - | - |
| German | C2 | C1 | B2 | B1 | A2 | - | - | - |
| Spanish | C2 | C1 | B2 | B1 | A2 | - | - | - |
| Japanese | N1 | - | N2 | - | N3 | - | - | - |
| Korean | Level 6 | - | Level 5 | Level 4 | Level 3 | - | - | - |
| Urdu | A++ | A+, A | B++ | B+ | B, C | - | D | E |

The same screenshot also includes a pre-2025 legacy row for Category C Other Language. Do not use that for 2026 scoring.

### HKU

Source: user screenshot Image #6.

HKU converted score table:

| Language | 8.5 | 7 | 5.5 | 4 | 3 | 2 | 1 |
|---|---|---|---|---|---|---|---|
| Japanese | N1 | N2 | - | N3 | - | - | - |
| Korean | Level 6 | Level 5 | Level 4 | Level 3 | - | - | - |
| French / German / Spanish | C2, C1 | B2 | B1 | A2 | - | - | - |
| Urdu | A++, A+, A | B++ | B+ | B | C | D | E |

### LingnanU

Source: user screenshot Image #7.

Converted score table:

| Language | 7 | 6 | 5 | 4 |
|---|---|---|---|---|
| Japanese | N1 | - | N2 | N3 |
| Korean | Lv6 | Lv5 | Lv4 | Lv3 |
| Spanish | C1, C2 | B2 | B1 | A2 |
| French | C1, C2 | B2 | B1 | A2 |
| German | C1, C2 | B2 | B1 | A2 |
| Urdu | A++, A+, A | B++ | B+ | B |

Open item: screenshot only shows converted scores 7-4; lower Urdu levels are not visible.

### EdUHK

Source: user screenshot Image #8.

For 2026 entry:

| Language | 7 | 6 | 5 | 4 | 3 | 2 | 1 |
|---|---|---|---|---|---|---|---|
| Japanese | N1 | - | N2 | N3 | - | - | - |
| Korean | Grade 6 | Grade 5 | Grade 4 | Grade 3 | - | - | - |
| French / German / Spanish | C2 | C1 | B2 | B1 | A2 | - | - |
| Urdu | A++ / A+ / A | B++ | B+ / B | C | D | E | - |

The screenshot also shows a `Before 2025` column. Do not use that for 2026 scoring.

### HKMU

Source: user screenshot Image #9.

Category C Other Language subjects:

| Language | 7 | 6 | 5 | 4 | 3 | 2 |
|---|---|---|---|---|---|---|
| Japanese | N1 | - | N2 | N3 | - | - |
| Korean | G6 | G5 | G4 | G3 | - | - |
| French | C2 | C1 | B2 | B1 | A2 | - |
| Spanish | C2 | C1 | B2 | B1 | A2 | - |
| German | C2 | C1 | B2 | B1 | A2 | - |

Open item: the supplied HKMU screenshot does not show Urdu.

## SSSDP Providers

### HKMU-Operated SSSDP Programmes (`JSSUxx`)

User note: same handling as HKMU.

### Shue Yan (`JSSYxx`)

Source: user screenshot Image #10.

For 2025-26 entry onward, the following levels can be counted as Level 2 and included in the score calculation of the best five subjects:

| Language | Reported level threshold |
|---|---|
| Japanese | N2 or above |
| Korean | Grade 4 or above |
| French / German / Spanish | Grade B or above |
| Urdu | Grade C or above |

This is phrased as a Level 2 counting rule, not a full conversion table.

### Chu Hai (`JSSC02`)

Source: user-supplied text.

Besides Category A elective subjects and Mathematics extended modules, Other Languages subjects can be used to meet the elective requirement at these thresholds:

| Language | Elective threshold |
|---|---|
| French / German / Spanish | A2 or above |
| Japanese | N3 or above |
| Korean | Grade 3 or above |
| Urdu (International) | Grade E or above |

### Saint Francis University (`JSSAxx`)

Source: user screenshot Image #11.

| Language | 7 | 6 | 5 | 4 | 3 |
|---|---|---|---|---|---|
| Japanese | N1 | - | N2 | N3 | - |
| Korean | G6 | G5 | G4 | G3 | - |
| French | C2 | C1 | B2 | B1 | A2 |
| German | C2 | C1 | B2 | B1 | A2 |
| Spanish | C2 | C1 | B2 | B1 | A2 |

Open item: the supplied Saint Francis screenshot does not show Urdu.

### THEi (`JSSVxx`)

Source: user screenshot Image #12.

| Language | 7 | 6 | 5 | 4 | 3 | 2 |
|---|---|---|---|---|---|---|
| French | C2 | C1 | B2 | B1 | A2 | - |
| German | C2 | C1 | B2 | B1 | A2 | - |
| Spanish | C2 | C1 | B2 | B1 | A2 | - |
| Japanese | N1 | - | N2 | N3 | - | - |
| Korean | TOPIK II Grade 6 | TOPIK II Grade 5 | TOPIK II Grade 4 | TOPIK II Grade 3 | - | - |
| Urdu | A++, A+, A | B++ | B+, B | C | D | E |

### Hang Seng (`JSSHxx`)

Source: user-supplied text.

Category C subjects: minimum proficiency level of respective language examinations accepted by HKEAA.

Open item: this is an eligibility threshold statement rather than a conversion table. Need verify whether Hang Seng uses a generic 7-6-5-4-3-2 scale, a Level 2 equivalent threshold only, or programme-specific handling.

### Tung Wah College (`JSSTxx`)

Source: user screenshot Image #13.

Score conversion for Category C Other Language Subjects from 2025 HKDSE onwards:

| Language | 7 | 6 | 5 | 4 | 3 | 2 |
|---|---|---|---|---|---|---|
| French | C2 | C1 | B2 | B1 | A2 | - |
| German | C2 | C1 | B2 | B1 | A2 | - |
| Spanish | C2 | C1 | B2 | B1 | A2 | - |
| Japanese | N1 | - | N2 | N3 | - | - |
| Korean | Level 6 | Level 5 | Level 4 | Level 3 | - | - |
| Urdu | A / A+ / A++ | B++ | B / B+ | C | D | E |

### UOW College Hong Kong (`JSSWxx`)

Source: user-supplied text.

Other Languages and Applied Learning subjects are only accepted as an elective for programmes in a relevant disciplinary area.

Accepted Other Languages thresholds:

| Language | Threshold |
|---|---|
| Japanese | N3 |
| Korean | Grade 3 |
| French | A2 |
| German | A2 |
| Spanish | A2 |
| Urdu | Grade E, from 2026 |

This is an elective eligibility rule, not a full conversion table.

## Suggested Implementation Plan

1. Verify the broad A-E mappings against original source PDFs/pages before publication if possible.
2. Add programme-level policies for any confirmed CUHK exceptions (`JS4550`, `JS4601`, `JS4648`, `JS4719`) if their rules differ from the general CUHK table.
3. Run a data audit to find programmes whose notes already mention Category C eligibility, especially SSSDP programmes.
4. Before implementing ApL, reuse the extended-grade TLV path rather than adding more 4-bit grade IDs.
