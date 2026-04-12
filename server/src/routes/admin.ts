import { Router } from "express";
import { z } from "zod";
import { v4 as uuidv4 } from "uuid";
import axios from "axios";
import { createApiKeyRecord, softDeleteApiKey, getApiKeyById, listApiKeys, updateApiKey, hashApiKey } from "../db/database.js";
import { readKeyHistory, readKeyStats, readOverview } from "../services/statsService.js";
import { getSettings, updateSettings } from "../services/settingsService.js";
import { validateCopilotUrl } from "../services/copilotUrlPolicy.js";
import { requireLocalBypassForWrite } from "../middleware/cloudflareAuth.js";
import { upsertApiKeyAuthSnapshot, invalidateApiKeyAuthSnapshotById } from "../services/apiKeyCacheService.js";
import { MAX_ALLOWED_MODELS, type TimeWindow } from "../types.js";

const router = Router();

const timeWindowSchema = z.enum(["24h", "7d", "30d", "90d"]);

const createSchema = z
  .object({
    name: z.string().min(1).max(255),
    allowed_models: z
      .array(z.string().max(255))
      .optional(),
    fallback_model: z.string().max(255).optional(),
  })
  .strict();

const updateSchema = z
  .object({
    name: z.string().min(1).max(255).optional(),
    allowed_models: z
      .array(z.string().max(255))
      .optional(),
    fallback_model: z.string().max(255).optional(),
    is_active: z.number().int().min(0).max(1).optional(),
  })
  .strict();

/** Normalize an allowed_models array: trim, remove empty, deduplicate, preserve order */
function normalizeModels(models: string[]): string[] {
  const seen = new Set<string>();
  const result: string[] = [];
  for (const m of models) {
    const trimmed = m.trim();
    if (trimmed && !seen.has(trimmed)) {
      seen.add(trimmed);
      result.push(trimmed);
    }
  }
  return result;
}

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
  auto_refresh_interval: z.enum(["15", "30", "60", "180", "300", "900", "1800", "never"]).optional(),
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

function parseStoredAllowedModels(value: string) {
  try {
    const parsed = JSON.parse(value);
    return Array.isArray(parsed) ? parsed.filter((item): item is string => typeof item === "string") : [];
  } catch {
    return [];
  }
}

function serializeApiKeyRecord<T extends { allowed_models: string }>(record: T): Omit<T, "allowed_models"> & { allowed_models: string[] } {
  return {
    ...record,
    allowed_models: parseStoredAllowedModels(record.allowed_models),
  };
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
  res.json({ items: listApiKeys(search, sortBy, sortDir).map(serializeApiKeyRecord) });
});

router.post("/keys", requireLocalBypassForWrite, (req, res) => {
  const parsed = createSchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ error: parsed.error.flatten() });
  }

  const defaultModel = getSettings().default_model;
  const allowedModels = normalizeModels(parsed.data.allowed_models ?? [defaultModel]);
  const fallbackModel = (parsed.data.fallback_model ?? defaultModel).trim();

  if (allowedModels.length === 0) {
    return res.status(400).json({ error: { message: "allowed_models must contain at least one model after normalization" } });
  }
  if (allowedModels.length > MAX_ALLOWED_MODELS) {
    return res.status(400).json({ error: { message: `allowed_models must contain at most ${MAX_ALLOWED_MODELS} models` } });
  }
  if (!allowedModels.includes(fallbackModel)) {
    return res.status(400).json({ error: { message: "fallback_model must be one of allowed_models" } });
  }

  const rawKey = `cps_${uuidv4().replaceAll("-", "")}`;
  const record = createApiKeyRecord({
    rawKey,
    name: parsed.data.name,
    allowedModels,
    fallbackModel,
    createdByName: req.adminUser?.name ?? "Unknown",
    createdByEmail: req.adminUser?.email ?? "",
  });

  if (!record) {
    return res.status(500).json({ error: { message: "Failed to create API key" } });
  }

  // Warm cache immediately
  upsertApiKeyAuthSnapshot(hashApiKey(rawKey), record);

  res.status(201).json({ item: serializeApiKeyRecord(record), rawKey });
});

router.patch("/keys/:id", requireLocalBypassForWrite, (req, res) => {
  const parsed = updateSchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ error: parsed.error.flatten() });
  }

  const id = Number(req.params.id);
  const existing = getApiKeyById(id);
  if (!existing) {
    return res.status(404).json({ error: { message: "API key not found" } });
  }

  let existingAllowedModels: string[];
  try {
    existingAllowedModels = JSON.parse(existing.allowed_models);
    if (!Array.isArray(existingAllowedModels)) existingAllowedModels = [];
  } catch {
    existingAllowedModels = [];
  }

  const newAllowedModels = parsed.data.allowed_models ? normalizeModels(parsed.data.allowed_models) : undefined;
  const newFallbackModel = parsed.data.fallback_model?.trim();

  const effectiveAllowedModels = newAllowedModels ?? existingAllowedModels;
  const effectiveFallbackModel = newFallbackModel ?? existing.fallback_model;

  if (newAllowedModels !== undefined) {
    if (effectiveAllowedModels.length === 0) {
      return res.status(400).json({ error: { message: "allowed_models must contain at least one model after normalization" } });
    }
    if (effectiveAllowedModels.length > MAX_ALLOWED_MODELS) {
      return res.status(400).json({ error: { message: `allowed_models must contain at most ${MAX_ALLOWED_MODELS} models` } });
    }
  }

  if (!effectiveAllowedModels.includes(effectiveFallbackModel)) {
    return res.status(400).json({ error: { message: "fallback_model must be one of allowed_models" } });
  }

  const updated = updateApiKey(id, {
    name: parsed.data.name,
    allowed_models: newAllowedModels,
    fallback_model: newFallbackModel,
    is_active: parsed.data.is_active,
  });
  if (!updated) {
    return res.status(404).json({ error: { message: "API key not found" } });
  }

  // Invalidate cache so next request picks up changes
  invalidateApiKeyAuthSnapshotById(id);

  res.json({ item: serializeApiKeyRecord(updated) });
});

router.delete("/keys/:id", requireLocalBypassForWrite, (req, res) => {
  const id = Number(req.params.id);
  const changes = softDeleteApiKey(id);
  if (changes === 0) {
    return res.status(404).json({ error: { message: "API key not found" } });
  }

  // Invalidate cache so the deleted key is immediately rejected
  invalidateApiKeyAuthSnapshotById(id);

  res.status(200).json({ ok: true });
});

router.get("/keys/:id/stats", (req, res) => {
  const id = Number(req.params.id);
  const key = getApiKeyById(id);
  if (!key) {
    return res.status(404).json({ error: { message: "API key not found" } });
  }

  let allowedModels: string[];
  try {
    allowedModels = JSON.parse(key.allowed_models);
    if (!Array.isArray(allowedModels)) allowedModels = [];
  } catch {
    allowedModels = [];
  }

  const window = key.is_deleted ? null : normalizeWindow(String(req.query.window ?? "24h"));
  res.json({ item: serializeApiKeyRecord(key), ...readKeyStats(id, window, getRequestedTimeZone(req.query.timezone), allowedModels) });
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
  res.json({ ...overview, keySummaries: overview.keySummaries.map(serializeApiKeyRecord), defaultModel: settings.default_model });
});

// ── Settings routes ─────────────────────────────────────────────────────────
router.get("/settings", (_req, res) => {
  res.json(getSettings());
});

router.put("/settings", requireLocalBypassForWrite, (req, res) => {
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
router.post("/health/copilot", requireLocalBypassForWrite, async (req, res) => {
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
