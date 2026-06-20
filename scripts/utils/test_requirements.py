import json
import os

MASTER_DATA = "../../data/processed/JUPAS_2026_Unified_Data.json"

def evaluate_elective(student_grades, req_obj, used_subjects):
    """
    Checks if a student has an elective that meets the requirements.
    req_obj: {"count": 1, "subjects": ["Bio", "Chem"], "grade": "3", "note": "..."}
    """
    if not req_obj: return True, None
    
    target_grade = req_obj["grade"]
    allowed_subjects = req_obj["subjects"]
    
    # Mapping for Grade comparison (very simple for now)
    grade_map = {"5**": 7, "5*": 6, "5": 5, "4": 4, "3": 3, "2": 2, "1": 1, "A": 2, "attained": 2}
    
    possible_matches = []
    for subj, grade in student_grades.items():
        if subj in used_subjects: continue
        
        # Check if subject is in pool or pool is "Any" or "*"
        is_match = False
        if "Any" in allowed_subjects or "*" in allowed_subjects or subj in allowed_subjects:
            is_match = True
        
        # Also treat "Category A subjects only" as a wildcard in tests for now
        if any("Category A" in s for s in allowed_subjects):
            is_match = True

        if is_match:
            # Check grade threshold
            s_val = grade_map.get(str(grade).lower(), 0)
            r_val = grade_map.get(str(target_grade).lower(), 0)
            
            if s_val >= r_val:
                possible_matches.append(subj)
    
    if len(possible_matches) >= req_obj["count"]:
        # Pick the best one (simplistic)
        matched = possible_matches[0]
        return True, matched
    
    return False, None

def check_eligibility(student_grades, reqs):
    """
    Returns (is_eligible, reason)
    """
    # Core Check
    grade_map = {"5**": 7, "5*": 6, "5": 5, "4": 4, "3": 3, "2": 2, "1": 1, "A": 2, "attained": 2}
    core_map = {
        "chi": "Chinese Language",
        "eng": "English Language",
        "math": "Mathematics (Compulsory Part)",
        "csd": "Citizenship and Social Development"
    }
    
    for core, canonical in core_map.items():
        s_grade = student_grades.get(canonical) or student_grades.get(core.upper())
        r_grade = reqs.get(core)
        
        if not s_grade: return False, f"Missing core: {core} (Expected {canonical})"
        
        s_val = grade_map.get(str(s_grade).lower(), 0)
        r_val = grade_map.get(str(r_grade).lower(), 0)
        
        if s_val < r_val:
            return False, f"Failed core: {core} (Got {s_grade}, Need {r_grade})"

    # Electives Check
    used = ["Chinese Language", "English Language", "Mathematics (Compulsory Part)"]
    # Test E1
    pass_e1, matched_e1 = evaluate_elective(student_grades, reqs.get("elect1"), used)
    if not pass_e1:
        return False, f"Failed Elective 1 pool: {reqs['elect1']['subjects']} at level {reqs['elect1']['grade']}"
    if matched_e1: used.append(matched_e1)
    
    # Test E2
    pass_e2, matched_e2 = evaluate_elective(student_grades, reqs.get("elect2"), used)
    if not pass_e2:
        return False, f"Failed Elective 2 pool: {reqs['elect2']['subjects']} at level {reqs['elect2']['grade']}"
    
    return True, "Eligible"

def run_tests():
    with open(MASTER_DATA, encoding='utf-8') as f:
        data = json.load(f)
    
    # Test Case 1: JS4412 (CUHK Computer Science) - Needs Pool [M1/M2, Bio, Chem, ICT, Phys]
    js4412 = [x for x in data if x["jupas_code"] == "JS4412"][0]
    
    print("--- Testing JS4412 (Specific Pool) ---")
    # Student A: Has Physics (Level 4) and History (Level 3) -> Should PASS
    student_a = {"CHI": "3", "ENG": "3", "MATH": "4", "CSD": "A", "Physics": "4", "History": "3"}
    print(f"Student A: {check_eligibility(student_a, js4412['min_requirements_2026'])}")
    
    # Student B: Has History (Level 5) and Geography (Level 5) but NO pool subjects -> Should FAIL
    student_b = {"CHI": "3", "ENG": "3", "MATH": "4", "CSD": "A", "History": "5", "Geography": "5"}
    print(f"Student B: {check_eligibility(student_b, js4412['min_requirements_2026'])}")

    # Test Case 2: JS1062 (CityU) - Needs ENG Level 5
    js1062 = [x for x in data if x["jupas_code"] == "JS1062"][0]
    print("\n--- Testing JS1062 (High Eng Threshold) ---")
    student_c = {"CHI": "3", "ENG": "4", "MATH": "3", "CSD": "A", "Biology": "3", "Chemistry": "3"}
    print(f"Student C (Eng 4): {check_eligibility(student_c, js1062['min_requirements_2026'])}")

    # Test Case 3: JS4601 (CUHK Science) - Specific Pool + Category A Wildcard
    js4601 = [x for x in data if x["jupas_code"] == "JS4601"][0]
    print("\n--- Testing JS4601 (Pool + Cat A Wildcard) ---")
    # User's sample: CHIN:5**, ENG:5*, MATH:5*, M1:3, BIO:5* -> Should PASS
    student_user = {
        "Chinese Language": "5**", 
        "English Language": "5*", 
        "Mathematics (Compulsory Part)": "5*", 
        "Mathematics Extended Part (Module 1)": "3", 
        "Biology": "5*", 
        "Citizenship and Social Development": "A"
    }
    print(f"Student User Sample: {check_eligibility(student_user, js4601['min_requirements_2026'])}")

if __name__ == "__main__":
    run_tests()
