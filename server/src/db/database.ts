import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import Database from "better-sqlite3";
import { config } from "../config.js";
import type { ApiKeyRecord, RequestLogRecord, TimeWindow } from "../types.js";

const schemaPath = path.resolve(process.cwd(), "src", "db", "schema.sql");

fs.mkdirSync(path.dirname(config.databasePath), { recursive: true });

export const db = new Database(config.databasePath);
db.pragma("journal_mode = WAL");
db.exec(fs.readFileSync(schemaPath, "utf8"));

export function hashApiKey(apiKey: string) {
  return crypto.createHash("sha256").update(apiKey).digest("hex");
}

export function previewApiKey(apiKey: string) {
  return `${apiKey.slice(0, 8)}...${apiKey.slice(-4)}`;
}

export function createApiKeyRecord(input: { rawKey: string; name: string; model: string }) {
  const now = new Date().toISOString();
  const statement = db.prepare(`
    INSERT INTO api_keys (key_hash, key_preview, name, model, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?)
  `);

  const result = statement.run(hashApiKey(input.rawKey), previewApiKey(input.rawKey), input.name, input.model, now, now);
  return getApiKeyById(Number(result.lastInsertRowid));
}

export function getApiKeyByHash(hash: string) {
  return db.prepare("SELECT * FROM api_keys WHERE key_hash = ? AND is_active = 1").get(hash) as ApiKeyRecord | undefined;
}

export function getApiKeyById(id: number) {
  return db.prepare("SELECT * FROM api_keys WHERE id = ?").get(id) as ApiKeyRecord | undefined;
}

export function listApiKeys() {
  return db.prepare("SELECT * FROM api_keys ORDER BY created_at DESC").all() as ApiKeyRecord[];
}

export function updateApiKey(id: number, payload: { name?: string; model?: string; is_active?: number }) {
  const current = getApiKeyById(id);
  if (!current) {
    return undefined;
  }

  db.prepare(
    `
    UPDATE api_keys
    SET name = ?, model = ?, is_active = ?, updated_at = ?
    WHERE id = ?
  `,
  ).run(payload.name ?? current.name, payload.model ?? current.model, payload.is_active ?? current.is_active, new Date().toISOString(), id);

  return getApiKeyById(id);
}

export function deleteApiKey(id: number) {
  return db.prepare("DELETE FROM api_keys WHERE id = ?").run(id);
}

export function insertRequestLog(record: RequestLogRecord) {
  db.prepare(
    `
    INSERT INTO requests (
      api_key_id, timestamp, method, path, status_code, success, response_time_ms,
      prompt_tokens, completion_tokens, total_tokens,
      model_requested, model_used, error_message
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `,
  ).run(
    record.apiKeyId,
    new Date().toISOString(), // ISO 8601 with UTC offset (e.g. "2024-01-01T12:00:00.000Z")
    record.method,
    record.path,
    record.statusCode,
    record.success,
    record.responseTimeMs,
    record.promptTokens,
    record.completionTokens,
    record.totalTokens,
    record.modelRequested,
    record.modelUsed,
    record.errorMessage,
  );
}

function toWindowStart(window: TimeWindow) {
  const now = Date.now();
  const offsets: Record<TimeWindow, number> = {
    "1h": 60 * 60 * 1000,
    "24h": 24 * 60 * 60 * 1000,
    "7d": 7 * 24 * 60 * 60 * 1000,
    "30d": 30 * 24 * 60 * 60 * 1000,
  };
  return new Date(now - offsets[window]).toISOString();
}

export function getOverview(window: TimeWindow) {
  const windowStart = toWindowStart(window);
  const summary = db
    .prepare(
      `
    SELECT
      COUNT(*) AS totalCalls,
      ROUND(COALESCE(AVG(success), 0) * 100, 2) AS successRate,
      ROUND(COALESCE(AVG(response_time_ms), 0), 2) AS avgResponseTime,
      COUNT(DISTINCT api_key_id) AS activeKeys,
      COALESCE(SUM(total_tokens), 0) AS totalTokens
    FROM requests
    WHERE timestamp >= ?
  `,
    )
    .get(windowStart) as Record<string, number>;

  const keySummaries = db
    .prepare(
      `
    SELECT
      api_keys.id,
      api_keys.name,
      api_keys.model,
      api_keys.key_preview AS keyPreview,
      COUNT(requests.id) AS totalCalls,
      ROUND(COALESCE(AVG(requests.success), 0) * 100, 2) AS successRate,
      ROUND(COALESCE(AVG(requests.response_time_ms), 0), 2) AS avgResponseTime,
      COALESCE(SUM(requests.total_tokens), 0) AS totalTokens
    FROM api_keys
    LEFT JOIN requests ON requests.api_key_id = api_keys.id AND requests.timestamp >= ?
    GROUP BY api_keys.id
    ORDER BY totalCalls DESC, api_keys.created_at DESC
  `,
    )
    .all(windowStart);

  return { summary, keySummaries };
}

export function getKeyStats(id: number, window: TimeWindow) {
  const windowStart = toWindowStart(window);
  const stats = db
    .prepare(
      `
    SELECT
      COUNT(*) AS totalCalls,
      ROUND(COALESCE(AVG(success), 0) * 100, 2) AS successRate,
      ROUND(COALESCE(AVG(response_time_ms), 0), 2) AS avgResponseTime,
      COALESCE(SUM(prompt_tokens), 0) AS promptTokens,
      COALESCE(SUM(completion_tokens), 0) AS completionTokens,
      COALESCE(SUM(total_tokens), 0) AS totalTokens
    FROM requests
    WHERE api_key_id = ? AND timestamp >= ?
  `,
    )
    .get(id, windowStart) as Record<string, number>;

  const timeline = db
    .prepare(
      `
    SELECT
      strftime('%Y-%m-%d %H:00:00', timestamp) AS bucket,
      COUNT(*) AS calls,
      ROUND(COALESCE(AVG(response_time_ms), 0), 2) AS avgResponseTime,
      ROUND(COALESCE(AVG(success), 0) * 100, 2) AS successRate
    FROM requests
    WHERE api_key_id = ? AND timestamp >= ?
    GROUP BY bucket
    ORDER BY bucket ASC
  `,
    )
    .all(id, windowStart);

  return { stats, timeline };
}

export function getKeyHistory(id: number, page: number, limit: number) {
  const offset = (page - 1) * limit;
  const items = db
    .prepare(
      `
    SELECT *
    FROM requests
    WHERE api_key_id = ?
    ORDER BY timestamp DESC
    LIMIT ? OFFSET ?
  `,
    )
    .all(id, limit, offset);

  const total = db.prepare("SELECT COUNT(*) AS count FROM requests WHERE api_key_id = ?").get(id) as { count: number };
  return { items, total: total.count };
}
