import { Router } from "express";
import { z } from "zod";
import { v4 as uuidv4 } from "uuid";
import axios from "axios";
import { createApiKeyRecord, softDeleteApiKey, getApiKeyById, listApiKeys, updateApiKey } from "../db/database.js";
import { readKeyHistory, readKeyStats, readOverview } from "../services/statsService.js";
import { getSettings, updateSettings } from "../services/settingsService.js";
import type { TimeWindow } from "../types.js";

const router = Router();

const createSchema = z.object({
  name: z.string().min(1),
  model: z.string().min(1).optional(),
});

const updateSchema = z.object({
  name: z.string().min(1).optional(),
  model: z.string().min(1).optional(),
  is_active: z.number().int().min(0).max(1).optional(),
});

const settingsSchema = z.object({
  copilot_url: z.string().url().optional(),
  default_model: z.string().min(1).optional(),
});

function normalizeWindow(value: string | undefined): TimeWindow {
  if (value === "24h" || value === "7d" || value === "30d" || value === "90d") {
    return value;
  }
  return "24h";
}

// ── Key routes ──────────────────────────────────────────────────────────────
router.get("/keys", (req, res) => {
  const search = typeof req.query.search === "string" ? req.query.search : undefined;
  const sortBy = typeof req.query.sortBy === "string" ? req.query.sortBy : undefined;
  const sortDir = typeof req.query.sortDir === "string" ? req.query.sortDir : undefined;
  res.json({ items: listApiKeys(search, sortBy, sortDir) });
});

router.post("/keys", (req, res) => {
  const parsed = createSchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ error: parsed.error.flatten() });
  }

  const defaultModel = getSettings().default_model;
  const rawKey = `cps_${uuidv4().replaceAll("-", "")}`;
  const record = createApiKeyRecord({
    rawKey,
    name: parsed.data.name,
    model: parsed.data.model ?? defaultModel,
  });

  res.status(201).json({ item: record, rawKey });
});

router.patch("/keys/:id", (req, res) => {
  const parsed = updateSchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ error: parsed.error.flatten() });
  }

  const updated = updateApiKey(Number(req.params.id), parsed.data);
  if (!updated) {
    return res.status(404).json({ error: { message: "API key not found" } });
  }

  res.json({ item: updated });
});

router.delete("/keys/:id", (req, res) => {
  const changes = softDeleteApiKey(Number(req.params.id));
  if (changes === 0) {
    return res.status(404).json({ error: { message: "API key not found" } });
  }

  res.status(200).json({ ok: true });
});

router.get("/keys/:id/stats", (req, res) => {
  const id = Number(req.params.id);
  const key = getApiKeyById(id);
  if (!key) {
    return res.status(404).json({ error: { message: "API key not found" } });
  }

  const window = key.is_deleted ? null : normalizeWindow(String(req.query.window ?? "24h"));
  res.json({ item: key, ...readKeyStats(id, window) });
});

router.get("/keys/:id/history", (req, res) => {
  const id = Number(req.params.id);
  const key = getApiKeyById(id);
  if (!key) {
    return res.status(404).json({ error: { message: "API key not found" } });
  }

  const page = Math.max(1, Number(req.query.page ?? 1));
  const limit = Math.min(100, Math.max(1, Number(req.query.limit ?? 20)));
  res.json(readKeyHistory(id, page, limit));
});

router.get("/overview", (req, res) => {
  const settings = getSettings();
  const overview = readOverview(normalizeWindow(String(req.query.window ?? "24h")));
  res.json({ ...overview, defaultModel: settings.default_model });
});

// ── Settings routes ─────────────────────────────────────────────────────────
router.get("/settings", (_req, res) => {
  res.json(getSettings());
});

router.put("/settings", (req, res) => {
  const parsed = settingsSchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ error: parsed.error.flatten() });
  }

  const updated = updateSettings(parsed.data);
  res.json(updated);
});

// ── Health check for upstream Copilot Connect ───────────────────────────────

// GET: uses the saved copilot_url from settings (used by HealthIndicator polling)
router.get("/health/copilot", async (_req, res) => {
  const testUrl = getSettings().copilot_url;
  const start = Date.now();
  try {
    const response = await axios.get(`${testUrl}/v1/models`, {
      timeout: 5000,
      validateStatus: () => true,
    });
    const latencyMs = Date.now() - start;
    if (response.status === 200 && response.data?.data) {
      const models = (response.data.data as Array<{ id: string }>).map((m) => m.id);
      return res.json({ ok: true, latencyMs, models });
    }
    return res.json({ ok: false, latencyMs, status: response.status });
  } catch {
    return res.json({ ok: false, latencyMs: Date.now() - start });
  }
});

// POST: accepts copilot_url in body for testing an unsaved URL
router.post("/health/copilot", async (req, res) => {
  // Accept URL from request body (for testing with unsaved URL)
  // or fall back to cached settings (for periodic checks)
  const testUrl = req.body?.copilot_url || getSettings().copilot_url;
  const start = Date.now();
  try {
    const response = await axios.get(`${testUrl}/v1/models`, {
      timeout: 5000,
      validateStatus: () => true,
    });
    const latencyMs = Date.now() - start;
    if (response.status === 200 && response.data?.data) {
      const models = (response.data.data as Array<{ id: string }>).map((m) => m.id);
      return res.json({ ok: true, latencyMs, models });
    }
    return res.json({ ok: false, latencyMs, status: response.status });
  } catch {
    return res.json({ ok: false, latencyMs: Date.now() - start });
  }
});

export default router;
