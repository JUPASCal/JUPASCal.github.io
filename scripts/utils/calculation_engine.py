import json
import re

CAT_C_SUBJECTS = {
    "French: Advanced Diploma of French Language Studies / Diploma of French Language Studies",
    "German: Goethe-Certificate",
    "Japanese: Japanese-Language Proficiency Test",
    "Korean: Test of Proficiency in Korean II",
    "Spanish: Diploma of Spanish as a Foreign Language",
    "Urdu: Urdu (International)",
}

POLICIES = {
    "CityUHK": {
        "japanese": {"A": 7, "B": 5.5, "C": 4},
        "korean": {"A": 7, "B": 5.5, "C": 4, "D": 3},
        "french": {"A": 7, "B": 5.5, "C": 4, "D": 3, "E": 3},
        "german": {"A": 7, "B": 5.5, "C": 4, "D": 3, "E": 3},
        "spanish": {"A": 7, "B": 5.5, "C": 4, "D": 3, "E": 3},
        "urdu": {"A": 7, "B": 5.5, "C": 4, "D": 3, "E": 3},
    },
    "HKBU": {
        "japanese": {"A": 7, "B": 5.5, "C": 4},
        "korean": {"A": 7, "B": 5.5, "C": 5.5, "D": 4},
        "french": {"A": 7, "B": 5.5, "C": 4},
        "german": {"A": 7, "B": 5.5, "C": 4},
        "spanish": {"A": 7, "B": 5.5, "C": 4},
        "urdu": {"A": 7, "B": 5.5, "C": 4, "D": 2.5, "E": 1},
    },
    "PolyU": {
        "japanese": {"A": 8.5, "B": 5.5, "C": 3},
        "korean": {"A": 8.5, "B": 7, "C": 4, "D": 3},
        "french": {"A": 8.5, "B": 7, "C": 5.5, "D": 4, "E": 3},
        "german": {"A": 8.5, "B": 7, "C": 5.5, "D": 4, "E": 3},
        "spanish": {"A": 8.5, "B": 7, "C": 5.5, "D": 4, "E": 3},
    },
    "CUHK": {
        "japanese": {"A": 7, "B": 5.5, "C": 4},
        "korean": {"A": 7, "B": 5.5, "C": 4, "D": 3},
        "french": {"A": 7, "B": 5.5, "C": 4, "D": 3, "E": 3},
        "german": {"A": 7, "B": 5.5, "C": 4, "D": 3, "E": 3},
        "spanish": {"A": 7, "B": 5.5, "C": 4, "D": 3, "E": 3},
        "urdu": {"A": 7, "B": 5.5, "C": 4, "D": 3, "E": 3},
    },
    "HKUST": {
        "japanese": {"A": 8.5, "B": 5.5, "C": 3},
        "korean": {"A": 8.5, "B": 5.5, "C": 4, "D": 3},
        "french": {"A": 8.5, "B": 7, "C": 5.5, "D": 4, "E": 3},
        "german": {"A": 8.5, "B": 7, "C": 5.5, "D": 4, "E": 3},
        "spanish": {"A": 8.5, "B": 7, "C": 5.5, "D": 4, "E": 3},
        "urdu": {"A": 8.5, "B": 7, "C": 5.5, "D": 4, "E": 3},
    },
    "HKU": {
        "japanese": {"A": 8.5, "B": 7, "C": 4},
        "korean": {"A": 8.5, "B": 7, "C": 5.5, "D": 4},
        "french": {"A": 8.5, "B": 7, "C": 5.5, "D": 4},
        "german": {"A": 8.5, "B": 7, "C": 5.5, "D": 4},
        "spanish": {"A": 8.5, "B": 7, "C": 5.5, "D": 4},
        "urdu": {"A": 8.5, "B": 7, "C": 5.5, "D": 4, "E": 3},
    },
    "LingnanU": {
        "japanese": {"A": 7, "B": 5, "C": 4},
        "korean": {"A": 7, "B": 6, "C": 5, "D": 4},
        "french": {"A": 7, "B": 6, "C": 5, "D": 4},
        "german": {"A": 7, "B": 6, "C": 5, "D": 4},
        "spanish": {"A": 7, "B": 6, "C": 5, "D": 4},
        "urdu": {"A": 7, "B": 6, "C": 5, "D": 4},
    },
    "EdUHK": {
        "japanese": {"A": 7, "B": 5, "C": 4},
        "korean": {"A": 7, "B": 6, "C": 5, "D": 4},
        "french": {"A": 7, "B": 6, "C": 5, "D": 4, "E": 3},
        "german": {"A": 7, "B": 6, "C": 5, "D": 4, "E": 3},
        "spanish": {"A": 7, "B": 6, "C": 5, "D": 4, "E": 3},
        "urdu": {"A": 7, "B": 6, "C": 5, "D": 4, "E": 3},
    },
}

