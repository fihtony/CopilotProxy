import { test, expect } from "@playwright/test";

const ADMIN_URL = "http://127.0.0.1:8020"; // Admin API
const CLIENT_URL = "http://127.0.0.1:8022"; // OpenAI-compatible proxy API (unused here)

test.describe("Settings page", () => {
  test("TC-SET-01: reads and displays current settings", async ({ page }) => {
    await expect.poll(async () => (await page.request.get(`${ADMIN_URL}/health`)).status()).toBe(200);

    await page.goto("/settings");
    await expect(page.getByRole("heading", { name: "Settings" })).toBeVisible();
    await expect(page.getByTestId("settings-url")).toBeVisible();
    await expect(page.getByTestId("settings-auto-refresh")).toBeVisible();
  });

  test("TC-SET-02: test connection shows model list", async ({ page }) => {
    await expect.poll(async () => (await page.request.get(`${ADMIN_URL}/health`)).status()).toBe(200);

    await page.goto("/settings");
    await page.getByTestId("test-connection").click();
    await expect(page.getByTestId("test-result")).toBeVisible();
  });

  test("TC-SET-03: saves auto-refresh with a separate button", async ({ page, request }) => {
    await expect.poll(async () => (await page.request.get(`${ADMIN_URL}/health`)).status()).toBe(200);

    const current = await request.get(`${ADMIN_URL}/api/admin/settings`);
    const original = await current.json();
    const nextInterval = original.auto_refresh_interval === "300" ? "900" : "300";

    try {
      await page.goto("/settings");

      await expect(page.getByTestId("settings-save")).toBeDisabled();
      await expect(page.getByTestId("settings-auto-refresh-save")).toBeDisabled();

      await page.getByTestId("settings-auto-refresh").selectOption(nextInterval);

      await expect(page.getByTestId("settings-auto-refresh-save")).toBeEnabled();
      await expect(page.getByTestId("settings-save")).toBeDisabled();

      await page.getByTestId("settings-auto-refresh-save").click();
      await expect(page.getByText("Auto-refresh settings saved ✓")).toBeVisible();

      const updated = await request.get(`${ADMIN_URL}/api/admin/settings`);
      const updatedBody = await updated.json();
      expect(updatedBody.auto_refresh_interval).toBe(nextInterval);
    } finally {
      await request.put(`${ADMIN_URL}/api/admin/settings`, {
        data: { auto_refresh_interval: original.auto_refresh_interval ?? "30" },
      });
    }
  });

  test("TC-SET-04: updates settings via API", async ({ request }) => {
    // Read current
    const current = await request.get(`${ADMIN_URL}/api/admin/settings`);
    const original = await current.json();

    // Update
    const updated = await request.put(`${ADMIN_URL}/api/admin/settings`, {
      data: { default_model: "gpt-4o" },
    });
    expect(updated.status()).toBe(200);
    const body = await updated.json();
    expect(body.default_model).toBe("gpt-4o");

    // Restore
    await request.put(`${ADMIN_URL}/api/admin/settings`, {
      data: { default_model: original.default_model },
    });
  });

  test("TC-SET-05: rejects invalid URL in settings", async ({ request }) => {
    const res = await request.put(`${ADMIN_URL}/api/admin/settings`, {
      data: { copilot_url: "not-a-url" },
    });
    expect(res.status()).toBe(400);
  });
});
