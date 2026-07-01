"""Render the 1200x630 social-share (Open Graph) image for JUPASCal.

Clean, neutral, on-brand — brand wordmark + a plainly-worded bilingual tagline
in the app's palette. Run: ~/miniconda3/envs/jupascal/bin/python scripts/gen_og_image.py
Output: public/og-image.png
"""
import pathlib
from playwright.sync_api import sync_playwright

OUT = pathlib.Path(__file__).resolve().parent.parent / "public" / "og-image.png"

HTML = """
<!doctype html><html lang="zh-Hant"><head><meta charset="utf-8">
<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Source+Serif+4:wght@700&family=Noto+Serif+TC:wght@700&text=2026%20JUPAS%E8%A8%88%E5%88%86%E5%99%A8%28%E9%9D%9E%E5%AE%98%E6%96%B9%29&display=swap">
<style>
  * { margin: 0; box-sizing: border-box; }
  html, body { width: 1200px; height: 630px; }
  .card {
    width: 1200px; height: 630px; background: #f8f0ea; color: #4d281a;
    padding: 0 96px; display: flex; flex-direction: column; justify-content: center;
    /* Match the app's profile-name serif (--font-serif); Source Serif 4 stands in
       for the macOS-only Iowan/Charter on the headless renderer, Noto Serif TC
       carries the CJK glyphs (計分器). */
    font-family: "Source Serif 4", "Iowan Old Style", "Charter", "Noto Serif TC", Georgia, serif;
  }
  .word { font-size: 104px; font-weight: 700; letter-spacing: -0.02em; line-height: 1; }
  .word .yr { color: #c2452e; }
  .word .unofficial { font-size: 30px; font-weight: 400; color: #a08d80;
                      letter-spacing: 0; vertical-align: 0.55em; margin-left: 10px; }
  .rule { width: 132px; height: 6px; background: #c2452e; border-radius: 3px; margin: 34px 0; }
  .tag { font-family: "Helvetica Neue", Helvetica, Arial, sans-serif; color: #786257;
         font-size: 42px; line-height: 1.4; max-width: 940px; }
  .tag .en { display: block; font-size: 32px; margin-top: 10px; color: #8a7468; }
  .url { font-family: "Helvetica Neue", Helvetica, Arial, sans-serif; color: #c2452e;
         font-weight: 700; font-size: 30px; margin-top: 46px; letter-spacing: 0.01em; }
  .free { font-family: "Helvetica Neue", Helvetica, Arial, sans-serif; color: #786257;
          font-size: 26px; margin-top: 14px; letter-spacing: 0.01em; }
</style></head>
<body>
  <div class="card">
    <div class="word"><span class="yr">2026</span> JUPAS 計分器<span class="unofficial">(非官方)</span></div>
    <div class="rule"></div>
    <div class="tag">比較全港大學各 JUPAS 課程收生分數
      <span class="en">An unofficial JUPAS / DSE admission-score calculator</span>
    </div>
    <div class="url">jupascal.com</div>
    <div class="free">完全免費 · 絕不收集個人資料 · 毋需帳戶 · 開源</div>
  </div>
</body></html>
"""

with sync_playwright() as p:
    browser = p.chromium.launch()
    page = browser.new_page(viewport={"width": 1200, "height": 630}, device_scale_factor=1)
    page.set_content(HTML, wait_until="networkidle")
    page.wait_for_timeout(1500)  # let webfonts (incl. CJK) settle
    page.locator(".card").screenshot(path=str(OUT))
    browser.close()

print(f"Wrote {OUT}")
