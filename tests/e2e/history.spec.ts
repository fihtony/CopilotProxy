import { test, expect } from "@playwright/test";

const PROXY_URL = "http://127.0.0.1:3000";

// TC-HIST-01/02: history table and model column

test("TC-HIST-01/02: shows request history rows and forced model usage", async ({ page }) => {
  await expect.poll(async () => (await page.request.get(`${PROXY_URL}/health`)).status()).toBe(200);

  const createResponse = await page.request.post(`${PROXY_URL}/api/keys`, {
    data: { name: `History ${Date.now()}`, model: "gpt-5-mini" },
  });
  const created = await createResponse.json();

  for (let index = 0; index < 3; index += 1) {
    await page.request.post(`${PROXY_URL}/v1/chat/completions`, {
      headers: { Authorization: `Bearer ${created.rawKey}` },
      data: { model: "not-used", messages: [{ role: "user", content: `history-${index}` }] },
    });
  }

  await page.goto(`/keys/${created.item.id}`);
  await expect(page.getByTestId("history-row")).toHaveCount(3);
  await expect(page.getByRole("cell", { name: "/v1/chat/completions" }).first()).toBeVisible();
  await expect(page.getByRole("cell", { name: "gpt-5-mini" }).first()).toBeVisible();
});

// TC-HIST-03: pagination (API-level)

test("TC-HIST-03: pagination returns correct rows", async ({ request }) => {
  const createResponse = await request.post(`${PROXY_URL}/api/keys`, {
    data: { name: `Pagination ${Date.now()}`, model: "gpt-5-mini" },
  });
  const { item, rawKey } = await createResponse.json();

  // Generate 25 requests to exceed the default page size of 20
  for (let i = 0; i < 25; i++) {
    await request.post(`${PROXY_URL}/v1/chat/completions`, {
      headers: { Authorization: `Bearer ${rawKey}` },
      data: { messages: [{ role: "user", content: `page-test-${i}` }] },
    });
  }

  const page1 = await request.get(`${PROXY_URL}/api/keys/${item.id}/history?page=1&limit=20`);
  const page2 = await request.get(`${PROXY_URL}/api/keys/${item.id}/history?page=2&limit=20`);

  const body1 = await page1.json();
  const body2 = await page2.json();

  expect(body1.items.length).toBe(20);
  expect(body2.items.length).toBeGreaterThanOrEqual(5);
  expect(body1.total).toBe(25);

  // No overlapping IDs between pages
  const ids1 = new Set(body1.items.map((r: { id: number }) => r.id));
  const ids2 = new Set(body2.items.map((r: { id: number }) => r.id));
  const overlap = [...ids2].filter((id) => ids1.has(id));
  expect(overlap.length).toBe(0);

  await request.delete(`${PROXY_URL}/api/keys/${item.id}`);
});