HKMU_STYLE = {
    "japanese": {"A": 7, "B": 5, "C": 4},
    "korean": {"A": 7, "B": 6, "C": 5, "D": 4},
    "french": {"A": 7, "B": 6, "C": 5, "D": 4, "E": 3},
    "german": {"A": 7, "B": 6, "C": 5, "D": 4, "E": 3},
    "spanish": {"A": 7, "B": 6, "C": 5, "D": 4, "E": 3},
    "urdu": {"A": 7, "B": 6, "C": 5, "D": 4, "E": 3},
}

SHUE_YAN_LEVEL_2_POLICY = {
    "japanese": {"A": 2, "B": 2},
    "korean": {"A": 2, "B": 2, "C": 2},
    "french": {"A": 2, "B": 2, "C": 2},
    "german": {"A": 2, "B": 2, "C": 2},
    "spanish": {"A": 2, "B": 2, "C": 2},
    "urdu": {"A": 2, "B": 2, "C": 2, "D": 2},
}

SSSDP_SCORE_POLICIES = {
    "JSSU": HKMU_STYLE,
    "JSSA": HKMU_STYLE,
    "JSSV": HKMU_STYLE,
    "JSST": HKMU_STYLE,
}

EXACT_POLICIES = {
    "CityUHK": {
        "japanese": {"N1": 7, "N2": 5.5, "N3": 4},
        "korean": {"GRADE 6": 7, "GRADE 5": 5.5, "GRADE 4": 4, "GRADE 3": 3},
        "french": {"C2": 7, "C1": 5.5, "B2": 4, "B1": 3, "A2": 3},
        "german": {"C2": 7, "C1": 5.5, "B2": 4, "B1": 3, "A2": 3},
        "spanish": {"C2": 7, "C1": 5.5, "B2": 4, "B1": 3, "A2": 3},
        "urdu": {"A++": 7, "A+": 7, "A": 7, "B++": 5.5, "B+": 5.5, "B": 4, "C": 4, "D": 3, "E": 3},
    },
    "HKBU": {
        "japanese": {"N1": 7, "N2": 5.5, "N3": 4},
        "korean": {"GRADE 6": 7, "GRADE 5": 5.5, "GRADE 4": 5.5, "GRADE 3": 4},
        "french": {"C2": 7, "C1": 7, "B2": 5.5, "B1": 5.5, "A2": 4},
        "german": {"C2": 7, "C1": 7, "B2": 5.5, "B1": 5.5, "A2": 4},
        "spanish": {"C2": 7, "C1": 7, "B2": 5.5, "B1": 5.5, "A2": 4},
        "urdu": {"A++": 7, "A+": 7, "A": 7, "B++": 5.5, "B+": 4, "B": 4, "C": 2.5, "D": 2.5, "E": 1},
    },
    "PolyU": {
        "japanese": {"N1": 8.5, "N2": 5.5, "N3": 3},
        "korean": {"GRADE 6": 8.5, "GRADE 5": 7, "GRADE 4": 4, "GRADE 3": 3},
        "french": {"C2": 8.5, "C1": 7, "B2": 5.5, "B1": 4, "A2": 3},
        "german": {"C2": 8.5, "C1": 7, "B2": 5.5, "B1": 4, "A2": 3},
        "spanish": {"C2": 8.5, "C1": 7, "B2": 5.5, "B1": 4, "A2": 3},
    },
    "CUHK": {
        "japanese": {"N1": 7, "N2": 5.5, "N3": 4},
        "korean": {"GRADE 6": 7, "GRADE 5": 5.5, "GRADE 4": 4, "GRADE 3": 3},
        "french": {"C2": 7, "C1": 5.5, "B2": 4, "B1": 3, "A2": 3},
        "german": {"C2": 7, "C1": 5.5, "B2": 4, "B1": 3, "A2": 3},
        "spanish": {"C2": 7, "C1": 5.5, "B2": 4, "B1": 3, "A2": 3},
        "urdu": {"A++": 7, "A+": 7, "A": 7, "B++": 5.5, "B+": 5.5, "B": 5.5, "C": 4, "D": 3, "E": 3},
    },
    "HKUST": {
        "japanese": {"N1": 8.5, "N2": 5.5, "N3": 3},
        "korean": {"GRADE 6": 8.5, "GRADE 5": 5.5, "GRADE 4": 4, "GRADE 3": 3},
        "french": {"C2": 8.5, "C1": 7, "B2": 5.5, "B1": 4, "A2": 3},
        "german": {"C2": 8.5, "C1": 7, "B2": 5.5, "B1": 4, "A2": 3},
        "spanish": {"C2": 8.5, "C1": 7, "B2": 5.5, "B1": 4, "A2": 3},
        "urdu": {"A++": 8.5, "A+": 7, "A": 7, "B++": 5.5, "B+": 4, "B": 3, "C": 3, "D": 2, "E": 1},
    },
    "HKU": {
        "japanese": {"N1": 8.5, "N2": 7, "N3": 4},
        "korean": {"GRADE 6": 8.5, "GRADE 5": 7, "GRADE 4": 5.5, "GRADE 3": 4},
        "french": {"C2": 8.5, "C1": 8.5, "B2": 7, "B1": 5.5, "A2": 4},
        "german": {"C2": 8.5, "C1": 8.5, "B2": 7, "B1": 5.5, "A2": 4},
        "spanish": {"C2": 8.5, "C1": 8.5, "B2": 7, "B1": 5.5, "A2": 4},
        "urdu": {"A++": 8.5, "A+": 8.5, "A": 8.5, "B++": 7, "B+": 5.5, "B": 4, "C": 3, "D": 2, "E": 1},
    },
    "LingnanU": {
        "japanese": {"N1": 7, "N2": 5, "N3": 4},
        "korean": {"GRADE 6": 7, "GRADE 5": 6, "GRADE 4": 5, "GRADE 3": 4},
        "french": {"C2": 7, "C1": 7, "B2": 6, "B1": 5, "A2": 4},
        "german": {"C2": 7, "C1": 7, "B2": 6, "B1": 5, "A2": 4},
        "spanish": {"C2": 7, "C1": 7, "B2": 6, "B1": 5, "A2": 4},
        "urdu": {"A++": 7, "A+": 7, "A": 7, "B++": 6, "B+": 5, "B": 4},
    },
    "EdUHK": {
        "japanese": {"N1": 7, "N2": 5, "N3": 4},
        "korean": {"GRADE 6": 7, "GRADE 5": 6, "GRADE 4": 5, "GRADE 3": 4},
        "french": {"C2": 7, "C1": 6, "B2": 5, "B1": 4, "A2": 3},
        "german": {"C2": 7, "C1": 6, "B2": 5, "B1": 4, "A2": 3},
        "spanish": {"C2": 7, "C1": 6, "B2": 5, "B1": 4, "A2": 3},
        "urdu": {"A++": 7, "A+": 7, "A": 7, "B++": 6, "B+": 5, "B": 5, "C": 4, "D": 3, "E": 2},
    },
    "HKMU": {
        "japanese": {"N1": 7, "N2": 5, "N3": 4},
        "korean": {"GRADE 6": 7, "GRADE 5": 6, "GRADE 4": 5, "GRADE 3": 4},
        "french": {"C2": 7, "C1": 6, "B2": 5, "B1": 4, "A2": 3},
        "german": {"C2": 7, "C1": 6, "B2": 5, "B1": 4, "A2": 3},
        "spanish": {"C2": 7, "C1": 6, "B2": 5, "B1": 4, "A2": 3},
        "urdu": {"A++": 7, "A+": 7, "A": 7, "B++": 6, "B+": 5, "B": 5, "C": 4, "D": 3, "E": 2},
    },
}

