#!/bin/bash
# Rebuild the workbook, recalc all test students headless (in batches so no single
# soffice call hits the timeout), report unique mismatches vs the TS oracle.
cd "$(dirname "$0")/../.."
PY=/home/user/miniconda3/envs/jupascal/bin/python
$PY scripts/excel/build_2026_excel.py >/dev/null 2>&1 || { echo "BUILD FAILED"; $PY scripts/excel/build_2026_excel.py 2>&1 | tail -5; exit 1; }
$PY - <<'PYEOF'
import openpyxl, json, warnings, os; warnings.simplefilter("ignore")
def gc(g): return int(g) if g in ("1","2","3","4","5") else g
PH=["請選擇第一選修科","請選擇第二選修科","請選擇第三選修科","請選擇第四選修科"]
os.makedirs("build/recalc", exist_ok=True)
for f in os.listdir("build/recalc"):
    if f.startswith("in_"): os.remove(os.path.join("build/recalc", f))
for s in json.load(open("scripts/excel/test_students.json")):
    wb=openpyxl.load_workbook("build/2026 JUPAS Cal (generated).xlsx"); h=wb["主頁"]; h["D5"]="否"
    c=s["cores"]; h["C8"]=gc(c["chi"]); h["C9"]=gc(c["eng"]); h["C10"]=gc(c["math"]); h["C11"]="達標"
    h["C12"]=gc(s["m12"]["grade"]) if s.get("m12") else "請選擇等級"
    h["D12"]="M2" if (s.get("m12") and s["m12"].get("module")==2) else "M1"
    for i in range(4): h[f"B{15+i}"]=PH[i]; h[f"C{15+i}"]="請選擇等級"
    for i,e in enumerate(s["electives"]): h[f"B{15+i}"]=e["zh"]; h[f"C{15+i}"]=gc(e["grade"])
    wb.save(f"build/recalc/in_{s['name']}.xlsx")
PYEOF
export HOME=/tmp/lohome; rm -rf build/recalc/out; mkdir -p build/recalc/out
# fresh, unlocked LibreOffice profile with force-recalc-on-load
pkill -9 -f soffice.bin 2>/dev/null; sleep 1; rm -rf /tmp/lo_prof; mkdir -p /tmp/lo_prof/user
cat > /tmp/lo_prof/user/registrymodifications.xcu <<'XCU'
<?xml version="1.0" encoding="UTF-8"?>
<oor:items xmlns:oor="http://openoffice.org/2001/registry" xmlns:xs="http://www.w3.org/2001/XMLSchema" xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance">
 <item oor:path="/org.openoffice.Office.Calc/Formula/Load"><prop oor:name="OOXMLRecalcMode" oor:op="fuse"><value>0</value></prop></item>
</oor:items>
XCU
# Convert in small batches: one soffice call per batch so no single call hits the
# timeout and leaves the rest stale. Each batch gets its own fresh process.
files=(build/recalc/in_*.xlsx); batch=4
for ((i=0; i<${#files[@]}; i+=batch)); do
  chunk=("${files[@]:i:batch}")
  timeout 240 soffice --headless --convert-to xlsx --outdir build/recalc/out \
    "${chunk[@]}" -env:UserInstallation=file:///tmp/lo_prof </dev/null >>/tmp/conv.log 2>&1
  pkill -9 -f soffice.bin 2>/dev/null; sleep 1
done
$PY - <<'PYEOF'
import openpyxl, json, warnings, collections, os; warnings.simplefilter("ignore")
oracle=json.load(open("build/oracle_scores.json")); data={p['jupas_code']:p for p in json.load(open('data/processed/JUPAS_2026_Unified_Data.json'))}
allmis=collections.Counter(); per=[]; missing=[]
for s in json.load(open("scripts/excel/test_students.json")):
    fp=f"build/recalc/out/in_{s['name']}.xlsx"
    if not os.path.exists(fp): missing.append(s["name"]); continue
    ws=openpyxl.load_workbook(fp, data_only=True)["計分版"]
    codes={ws[f"A{r}"].value:ws[f"J{r}"].value for r in range(36,458) if ws[f"A{r}"].value}
    m=[k for k,v in oracle[s["name"]].items() if abs((codes.get(k) if isinstance(codes.get(k),(int,float)) else 0)-v)>0.1]
    per.append(f"{s['name']}:{422-len(m)}")
    for k in m: allmis[k]+=1
print("per-student /422:", " ".join(per))
if missing: print("NOT CONVERTED:", missing)
print(f"UNIQUE mismatches: {len(allmis)}")
for k,cnt in allmis.most_common():
    p=data[k]; print(f"  {k}({p['institution']})x{cnt} cons={[c.get('type') for c in (p.get('calculation_constraints') or [])]}{'+bo' if p.get('best_of_weights_2025') else ''}")
PYEOF
