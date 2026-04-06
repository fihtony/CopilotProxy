import { Router } from "express";
import { z } from "zod";
import { v4 as uuidv4 } from "uuid";
import axios from "axios";
import { createApiKeyRecord, softDeleteApiKey, getApiKeyById, listApiKeys, updateApiKey } from "../db/database.js";
import { readKeyHistory, readKeyStats, readOverview } from "../services/statsService.js";
import { getSettings, updateSettings } from "../services/settingsService.js";
import { validateCopilotUrl } from "../services/copilotUrlPolicy.js";
import type { TimeWindow } from "../types.js";

const router = Router();

const timeWindowSchema = z.enum(["24h", "7d", "30d", "90d"]);

const createSchema = z.object({
  name: z.string().min(1).max(255),
  model: z.string().min(1).max(255).optional(),
});

const updateSchema = z.object({
  name: z.string().min(1).max(255).optional(),
  model: z.string().min(1).max(255).optional(),
  is_active: z.number().int().min(0).max(1).optional(),
});

const copilotUrlSchema = z
  .string()
  .url()
  .superRefine((url, ctx) => {
    const result = validateCopilotUrl(url);
    if (!result.ok) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, message: result.error });
    }
  })
  .transform((url) => {
    const result = validateCopilotUrl(url);
    return result.ok ? result.normalizedUrl : url;
  });

const settingsSchema = z.object({
  copilot_url: copilotUrlSchema.optional(),
  default_model: z.string().min(1).max(255).optional(),
  dashboard_time_window: timeWindowSchema.optional(),
  key_detail_time_window: timeWindowSchema.optional(),
});

const healthCheckSchema = z.object({
  copilot_url: copilotUrlSchema.optional(),
});

function normalizeWindow(value: string | undefined): TimeWindow {
  if (value === "24h" || value === "7d" || value === "30d" || value === "90d") {
    return value;
  }
  return "24h";
}

function getRequestedTimeZone(value: unknown) {
  return typeof value === "string" && value.length > 0 ? value : undefined;
}

async function checkCopilotHealth(testUrl: string) {
  const start = Date.now();
  try {
    const response = await axios.get(`${testUrl}/v1/models`, {
      timeout: 5000,
      maxRedirects: 0,
      validateStatus: () => true,
    });
    const latencyMs = Date.now() - start;
    if (response.status === 200 && response.data?.data) {
      const models = (response.data.data as Array<{ id: string }>).map((m) => m.id);
      return { ok: true, latencyMs, models };
    }
    return { ok: false, latencyMs, status: response.status };
  } catch {
    return { ok: false, latencyMs: Date.now() - start };
  }
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
    createdByName: req.adminUser?.name ?? "Unknown",
    createdByEmail: req.adminUser?.email ?? "",
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
  res.json({ item: key, ...readKeyStats(id, window, getRequestedTimeZone(req.query.timezone)) });
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
  const overview = readOverview(normalizeWindow(String(req.query.window ?? "24h")), getRequestedTimeZone(req.query.timezone));
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
  return res.json(await checkCopilotHealth(testUrl));
});

// POST: accepts copilot_url in body for testing an unsaved URL
router.post("/health/copilot", async (req, res) => {
  const parsed = healthCheckSchema.safeParse(req.body ?? {});
  if (!parsed.success) {
    return res.status(400).json({ error: parsed.error.flatten() });
  }

  // Accept URL from request body (for testing with unsaved URL)
  // or fall back to cached settings (for periodic checks)
  const testUrl = parsed.data.copilot_url ?? getSettings().copilot_url;
  return res.json(await checkCopilotHealth(testUrl));
});

export default router;
