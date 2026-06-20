import json

UNIFIED_2026 = "../../data/processed/JUPAS_2026_Unified_Data.json"
LOGIC_2025 = "../../data/raw/jupas_2025_logic.json"

def normalize_subject(name):
    if not name: return name
    name = name.strip().lower()
    mapping = {
        "chinese language": "chi",
        "english language": "eng",
        "mathematics (compulsory part)": "math",
        "mathematics": "math",
        "citizenship and social development": "csd",
        "mathematics extended part (module 1)": "m1",
        "mathematics extended part (module 2)": "m2",
        "biology": "bio",
        "chemistry": "chem",
        "physics": "phys",
    }
    for k, v in mapping.items():
        if k in name: return v
    return name

def compare():
    with open(UNIFIED_2026, encoding='utf-8') as f:
        data_2026 = json.load(f)
    with open(LOGIC_2025, encoding='utf-8') as f:
        data_2025 = json.load(f)

    map_2025 = {item['code']: item for item in data_2025}
    diffs = []

    for entry in data_2026:
        code = entry['jupas_code']
        if code not in map_2025:
            diffs.append({"code": code, "type": "New Programme"})
            continue
        
        old = map_2025[code]
        
        # Formula Comparison
        old_f = str(old.get('formula_2025', '')).lower().replace(" ", "").replace("subjects", "")
        new_f_id = str(entry.get('formula_2026_id', '')).lower()
        
        is_formula_diff = False
        if "best5" in old_f and "best5" in new_f_id: pass
        elif "3c2x" in old_f and "3c2x" in new_f_id: pass
        elif old_f != new_f_id:
            is_formula_diff = True
            diffs.append({
                "code": code,
                "type": "Formula Change",
                "old": old.get('formula_2025'),
                "new": entry.get('formula_2026')
            })

        # Weighting Comparison
        old_w_list = old.get('weightings') or []
        old_w = {normalize_subject(w['subject']): float(w['weight']) for w in old_w_list if w and 'weight' in w and w.get('subject')}
        new_w = {normalize_subject(k): float(v) for k, v in entry.get('subject_weights_2026', {}).items()}
        
        if old_w and new_w:
            w_diffs = {}
            for s, v in new_w.items():
                if s in old_w and old_w[s] != v:
                    w_diffs[s] = {"old": old_w[s], "new": v}
                elif s not in old_w:
                    w_diffs[s] = {"old": None, "new": v}
            for s, v in old_w.items():
                if s not in new_w:
                    w_diffs[s] = {"old": v, "new": None}
            
            if w_diffs:
                diffs.append({
                    "code": code,
                    "type": "Weighting Change",
                    "diffs": w_diffs
                })

    print(f"Comparison Summary:")
    print(f"Total 2026 Programmes: {len(data_2026)}")
    print(f"New Programmes: {len([d for d in diffs if d['type'] == 'New Programme'])}")
    print(f"Formula Changes: {len([d for d in diffs if d['type'] == 'Formula Change'])}")
    print(f"Weighting Changes: {len([d for d in diffs if d['type'] == 'Weighting Change'])}")
    
    with open("comparison_report.json", "w", encoding='utf-8') as f:
        json.dump(diffs, f, ensure_ascii=False, indent=2)
    print("Report saved to comparison_report.json")

if __name__ == "__main__":
    compare()