def is_category_c_subject(subject):
    return subject in CAT_C_SUBJECTS

def category_c_language(subject):
    if subject.startswith("French:"): return "french"
    if subject.startswith("German:"): return "german"
    if subject.startswith("Spanish:"): return "spanish"
    if subject.startswith("Japanese:"): return "japanese"
    if subject.startswith("Korean:"): return "korean"
    if subject.startswith("Urdu:"): return "urdu"
    return None

def score_policy_for(programme):
    institution = programme.get("institution")
    code = programme.get("jupas_code", "")
    if institution == "HKMU":
        return HKMU_STYLE
    if institution != "SSSDP":
        return POLICIES.get(institution)
    if code.startswith("JSSY"):
        return SHUE_YAN_LEVEL_2_POLICY
    for prefix, policy in SSSDP_SCORE_POLICIES.items():
        if code.startswith(prefix):
            return policy
    return None

def exact_score_policy_for(programme):
    institution = programme.get("institution")
    code = programme.get("jupas_code", "")
    if institution != "SSSDP":
        return EXACT_POLICIES.get(institution)
    if code.startswith("JSSY"):
        return {
            "japanese": {"N1": 2, "N2": 2},
            "korean": {"GRADE 6": 2, "GRADE 5": 2, "GRADE 4": 2},
            "french": {"C2": 2, "C1": 2, "B2": 2},
            "german": {"C2": 2, "C1": 2, "B2": 2},
            "spanish": {"C2": 2, "C1": 2, "B2": 2},
            "urdu": {"A++": 2, "A+": 2, "A": 2, "B++": 2, "B+": 2, "B": 2, "C": 2},
        }
    for prefix in ("JSSU", "JSSA", "JSSV", "JSST"):
        if code.startswith(prefix):
            return EXACT_POLICIES["HKMU"]
    return None

