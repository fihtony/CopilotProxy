import { Router } from "express";
import { z } from "zod";
import { v4 as uuidv4 } from "uuid";
import { createApiKeyRecord, deleteApiKey, getApiKeyById, listApiKeys, updateApiKey } from "../db/database.js";
import { readKeyHistory, readKeyStats, readOverview } from "../services/statsService.js";
import type { TimeWindow } from "../types.js";

const router = Router();

const createSchema = z.object({
  name: z.string().min(1),
  model: z.string().min(1).default("gpt-5-mini"),
});

const updateSchema = z.object({
  name: z.string().min(1).optional(),
  model: z.string().min(1).optional(),
  is_active: z.number().int().min(0).max(1).optional(),
});

function normalizeWindow(value: string | undefined): TimeWindow {
  if (value === "1h" || value === "24h" || value === "7d" || value === "30d") {
    return value;
  }
  return "24h";
}

router.get("/keys", (_req, res) => {
  res.json({ items: listApiKeys() });
});

router.post("/keys", (req, res) => {
  const parsed = createSchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ error: parsed.error.flatten() });
  }

  const rawKey = `cps_${uuidv4().replaceAll("-", "")}`;
  const record = createApiKeyRecord({
    rawKey,
    name: parsed.data.name,
    model: parsed.data.model,
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
  const result = deleteApiKey(Number(req.params.id));
  if (result.changes === 0) {
    return res.status(404).json({ error: { message: "API key not found" } });
  }

  res.status(204).send();
});

router.get("/keys/:id/stats", (req, res) => {
  const id = Number(req.params.id);
  const key = getApiKeyById(id);
  if (!key) {
    return res.status(404).json({ error: { message: "API key not found" } });
  }

  res.json({ item: key, ...readKeyStats(id, normalizeWindow(String(req.query.window ?? "24h"))) });
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
  res.json(readOverview(normalizeWindow(String(req.query.window ?? "24h"))));
});

export default router;
