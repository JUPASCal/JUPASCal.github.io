import json
from pathlib import Path

from calculation_engine import calculate_programme_score


ROOT = Path(__file__).resolve().parents[2]
DATA_PATH = ROOT / "data" / "processed" / "JUPAS_2026_Unified_Data.json"

SUBJECTS = {
    "french": "French: Advanced Diploma of French Language Studies / Diploma of French Language Studies",
    "german": "German: Goethe-Certificate",
    "japanese": "Japanese: Japanese-Language Proficiency Test",
    "korean": "Korean: Test of Proficiency in Korean II",
    "spanish": "Spanish: Diploma of Spanish as a Foreign Language",
    "urdu": "Urdu: Urdu (International)",
}


def load_programmes():
    with DATA_PATH.open() as f:
        return {p["jupas_code"]: p for p in json.load(f)}


def cat_c_score(programmes, code, language, grade):
    programme = programmes[code]
    subject = SUBJECTS[language]
    result = calculate_programme_score({subject: grade}, programme)
    row = next(item for item in result["all_scores"] if item["subject"] == subject)
    return row["base_points"]


def main():
    programmes = load_programmes()

    checks = [
        ("JS1211", "japanese", "A", 7),
        ("JS1211", "japanese", "N3", 4),
        ("JS1211", "japanese", "D", 0),  # legacy broad value below listed CityU Japanese levels
        ("JS2020", "urdu", "E", 1),
        ("JS2020", "urdu", "B++", 5.5),
        ("JS3000", "japanese", "N1", 8.5),
        ("JS4006", "french", "A2", 3),
        ("JS5101", "french", "C1", 7),
        ("JS6004", "japanese", "N3", 4),
        ("JS7101", "japanese", "N2", 5),
        ("JS8001", "urdu", "E", 2),
        ("JS9009", "korean", "Grade 5", 6),
        ("JSSY01", "japanese", "N2", 2),
        ("JSSY01", "japanese", "N3", 0),
        ("JSSV01", "urdu", "E", 2),
    ]

    for code, language, grade, expected in checks:
        actual = cat_c_score(programmes, code, language, grade)
        assert actual == expected, f"{code} {language} {grade}: expected {expected}, got {actual}"

    print(f"Category C policy checks passed: {len(checks)}")


if __name__ == "__main__":
    main()
