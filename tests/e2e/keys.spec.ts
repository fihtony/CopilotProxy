import { test, expect } from "@playwright/test";

const PROXY_URL = "http://127.0.0.1:3000";

// TC-KEY-01 to TC-KEY-06: API key management lifecycle (modal-based UI)

test("TC-KEY-01/03/05: creates, edits, and soft-deletes an API key via modals", async ({ page }) => {
  await expect.poll(async () => (await page.request.get(`${PROXY_URL}/health`)).status()).toBe(200);

  await page.goto("/keys");

  // TC-KEY-01: Create key via modal
  const uniqueName = `Ops ${Date.now()}`;
  await page.getByTestId("open-create").click();
  await page.getByTestId("create-name").fill(uniqueName);
  await page.getByTestId("create-submit").click();

  // Key is shown once
  await expect(page.getByTestId("generated-key")).toContainText("cps_");

  // Close modal and verify row exists
  await page.getByRole("button", { name: "Done" }).click();
  await expect(page.getByTestId("key-row").filter({ hasText: uniqueName }).first()).toBeVisible();

  // TC-KEY-03: Edit via modal
  const row = page.getByTestId("key-row").filter({ hasText: uniqueName }).first();
  await row.getByTestId("edit-key").click();
  const editedName = `${uniqueName} Edited`;
  await page.getByTestId("edit-name").fill(editedName);
  await page.getByTestId("edit-submit").click();

  await expect(page.getByTestId("key-row").filter({ hasText: editedName }).first()).toBeVisible();

  // TC-KEY-05: Soft delete via confirmation modal
  const editedRow = page.getByTestId("key-row").filter({ hasText: editedName }).first();
  await editedRow.getByTestId("delete-key").click();
  await page.getByTestId("confirm-delete").click();

  // Row should still be visible but marked as deleted (no edit/delete buttons)
  const deletedRow = page.getByTestId("key-row").filter({ hasText: editedName }).first();
  await expect(deletedRow).toBeVisible();
  await expect(deletedRow.getByTestId("edit-key")).toHaveCount(0);
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

test("TC-KEY-02: default model fallback from settings", async ({ request }) => {
  // POST without model field — should default to settings default_model
  const create = await request.post(`${PROXY_URL}/api/keys`, {
    data: { name: `Default Model ${Date.now()}` },
  });
  expect(create.status()).toBe(201);
  const { item } = await create.json();

  // Read default from settings
  const settings = await request.get(`${PROXY_URL}/api/settings`);
  const { default_model } = await settings.json();
  expect(item.model).toBe(default_model);

  await request.delete(`${PROXY_URL}/api/keys/${item.id}`);
});

test("TC-KEY-05: generated raw key shown only once — not visible after closing modal", async ({ page }) => {
  await expect.poll(async () => (await page.request.get(`${PROXY_URL}/health`)).status()).toBe(200);

  await page.goto("/keys");
  const uniqueName = `Once ${Date.now()}`;
  await page.getByTestId("open-create").click();
  await page.getByTestId("create-name").fill(uniqueName);
  await page.getByTestId("create-submit").click();

  const generatedKey = page.getByTestId("generated-key");
  await expect(generatedKey).toContainText("cps_");
  const fullKey = (await generatedKey.textContent()) ?? "";

  // Close modal and verify full key is no longer visible
  await page.getByRole("button", { name: "Done" }).click();
  await expect(page.getByText(fullKey)).not.toBeVisible();
});

test("TC-KEY-06: soft-deleted key is rejected by proxy but data remains", async ({ request }) => {
  const create = await request.post(`${PROXY_URL}/api/keys`, {
    data: { name: `SoftDel ${Date.now()}`, model: "gpt-5-mini" },
  });
  const { item, rawKey } = await create.json();

  // Use the key first
  await request.post(`${PROXY_URL}/v1/chat/completions`, {
    headers: { Authorization: `Bearer ${rawKey}` },
    data: { messages: [{ role: "user", content: "before delete" }] },
  });

  // Soft delete
  const del = await request.delete(`${PROXY_URL}/api/keys/${item.id}`);
  expect(del.status()).toBe(200);
  const delBody = await del.json();
  expect(delBody.ok).toBe(true);

  // Proxy rejects the deleted key
  const proxyRes = await request.post(`${PROXY_URL}/v1/chat/completions`, {
    headers: { Authorization: `Bearer ${rawKey}` },
    data: { messages: [{ role: "user", content: "after delete" }] },
  });
  expect(proxyRes.status()).toBe(401);

  // But stats are still accessible
  const stats = await request.get(`${PROXY_URL}/api/keys/${item.id}/stats`);
  expect(stats.status()).toBe(200);
  const statsBody = await stats.json();
  expect(statsBody.stats.totalCalls).toBeGreaterThan(0);
});

test("TC-KEY-06: creating a key with empty name shows validation error", async ({ page, request }) => {
  await expect.poll(async () => (await request.get(`${PROXY_URL}/health`)).status()).toBe(200);

  // API-level validation
  const bad = await request.post(`${PROXY_URL}/api/keys`, { data: { name: "" } });
  expect(bad.status()).toBe(400);
});

