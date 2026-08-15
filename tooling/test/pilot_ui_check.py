from pathlib import Path

from playwright.sync_api import expect, sync_playwright


BASE_URL = "http://127.0.0.1:3100"
OUTPUT = Path("test-results/pilot-ui")


def main() -> None:
    OUTPUT.mkdir(parents=True, exist_ok=True)
    with sync_playwright() as playwright:
        browser = playwright.chromium.launch(headless=True)
        page = browser.new_page(viewport={"width": 1440, "height": 1000}, device_scale_factor=1)
        console_errors: list[str] = []
        page.on("console", lambda message: console_errors.append(message.text) if message.type == "error" else None)

        page.goto(f"{BASE_URL}/sign-in")
        page.wait_for_load_state("networkidle")
        page.get_by_label("Email").fill("owner@wanaflow.test")
        page.get_by_label("Password").fill("Wanaflow-test-2026!")
        page.get_by_role("button", name="Enter Wanaflow").click()
        page.wait_for_url(f"{BASE_URL}/")

        page.goto(f"{BASE_URL}/people")
        page.wait_for_load_state("networkidle")
        expect(page.get_by_role("heading", name="The people in the process.")).to_be_visible()
        expect(page.get_by_role("button", name="Invite someone")).to_be_visible()
        page.screenshot(path=str(OUTPUT / "people.png"), full_page=True)

        page.goto(f"{BASE_URL}/updates")
        page.wait_for_load_state("networkidle")
        expect(page.get_by_role("heading", name="What changed around you.")).to_be_visible()
        page.screenshot(path=str(OUTPUT / "updates.png"), full_page=True)

        library = page.evaluate("async () => (await fetch('/api/v1/library')).json()")
        project = library["data"]["workspaces"][0]["projects"][0]
        project_id = project["id"]
        form_source = {
            "schemaVersion": 19,
            "type": "default",
            "id": "Form_pilot_preview",
            "components": [
                {"id": "Text_intro", "type": "text", "text": "# Travel request\n\nGive the approver just enough context."},
                {"id": "Field_destination", "type": "textfield", "key": "destination", "label": "Destination", "validate": {"required": True}},
                {"id": "Field_reason", "type": "textarea", "key": "reason", "label": "Why is this trip needed?"},
            ],
        }
        existing_form = next((artifact for artifact in project["artifacts"] if artifact["key"] == "pilot-travel-form"), None)
        created = {"data": existing_form} if existing_form else page.evaluate(
            """async ({ projectId, source }) => {
              const response = await fetch(`/api/v1/projects/${projectId}/artifacts`, {
                method: 'POST', headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ key: 'pilot-travel-form', name: 'Pilot travel form', type: 'FORM', source: JSON.stringify(source) })
              });
              return response.json();
            }""",
            {"projectId": project_id, "source": form_source},
        )
        form_id = created["data"]["id"]
        page.goto(f"{BASE_URL}/forms/{form_id}")
        page.wait_for_load_state("networkidle")
        expect(page.get_by_text("Ask only what the work needs.")).to_be_visible(timeout=15000)
        page.get_by_role("button", name="Preview", exact=True).click()
        expect(page.get_by_role("heading", name="Preview as work.")).to_be_visible()
        expect(page.get_by_label("Task form")).to_be_visible()
        page.screenshot(path=str(OUTPUT / "form-preview.png"), full_page=True)

        mobile = browser.new_page(viewport={"width": 390, "height": 844}, device_scale_factor=1)
        mobile.goto(f"{BASE_URL}/sign-in")
        mobile.wait_for_load_state("networkidle")
        mobile.get_by_label("Email").fill("owner@wanaflow.test")
        mobile.get_by_label("Password").fill("Wanaflow-test-2026!")
        mobile.get_by_role("button", name="Enter Wanaflow").click()
        mobile.wait_for_url(f"{BASE_URL}/")
        expect(mobile.get_by_text("Design").first).to_be_visible()
        mobile.screenshot(path=str(OUTPUT / "mobile-today.png"), full_page=True)

        assert not console_errors, "Browser console errors: " + " | ".join(console_errors)
        browser.close()


if __name__ == "__main__":
    main()
