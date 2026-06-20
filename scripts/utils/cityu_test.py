from playwright.sync_api import sync_playwright
import json

COLLEGE_IDS = [500, 1, 427, 2, 3, 4, 5, 6, 8, 9, 103]

with sync_playwright() as p:
    browser = p.chromium.launch(headless=True)
    page = browser.new_page()

    # Test with College of Business (id=1) first
    url = "https://www.cityu.edu.hk/admo/_static_json/_api_json/get-programme-by-collage/1.json"
    print(f"Fetching: {url}")
    response = page.goto(url)
    print(f"Status: {response.status}")
    content = page.content()

    # Try to extract JSON from page body
    try:
        body = page.inner_text("body")
        data = json.loads(body)
        print(f"Keys: {list(data.keys()) if isinstance(data, dict) else 'list'}")
        print(json.dumps(data, indent=2)[:2000])
    except Exception as e:
        print(f"Error parsing JSON: {e}")
        print(content[:1000])

    browser.close()