def category_c_base_points(programme, subject, grade, fallback_table):
    if not is_category_c_subject(subject):
        return None
    language = category_c_language(subject)
    normalized = str(grade or "").strip().upper()
    if not language or not normalized or normalized == "U":
        return 0
    exact_policy = exact_score_policy_for(programme)
    exact_language_policy = exact_policy.get(language) if exact_policy else None
    if exact_language_policy is not None and normalized in exact_language_policy:
        return exact_language_policy.get(normalized, 0)
    policy = score_policy_for(programme)
    language_policy = policy.get(language) if policy else None
    if language_policy is not None:
        return language_policy.get(normalized, 0)
    return fallback_table.get(normalized, 0)

def calculate_programme_score(student_grades, programme, year="2025"):
    """
    Calculates the score for a specific programme and returns a detailed breakdown.
    year: "2025" or "2026" (determines which weights/formula to use)
    """
    weights = programme.get(f"subject_weights_{year}", {})
    best_of_pools = programme.get(f"best_of_weights_{year}", [])
    formula_id = programme.get(f"formula_{year}_id")
    conv_table = programme.get("score_conversion_table", {}).get("category_a", {})
    cat_c_table = programme.get("score_conversion_table", {}).get("category_c", {})
    constraints = programme.get("calculation_constraints", [])
    
    subject_scores = []
    
    # 1. Process Flat Weights
    for subj, grade in student_grades.items():
        if is_category_c_subject(subj):
            base_points = category_c_base_points(programme, subj, grade, cat_c_table) or 0
        else:
            base_points = conv_table.get(str(grade).strip(), 0)
        weight = weights.get(subj, 1.0)
        
        subject_scores.append({
            "subject": subj,
            "grade": grade,
            "base_points": base_points,
            "weight": weight,
            "weighted_points": base_points * weight,
            "used": False,
            "is_best_of": False,
            "is_bonus": False,
            "bonus_value": ""
        })

    # 2. Handle Best-Of Pools (e.g. M1 or M2 x 2.0)
    for pool in best_of_pools:
        pool_cands = [s for s in subject_scores if s["subject"] in pool["subjects"]]
        pool_cands.sort(key=lambda x: x["weighted_points"], reverse=True)
        for i in range(min(pool["count"], len(pool_cands))):
            cand = pool_cands[i]
            if pool["weight"] > cand["weight"]:
                cand["weight"] = pool["weight"]
                cand["weighted_points"] = cand["base_points"] * cand["weight"]
                cand["is_best_of"] = True

    # 3. Handle Max Weighted Subjects Constraint (e.g. CUHK Science)
    for c in constraints:
        if c["type"] == "max_weighted_subjects":
            subject_scores.sort(key=lambda x: x["weight"], reverse=True)
            weighted_count = 0
            for s in subject_scores:
                if s["weight"] > 1.0:
                    if weighted_count < c["limit"]:
                        weighted_count += 1
                    else:
                        s["weight"] = 1.0
                        s["weighted_points"] = s["base_points"]
                        s["is_best_of"] = False

    # 4. Handle Compulsory Subjects
    compulsory = []
    compulsory_pools = []
    for c in constraints:
        if c["type"] == "compulsory_subjects":
            compulsory = c["subjects"]
        if c["type"] == "compulsory_subject_pool":
            compulsory_pools.append(c)

    # 5. Selection Logic (Best N)
    selected_subjects = []
    target_count = 5
    has_bonus = any(c["type"] in ["bonus_6th", "additional_bonus_6th"] for c in constraints)
    has_bonus7 = any(c["type"] == "bonus_7th" for c in constraints)

    if formula_id == "best4":
        target_count = 4
    elif formula_id == "best6" or has_bonus7:
        target_count = 6
    elif formula_id == "best5" or has_bonus:
        target_count = 5
    else:
        f_text = str(programme.get(f"formula_{year}", ""))
        if "Best 6" in f_text or "3 Core + 3 Elective" in f_text or "4 Core + 2 Elective" in f_text:
            target_count = 6
        elif "Best 5" in f_text or "3 Core + 2 Elective" in f_text:
            target_count = 5
        elif "6" in f_text and "5" not in f_text:
            target_count = 6

    # A. Compulsory individual subjects first
    for s in subject_scores:
        if s["subject"] in compulsory:
            s["used"] = True
            selected_subjects.append(s)
            
    # B. Compulsory pools (Pick best N from pool)
    for pool in compulsory_pools:
        pool_cands = sorted([s for s in subject_scores if s["subject"] in pool["subjects"] and not s["used"]], key=lambda x: x["weighted_points"], reverse=True)
        for i in range(min(pool["count"], len(pool_cands))):
            cand = pool_cands[i]
            cand["used"] = True
            selected_subjects.append(cand)
    
    # C. Fill remaining with best weighted scores
    remaining = [s for s in subject_scores if not s["used"]]
    remaining.sort(key=lambda x: x["weighted_points"], reverse=True)

    for s in remaining:
        if len(selected_subjects) >= target_count: break
        
        # Mutual Exclusivity Check
        is_conflict = False
        for c in constraints:
            if c["type"] == "maths_m1m2_as_one" and "Mathematics" in s["subject"]:
                if any("Mathematics" in x["subject"] for x in selected_subjects):
                    is_conflict = True
        
        if not is_conflict:
            s["used"] = True
            selected_subjects.append(s)

    # 6. Post-Selection Bonus
    for c in constraints:
        # Generic Multiplier-based (HKU/PolyU)
        if c["type"] == "bonus_6th" and len(selected_subjects) == 5:
            bonus_cand = sorted([s for s in subject_scores if not s["used"]], key=lambda x: x["base_points"], reverse=True)
            if bonus_cand:
                bc = bonus_cand[0]
                # If PolyU, check for Level 3+
                if c.get("polyu_style") and bc["base_points"] < 3:
                    continue
                
                # Update internal points for breakdown
                bc["weight"] = c["multiplier"]
                bc["weighted_points"] = bc["weighted_points"] * c["multiplier"]
                
                bc.update({"used": True, "is_bonus": True, "bonus_value": f"+{c['multiplier']}x"})
                selected_subjects.append(bc)
        
        # HKUST Style (% of Highest Attainable)
        if c["type"] == "hkust_weighted_best" and len(selected_subjects) == c["subject_count"]:
            bonus_cand = sorted([s for s in subject_scores if not s["used"]], key=lambda x: x["base_points"], reverse=True)
            if bonus_cand:
                bc = bonus_cand[0]
                bonus_pct = c["bonus_scale"].get(str(bc["grade"]), 0)
                if bonus_pct > 0:
                    current_total = sum(s["weighted_points"] for s in selected_subjects)
                    ha_score = programme.get("max_achievable_score") or current_total
                    bonus_points = ha_score * bonus_pct
                    
                    # Update internal points for breakdown
                    bc["weighted_points"] = bonus_points
                    
                    bc.update({"used": True, "is_bonus": True, "bonus_value": f"+{bonus_pct*100}%"})
                    selected_subjects.append(bc)

    final_score = sum(s["weighted_points"] for s in selected_subjects)
    
    return {
        "final_score": final_score,
        "selected": selected_subjects,
        "all_scores": subject_scores
    }

if __name__ == "__main__":
    with open("data/processed/JUPAS_2026_Unified_Data.json") as f:
        data = json.load(f)
    
    # Test JS6468 (HKU Nursing)
    js6468 = [x for x in data if x["jupas_code"] == "JS6468"][0]
    grades = {"Chinese Language": "5*", "English Language": "5", "Mathematics (Compulsory Part)": "4", "Geography": "5", "History": "5", "Biology": "4", "Citizenship and Social Development": "A"}
    
    result = calculate_programme_score(grades, js6468)
    print("JS6468 Score: " + str(result["final_score"]))
    for s in result["selected"]:
        print("  " + s["subject"] + ": " + str(s["grade"]) + " (" + str(s["base_points"]) + ") x " + str(s.get("weight", 1.0)) + " bonus=" + s.get("bonus_value", "") + " = " + str(s["weighted_points"]))
