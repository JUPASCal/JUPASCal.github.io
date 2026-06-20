import json
import pandas as pd

MASTER_JSON = "data/processed/JUPAS_2026_Unified_Data.json"
OUTPUT_CSV = "data/raw/JUPAS_2026_Flat_Datasheet.csv"

def flatten():
    with open(MASTER_JSON, encoding='utf-8') as f:
        data = json.load(f)
    
    flattened = []
    for entry in data:
        row = {
            "JUPAS Code": entry["jupas_code"],
            "Institution": entry["institution"],
            "Name (EN)": entry["name_en"],
            "Name (ZH)": entry["name_zh"],
            "Formula 2025": entry["formula_2025"],
            "Weights 2025 (Raw)": entry["subject_weights_2025_raw"],
            "Min Chi": entry["min_requirements_2026"].get("chi"),
            "Min Eng": entry["min_requirements_2026"].get("eng"),
            "Min Math": entry["min_requirements_2026"].get("math"),
            "Min CSD": entry["min_requirements_2026"].get("csd"),
            "2025 Median": entry["scores_2025"].get("median"),
            "2025 LQ": entry["scores_2025"].get("lq"),
            "2025 UQ": entry["scores_2025"].get("uq")
        }
        flattened.append(row)
    
    df = pd.DataFrame(flattened)
    df.to_csv(OUTPUT_CSV, index=False, encoding='utf-8-sig')
    print(f"Excel-friendly flatfile generated at {OUTPUT_CSV}")

if __name__ == "__main__":
    flatten()
