import json
import os

DATA_FILE = "Reference(2026)/PolyU/PolyU_2026_Data.json"

# Median values extracted from af_2025_PolyU.pdf
MEDIANS = {
    "JS3060": "185.5", "JS3220": "193.5", "JS3250": "171.5", "JS3214": "165.8",
    "JS3140": "210.0", "JS3150": "218.0", "JS3011": "209.0", "JS3791": "188.1",
    "JS3211": "181.5", "JS3003": "179.0", "JS3320": "223.0", "JS3739": "216.5",
    "JS3006": "215.0", "JS3868": "230.0", "JS3004": "184.0", "JS3223": "220.0",
    "JS3569": "178.0", "JS3170": "215.0", "JS3005": "215.0", "JS3240": "178.0",
    "JS3375": "220.0", "JS3050": "177.0", "JS3255": "203.0", "JS3070": "179.0",
    "JS3310": "166.5", "JS3007": "185.0", "JS3180": "218.0", "JS3237": "195.0",
    "JS3080": "182.5", "JS3741": "208.0", "JS3478": "309.0", "JS3337": "209.0",
    "JS3648": "218.0", "JS3624": "278.0", "JS3290": "277.8", "JS3030": "215.0",
    "JS3636": "320.0", "JS3236": "195.0", "JS3612": "339.0", "JS3008": "208.0",
    "JS3130": "206.0", "JS3242": "264.3", "JS3789": "175.8", "JS3241": "189.5"
}

def patch():
    if not os.path.exists(DATA_FILE):
        print(f"Error: {DATA_FILE} not found")
        return

    with open(DATA_FILE, 'r', encoding='utf-8') as f:
        data = json.load(f)

    updated_count = 0
    for entry in data:
        code = entry.get('jupas_code')
        if code in MEDIANS:
            entry['score_median'] = MEDIANS[code]
            updated_count += 1

    with open(DATA_FILE, 'w', encoding='utf-8') as f:
        json.dump(data, f, ensure_ascii=False, indent=2)

    print(f"Successfully updated {updated_count} PolyU programmes with Median scores.")

if __name__ == "__main__":
    patch()
