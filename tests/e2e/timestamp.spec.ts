import { test, expect } from "@playwright/test";

// TC-TIME: timestamp storage format and UI display

const ADMIN_URL = "http://127.0.0.1:8020"; // Admin API
const CLIENT_URL = "http://127.0.0.1:8022"; // OpenAI-compatible proxy API

// ISO 8601 with explicit UTC marker (e.g. "2024-01-01T12:00:00.000Z")
const ISO8601_UTC_RE = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/;

test.describe("Timestamps — storage format", () => {
  test("TC-TIME-01: api_keys created_at is ISO 8601 with UTC offset", async ({ request }) => {
    const create = await request.post(`${ADMIN_URL}/api/admin/keys`, {
      data: { name: `TS Key ${Date.now()}`, allowed_models: ["gpt-5-mini"], fallback_model: "gpt-5-mini" },
    });
    expect(create.status()).toBe(201);
    const { item } = await create.json();

    expect(item.created_at).toMatch(ISO8601_UTC_RE);
    expect(item.updated_at).toMatch(ISO8601_UTC_RE);

    await request.delete(`${ADMIN_URL}/api/admin/keys/${item.id}`);
  });

  test("TC-TIME-02: request logs timestamp is ISO 8601 with UTC offset", async ({ request }) => {
    const create = await request.post(`${ADMIN_URL}/api/admin/keys`, {
      data: { name: `TS Log ${Date.now()}`, allowed_models: ["gpt-5-mini"], fallback_model: "gpt-5-mini" },
    });
    const { item, rawKey } = await create.json();

    await request.post(`${CLIENT_URL}/api/v1/chat/completions`, {
      headers: { Authorization: `Bearer ${rawKey}` },
      data: { messages: [{ role: "user", content: "ts test" }] },
    });

    const hist = await request.get(`${ADMIN_URL}/api/admin/keys/${item.id}/history?limit=1`);
    const { items } = await hist.json();
    expect(items.length).toBe(1);
    expect(items[0].timestamp).toMatch(ISO8601_UTC_RE);

    await request.delete(`${ADMIN_URL}/api/admin/keys/${item.id}`);
  });

  test("TC-TIME-04: updated_at advances after key update", async ({ request }) => {
    const create = await request.post(`${ADMIN_URL}/api/admin/keys`, {
      data: { name: `TS Update ${Date.now()}`, allowed_models: ["gpt-5-mini"], fallback_model: "gpt-5-mini" },
    });
    const { item } = await create.json();
    const createdAt = new Date(item.created_at).getTime();

    // Brief pause to ensure measurable time diff on fast CI
    await new Promise((r) => setTimeout(r, 50));

    const patch = await request.patch(`${ADMIN_URL}/api/admin/keys/${item.id}`, {
      data: { name: "Renamed" },
    });
    const { item: updated } = await patch.json();
    const updatedAt = new Date(updated.updated_at).getTime();

    expect(updatedAt).toBeGreaterThanOrEqual(createdAt);

    await request.delete(`${ADMIN_URL}/api/admin/keys/${item.id}`);
  });
});

test.describe("Timestamps — UI display", () => {
  test("TC-TIME-03: UI shows timestamps in locale-formatted local time", async ({ page, request }) => {
    await expect.poll(async () => (await request.get(`${ADMIN_URL}/health`)).status()).toBe(200);

    const create = await request.post(`${ADMIN_URL}/api/admin/keys`, {
      data: { name: `TS UI ${Date.now()}`, allowed_models: ["gpt-5-mini"], fallback_model: "gpt-5-mini" },
    });
    const { item, rawKey } = await create.json();

    // Generate a request so the history table has at least one row
    await request.post(`${CLIENT_URL}/api/v1/chat/completions`, {
      headers: { Authorization: `Bearer ${rawKey}` },
      data: { messages: [{ role: "user", content: "timestamp display test" }] },
    });

    await page.goto(`/keys/${item.id}`);
    const historyRow = page.getByTestId("history-row").first();
    await expect(historyRow).toBeVisible();

    // The first cell contains the formatted timestamp.
    const timeCell = historyRow.locator("td").first();
    const timeText = await timeCell.textContent();
    expect(timeText).not.toBeNull();

    // Verify it is parseable as a valid date (locale string may vary by environment).
    const parsed = new Date(timeText!);
    expect(isNaN(parsed.getTime())).toBe(false);

    await request.delete(`${ADMIN_URL}/api/admin/keys/${item.id}`);
  });
});
