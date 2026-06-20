import json
import os

MASTER_DATA = "data/processed/JUPAS_2026_Unified_Data.json"

def calculate_score(grades, weights, conv_table):
    """
    Refined calculation for HKBU Median/LQ estimation.
    Applies multipliers accurately to core subjects and electives found in the breakdown.
    """
    if not grades: return None
    
    subject_scores = []
    
    # Identify specific weighted electives for this programme
    core_names = ["Chinese Language", "English Language", "Mathematics (Compulsory Part)", 
                  "Mathematics Extended Part (Module 1)", "Mathematics Extended Part (Module 2)",
                  "Citizenship and Social Development"]
    weighted_electives = {k: v for k, v in weights.items() if k not in core_names}
    
    # Sort weighted electives by multiplier descending to apply to the best breakdown slots
    sorted_elective_multipliers = sorted(weighted_electives.values(), reverse=True)
    
    # Track which core weights were used
    for subj, grade in grades.items():
        base_val = conv_table.get(str(grade).strip(), 0)
        weight = 1.0
        
        if subj == "CHIN": weight = weights.get("Chinese Language", 1.0)
        elif subj == "ENGL": weight = weights.get("English Language", 1.0)
        elif subj == "MATH": weight = weights.get("Mathematics (Compulsory Part)", 1.0)
        elif subj == "M1/M2": 
            w1 = weights.get("Mathematics Extended Part (Module 1)", 1.0)
            w2 = weights.get("Mathematics Extended Part (Module 2)", 1.0)
            weight = max(w1, w2)
        elif "Elective" in subj:
            # Risk-adverse refined: apply the highest available elective multipliers 
            # to the elective slots in the breakdown order.
            if sorted_elective_multipliers:
                weight = sorted_elective_multipliers.pop(0)
            else:
                weight = 1.0
            
        subject_scores.append(base_val * weight)
    
    # HKBU follows Best 5
    subject_scores.sort(reverse=True)
    return sum(subject_scores[:5])

def update_hkbu():
    if not os.path.exists(MASTER_DATA):
        print(f"Error: {MASTER_DATA} not found.")
        return

    with open(MASTER_DATA, encoding='utf-8') as f:
        data = json.load(f)
    
    updated_count = 0
    for entry in data:
        if entry["institution"] == "HKBU":
            weights = entry.get("subject_weights_2025", {})
            grades = entry.get("score_grades_2025", {})
            conv_table = entry.get("score_conversion_table", {}).get("category_a", {})
            
            est_median = calculate_score(grades.get("median"), weights, conv_table)
            est_lq = calculate_score(grades.get("lq"), weights, conv_table)
            
            if est_median:
                entry["scores_2025"]["median"] = est_median
                entry["scores_2025"]["score_type"] = "estimated"
            
            if est_lq:
                entry["scores_2025"]["lq"] = est_lq
                entry["scores_2025"]["score_type"] = "estimated"
            
            if not est_median and not est_lq:
                entry["scores_2025"]["score_type"] = "actual"
            
            updated_count += 1

    with open(MASTER_DATA, 'w', encoding='utf-8') as f:
        json.dump(data, f, ensure_ascii=False, indent=2)
    
    print(f"Updated {updated_count} HKBU programmes with REFINED estimated scores.")

if __name__ == "__main__":
    update_hkbu()
