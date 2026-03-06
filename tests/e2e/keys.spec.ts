import { test, expect } from "@playwright/test";

const PROXY_URL = "http://127.0.0.1:3000";

// TC-KEY-01 to TC-KEY-06: API key management lifecycle

test("TC-KEY-01/03/04/05: creates, updates, disables and deletes an API key", async ({ page }) => {
  await expect.poll(async () => (await page.request.get(`${PROXY_URL}/health`)).status()).toBe(200);

  await page.goto("/keys");

  const uniqueName = `Ops ${Date.now()}`;
  const createPanel = page.getByText("Create a new key").locator("..").locator("..");
  await createPanel.getByRole("textbox", { name: "Name", exact: true }).fill(uniqueName);
  await createPanel.getByRole("textbox", { name: "Default Copilot Model" }).fill("gpt-5-mini");
  await page.getByRole("button", { name: "Create API Key" }).click();

  // TC-KEY-01: generated key has correct format and is visible only once
  await expect(page.getByTestId("generated-key")).toContainText("cps_");
  const keyRow = page.getByTestId("key-row").first();
  await expect(keyRow).toBeVisible();

  // TC-KEY-03: rename and change model
  const renamed = `${uniqueName} Renamed`;
  await keyRow.getByRole("textbox").first().fill(renamed);
  await keyRow.getByRole("textbox").nth(1).fill("gpt-4o-mini");
  await keyRow.getByRole("button", { name: "Save" }).click();

  const renamedRow = page
    .getByTestId("key-row")
    .filter({ has: page.locator(`input[value="${renamed}"]`) })
    .first();
  await expect(renamedRow).toBeVisible();
  await expect(renamedRow.locator('input[value="gpt-4o-mini"]')).toBeVisible();

  // TC-KEY-04: disable
  await renamedRow.getByRole("button", { name: "Disable" }).click();
  await expect(renamedRow.getByRole("button", { name: "Enable" })).toBeVisible();

  // Re-enable
  await renamedRow.getByRole("button", { name: "Enable" }).click();
  await expect(renamedRow.getByRole("button", { name: "Disable" })).toBeVisible();

  // TC-KEY-05: delete
  await renamedRow.getByRole("button", { name: "Delete" }).click();
  await expect(page.getByTestId("key-row").filter({ has: page.locator(`input[value="${renamed}"]`) })).toHaveCount(0);
});

test("TC-KEY-01: DB fields are set correctly after key creation", async ({ page, request }) => {
  await expect.poll(async () => (await request.get(`${PROXY_URL}/health`)).status()).toBe(200);

  const name = `DB Check ${Date.now()}`;
  const create = await request.post(`${PROXY_URL}/api/keys`, {
    data: { name, model: "gpt-4o-mini" },
  });
  expect(create.status()).toBe(201);
  const { item, rawKey } = await create.json();

  // Verify DB fields via admin API
  expect(item.name).toBe(name);
  expect(item.model).toBe("gpt-4o-mini");
  expect(item.is_active).toBe(1);
  expect(item.key_preview).toMatch(/^cps_.{4,8}\.{3}.{4}$/);
  expect(rawKey).toMatch(/^cps_[a-f0-9]{32}$/);

  // Cleanup
  await request.delete(`${PROXY_URL}/api/keys/${item.id}`);
});

test("TC-KEY-02: default model fallback is gpt-5-mini", async ({ request }) => {
  // POST without model field — should default to gpt-5-mini
  const create = await request.post(`${PROXY_URL}/api/keys`, {
    data: { name: `Default Model ${Date.now()}` },
  });
  expect(create.status()).toBe(201);
  const { item } = await create.json();
  expect(item.model).toBe("gpt-5-mini");

  await request.delete(`${PROXY_URL}/api/keys/${item.id}`);
});

test("TC-KEY-05: generated raw key shown only once — not visible after navigation", async ({ page }) => {
  await expect.poll(async () => (await page.request.get(`${PROXY_URL}/health`)).status()).toBe(200);

  await page.goto("/keys");
  const uniqueName = `Once ${Date.now()}`;
  const createPanel = page.getByText("Create a new key").locator("..").locator("..");
  await createPanel.getByRole("textbox", { name: "Name", exact: true }).fill(uniqueName);
  await page.getByRole("button", { name: "Create API Key" }).click();

  const generatedKey = await page.getByTestId("generated-key");
  await expect(generatedKey).toContainText("cps_");
  const fullKey = (await generatedKey.textContent()) ?? "";

  // Navigate away and back — the full key should no longer be visible
  await page.goto("/");
  await page.goto("/keys");
  await expect(page.getByText(fullKey)).not.toBeVisible();
});

test("TC-KEY-06: creating a key with empty name shows validation error", async ({ page, request }) => {
  await expect.poll(async () => (await request.get(`${PROXY_URL}/health`)).status()).toBe(200);

  // API-level validation
  const bad = await request.post(`${PROXY_URL}/api/keys`, { data: { name: "" } });
  expect(bad.status()).toBe(400);
});

