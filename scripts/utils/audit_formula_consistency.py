import json
import re
from pathlib import Path

DATA_FILE = Path("data/processed/JUPAS_2026_Unified_Data.json")

SUBJECT_ALIASES = {
    "chin": "Chinese Language",
    "chinese": "Chinese Language",
    "eng": "English Language",
    "english": "English Language",
    "math": "Mathematics (Compulsory Part)",
    "maths": "Mathematics (Compulsory Part)",
}


def explicit_formula_weights(formula):
    if not formula:
        return []

    found = []
    for match in re.finditer(r"([\d.]+)\s*x\s*(Chin(?:ese)?|Eng(?:lish)?|Maths?)\b", formula, re.IGNORECASE):
        found.append((SUBJECT_ALIASES[match.group(2).lower()], float(match.group(1)), match.group(0)))

    for match in re.finditer(r"([\d.]+)\s*x\s*M1\s*/\s*M2", formula, re.IGNORECASE):
        weight = float(match.group(1))
        found.append(("Mathematics Extended Part (Module 1)", weight, match.group(0)))
        found.append(("Mathematics Extended Part (Module 2)", weight, match.group(0)))

    return found


def compulsory_subjects(programme):
    subjects = set()
    for constraint in programme.get("calculation_constraints") or []:
        if constraint.get("type") == "compulsory_subjects":
            subjects.update(constraint.get("subjects") or [])
    return subjects


def expected_compulsory_from_formula(formula):
    if not formula:
        return set()

    expected = set()
    if re.search(r"\bEng(?:lish)?\b", formula, re.IGNORECASE):
        expected.add("English Language")
    if re.search(r"\bMaths?\b", formula, re.IGNORECASE):
        expected.add("Mathematics (Compulsory Part)")
    if re.search(r"\bM1\s*/\s*M2\b", formula, re.IGNORECASE):
        expected.add("Mathematics Extended Part (Module 1 or 2)")
    if re.search(r"\bChin(?:ese)?\b", formula, re.IGNORECASE):
        expected.add("Chinese Language")
    return expected


def audit():
    data = json.loads(DATA_FILE.read_text(encoding="utf-8"))
    issues = []
    warnings = []

    for programme in data:
        code = programme["jupas_code"]
        formula = programme.get("formula_2025") or ""
        weights = programme.get("subject_weights_2025") or {}

        for subject, expected_weight, raw in explicit_formula_weights(formula):
            actual = float(weights.get(subject, 1))
            if actual != expected_weight:
                issues.append(
                    f"{code}: formula has {raw}, but structured weight for {subject} is {weights.get(subject)}"
                )

        missing_compulsory = expected_compulsory_from_formula(formula) - compulsory_subjects(programme)
        if missing_compulsory:
            issues.append(
                f"{code}: formula implies compulsory {sorted(missing_compulsory)}, but constraints do not include them"
            )

        if re.search(r"with\s+WEIGHTING\s+\d+", formula, re.IGNORECASE):
            warnings.append(
                f"{code}: formula contains generic weighting phrase that may need manual interpretation: {formula}"
            )

    print(f"Programmes audited: {len(data)}")
    print(f"Blocking issues: {len(issues)}")
    for issue in issues:
        print(f"ISSUE: {issue}")

    print(f"Manual-review warnings: {len(warnings)}")
    for warning in warnings:
        print(f"WARNING: {warning}")

    return 1 if issues else 0


if __name__ == "__main__":
    raise SystemExit(audit())
