# JUPAS Cal — Excel Logic Documentation (v1.0.3)

This document provides a technical breakdown of the legacy Excel-based JUPAS score calculator. It serves as a reference for transitioning the logic into a structured web application.

## Core Architecture

The calculator operates in three functional layers: **User Input**, **Calculation Engine**, and **Institutional Database**.

---

## 1. User Input Layer (`主頁`)

Captures the student's HKDSE results via dropdown menus or manual entry (Digital Mode).

### Input Mapping
| Subject | Excel Range | Notes |
|---------|-------------|-------|
| Chinese Language | `C8` | Grade level (e.g., 5**, 5*, 5, 4, 3...) |
| English Language | `C9` | |
| Mathematics (Core) | `C10` | |
| Citizenship & Social Dev (CSD) | `C11` | Binary: "達標" (Attained) or "不達標" |
| Mathematics (M1/M2) | `C12` | Optional |
| Elective 1 | `C15` | User selects subject + grade |
| Elective 2 | `C16` | |
| Elective 3 | `C17` | |

---

## 2. Calculation Engine (`計分版`)

This sheet is the "brain" that converts raw grades into numeric scores and applies universal formulas.

### Grade-to-Score Conversion (Row 13)
The standard conversion used for most institutions (except where noted, e.g., CUHK/EdUHK):
- **5\*\*** = 7 (+ tie-breaker decimal)
- **5\*** = 6
- **5** = 5
- **4** = 4
- **3** = 3
- **2** = 2
- **1** = 1
- **U** = 0
- **CSD** = 1 (if "達標")

*Note: A small unique decimal (e.g., `+0.0000000001`) is added to each subject score to prevent ties when using the `LARGE` function for Best-N calculations.*

### Universal Formulae
| Formula | Excel Logic | Description |
|---------|-------------|-------------|
| **Best 4** | `LARGE((Cores, Electives), 1:4)` | Sum of top 4 subjects |
| **Best 5** | `LARGE((Cores, Electives), 1:5)` | Sum of top 5 subjects |
| **3C+1X** | `SUM(Cores) + LARGE(Electives, 1)` | 3 Cores + top 1 elective |
| **3C+2X** | `SUM(Cores) + LARGE(Electives, 1:2)` | 3 Cores + top 2 electives |
| **Best 5 (M)** | `LARGE((Cores, M1/M2, Electives), 1:5)` | Includes M1/M2 in the pool |

---

## 3. Institutional Database (`Reference Score Calculation`)

A master flat-file database mapping JUPAS codes to their specific scoring rules and historical data.

### 2025 Logic Column Mapping (Row 12+)
These columns were extracted into `jupas_2025_logic.json` for the 2026 update:
- **Col 27-28:** 2025 Entrance Requirements (e.g., "Lv.3 in Physics")
- **Col 29:** 2025 Calculation Method (e.g., `3C2X`, `Best 5`)
- **Col 30-31:** 2025 Updates/Remarks
- **Col 32-33:** 2025 Calculation Details (e.g., "Must include English")
- **Col 34-36:** 2025 Weighting Factors (e.g., "x2: Mathematics")
- **Col 37-39:** Other Consideration Factors (Band A rank, OEA, Interview)
- **Col 40-45:** Extra Data/Links
- **Col 46-47:** Estimation Methodology
- **Col 48:** Retake Penalty Logic

### Reverse Engineering Logic
For institutions that do not publish weighted scores, this sheet calculates the weighted historical totals by applying the Y-1 weighting factors (Cols P-R) to the raw historical grades.

---

## 4. Requirement Engine (`入學要求`)

A validation layer that performs conditional checks to ensure a student meets the minimum entry thresholds for a specific programme.

### Validation Logic
For each programme (Row 120+), the sheet compares the user's grades against the stored thresholds:
- **Core Check:** `IF(Required_Level > User_Level, 0, 1)`
- **Elective Check:** Compares the `LARGE` of the user's electives against the programme's elective requirements.
- **Flagging:** A programme is "Passed" only if the sum of these binary checks matches the total number of required subjects.

---

## 5. Structured Data Migration
The 2025 logic has been extracted into `jupas_2025_logic.json`. This JSON structure is the template for the future web application "brain":
- **Admission Rules:** Requirements, formulas, and weightings.
- **Metadata:** Programme names, codes, and faculty info.
- **Adjustments:** Retake penalties and bonus point logic.
