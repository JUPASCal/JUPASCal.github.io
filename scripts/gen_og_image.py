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
<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Gelasio:wght@400;600;700&display=swap">
<style>
  * { margin: 0; box-sizing: border-box; }
  html, body { width: 1200px; height: 630px; }
  .card {
    width: 1200px; height: 630px; background: #f8f0ea; color: #4d281a;
    padding: 0 96px; display: flex; flex-direction: column; justify-content: center;
    font-family: "Gelasio", Georgia, serif;
  }
  .word { font-size: 104px; font-weight: 700; letter-spacing: -0.02em; line-height: 1; }
  .word .yr { color: #c2452e; }
  .rule { width: 132px; height: 6px; background: #c2452e; border-radius: 3px; margin: 34px 0; }
  .tag { font-family: "Helvetica Neue", Helvetica, Arial, sans-serif; color: #786257;
         font-size: 42px; line-height: 1.4; max-width: 940px; }
  .tag .en { display: block; font-size: 32px; margin-top: 10px; color: #8a7468; }
  .url { font-family: "Helvetica Neue", Helvetica, Arial, sans-serif; color: #c2452e;
         font-weight: 700; font-size: 30px; margin-top: 46px; letter-spacing: 0.01em; }
</style></head>
<body>
  <div class="card">
    <div class="word">JUPASCal <span class="yr">2026</span></div>
    <div class="rule"></div>
    <div class="tag">輸入 DSE 成績，比較全港大學各 JUPAS 課程收生分數
      <span class="en">An unofficial JUPAS / DSE admission-score calculator</span>
    </div>
    <div class="url">jupascal.com</div>
  </div>
</body></html>
"""

with sync_playwright() as p:
    browser = p.chromium.launch()
    page = browser.new_page(viewport={"width": 1200, "height": 630}, device_scale_factor=1)
    page.set_content(HTML, wait_until="networkidle")
    page.wait_for_timeout(600)  # let webfont settle
    page.locator(".card").screenshot(path=str(OUT))
    browser.close()

print(f"Wrote {OUT}")
