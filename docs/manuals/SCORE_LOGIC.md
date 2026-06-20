# JUPAS Cal — Score Calculation Logic

This document defines how admission scores from different institutions are interpreted and processed in the JUPAS 2026 Calculator.

## 1. Actual Weighted Scores (High Confidence)
For the following institutions, the scores provided in the unified dataset are **actual weighted totals** published by the university. No estimation is required.

| Institution | Provided Scores | Confidence |
| :--- | :--- | :--- |
| **CityU** | Median, Lower Quartile (LQ) | 100% |
| **PolyU** | Median, LQ, Average | 100% |
| **CUHK** | Upper Quartile (UQ), Median, LQ | 100% |
| **HKUST** | Median, LQ, Highest Attainable | 100% |
| **HKU** | UQ, Median, LQ | 100% |
| **LingU** | Median, LQ | 100% |
| **EdUHK** | Median, LQ | 100% |
| **HKMU** | Median, LQ | 100% |

**Note on LingU:** Although individual subject grades are provided, they are independent statistical midpoints. They **must not** be summed to estimate a total score. Only the published weighted total is valid.

## 2. Estimated Weighted Scores (HKBU)
HKBU provides a **Weighted Mean** but only provides **Grade Breakdowns** for the Median and LQ positions.

### The Estimation Strategy
To provide a useful comparison for students, we calculate an **Estimated Weighted Score** for the Median and LQ positions by applying the programme's specific 2025 weighting formula to the published grade breakdowns.

### Risk-Adverse Bias
*   **Challenge:** Some programmes weight specific electives (e.g., Chemistry x 1.5). Since not all admitted students take the same electives, applying this weight to the breakdown may result in a slightly higher score than the true statistical median.
*   **Policy:** This "overestimation" is an intentional **risk-adverse error**. It is better to tell a student they need a slightly higher score to be safe than to give them false confidence.
*   **User Disclosure:** The UI must display a disclaimer for HKBU results: *"Median and LQ scores are estimated based on subject grade breakdowns and may be slightly conservative."*

## 3. SSSDP Scoring
(To be documented after further analysis of the multi-institutional data.)
