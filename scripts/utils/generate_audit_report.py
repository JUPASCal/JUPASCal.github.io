import json
import os

INPUT_FILE = "data/processed/JUPAS_2026_Unified_Data.json"
OUTPUT_FILE = "docs/audit_report.html"

def generate_report():
    if not os.path.exists(INPUT_FILE):
        print("Master JSON not found.")
        return

    with open(INPUT_FILE, encoding='utf-8') as f:
        data = json.load(f)

    html = """
    <html>
    <head>
        <title>JUPAS 2026 Data Audit Report</title>
        <style>
            body { font-family: sans-serif; line-height: 1.4; margin: 20px; }
            table { width: 100%; border-collapse: collapse; margin-bottom: 40px; }
            th, td { border: 1px solid #ccc; padding: 10px; text-align: left; vertical-align: top; }
            th { background-color: #f4f4f4; position: sticky; top: 0; }
            tr:nth-child(even) { background-color: #fafafa; }
            .error { color: #d9534f; font-weight: bold; }
            .raw { font-size: 0.85em; color: #666; font-style: italic; }
            .parsed { color: #2e6da4; font-weight: bold; }
            .institution-header { background-color: #333; color: white; padding: 10px; font-size: 1.5em; }
        </style>
    </head>
    <body>
        <h1>JUPAS 2026 Data Audit Report</h1>
        <p>Use this report to "eyeball" the parsed logic against the raw source strings.</p>
    """

    current_inst = ""
    for entry in data:
        if entry["institution"] != current_inst:
            current_inst = entry["institution"]
            html += f"<div class='institution-header'>{current_inst}</div>"
            html += """
            <table>
                <tr>
                    <th style='width: 80px;'>Code</th>
                    <th style='width: 200px;'>Name</th>
                    <th>2025 Calculation Logic (Weights & Formula)</th>
                    <th>2026 Min Requirements</th>
                </tr>
            """

        # Format Weights
        weights_html = f"<b>Formula:</b> {entry['formula_2025']} ({entry['formula_2025_id']})<br><br>"
        weights_html += f"<b>Parsed Weights:</b> <span class='parsed'>{entry['subject_weights_2025']}</span><br>"
        if entry['best_of_weights_2025']:
            weights_html += f"<b>Parsed Pools:</b> <span class='parsed'>{entry['best_of_weights_2025']}</span><br>"
        weights_html += f"<br><span class='raw'>Raw Source: {entry['subject_weights_2025_raw']}</span>"

        # Format Requirements
        req = entry['min_requirements_2026']
        req_html = f"Cores: {req['chi']}/{req['eng']}/{req['math']}/{req['csd']}<br><br>"
        req_html += f"<b>Elective 1:</b> <span class='parsed'>{req['elect1']}</span><br>"
        req_html += f"<b>Elective 2:</b> <span class='parsed'>{req['elect2']}</span><br>"
        if "conditional_remarks" in req:
            req_html += f"<br><b>Remarks:</b> {req['conditional_remarks']}"

        html += f"""
        <tr>
            <td>{entry['jupas_code']}</td>
            <td>{entry['name_en']}<br><small>{entry['name_zh']}</small></td>
            <td>{weights_html}</td>
            <td>{req_html}</td>
        </tr>
        """

        # Close table if next entry is different institution or last entry
        idx = data.index(entry)
        if idx == len(data)-1 or data[idx+1]["institution"] != current_inst:
            html += "</table>"

    html += "</body></html>"

    with open(OUTPUT_FILE, 'w', encoding='utf-8') as f:
        f.write(html)
    print(f"Audit report generated at {OUTPUT_FILE}")

if __name__ == "__main__":
    generate_report()
