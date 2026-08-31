from pathlib import Path

from playwright.sync_api import sync_playwright


OUT = Path("D:/agent_road/Auto-Memeries-Doll/.tmp/map-check")
OUT.mkdir(parents=True, exist_ok=True)


with sync_playwright() as p:
    browser = p.chromium.launch(headless=True)

    desktop = browser.new_page(viewport={"width": 1440, "height": 900})
    desktop.goto("http://127.0.0.1:4173/memory/map", wait_until="domcontentloaded", timeout=60000)
    desktop.wait_for_load_state("networkidle")
    desktop.screenshot(path=str(OUT / "desktop.png"), full_page=True)

    mobile = browser.new_page(viewport={"width": 390, "height": 844})
    mobile.goto("http://127.0.0.1:4173/memory/map", wait_until="domcontentloaded", timeout=60000)
    mobile.wait_for_load_state("networkidle")
    mobile.screenshot(path=str(OUT / "mobile.png"), full_page=True)

    browser.close()
