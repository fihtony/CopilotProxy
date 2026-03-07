import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import Database from "better-sqlite3";
import { config } from "../config.js";
import type { ApiKeyRecord, RequestLogRecord, SettingsRecord, TimeWindow } from "../types.js";

// Schema path: works from both dist/ and src/ locations
// Try multiple paths to support both production (dist/) and test (src/) execution
const schemaPaths = [
  path.join(process.cwd(), "src/db/schema.sql"), // From server/ cwd
  path.join(process.cwd(), "server/src/db/schema.sql"), // From root cwd
];
const schemaPath = schemaPaths.find((p) => fs.existsSync(p));
if (!schemaPath) {
  throw new Error(`schema.sql not found. Tried: ${schemaPaths.join(", ")}`);
}

fs.mkdirSync(path.dirname(config.databasePath), { recursive: true });

export const db = new Database(config.databasePath);
db.pragma("journal_mode = WAL");
db.exec(fs.readFileSync(schemaPath, "utf8"));

// ── Migration: add columns that did not exist in earlier schemas ────────────
function columnExists(table: string, column: string): boolean {
  const cols = db.prepare(`PRAGMA table_info(${table})`).all() as Array<{ name: string }>;
  return cols.some((c) => c.name === column);
}

if (!columnExists("requests", "proxy_time_ms")) {
  db.exec("ALTER TABLE requests ADD COLUMN proxy_time_ms INTEGER NOT NULL DEFAULT 0");
}
if (!columnExists("api_keys", "is_deleted")) {
  db.exec("ALTER TABLE api_keys ADD COLUMN is_deleted INTEGER NOT NULL DEFAULT 0");
}
if (!columnExists("requests", "ip_address")) {
  db.exec("ALTER TABLE requests ADD COLUMN ip_address TEXT");
}
if (!columnExists("requests", "host")) {
  db.exec("ALTER TABLE requests ADD COLUMN host TEXT");
}

// Seed default settings rows if not present
const seedSettings = db.prepare("INSERT OR IGNORE INTO settings (key, value, updated_at) VALUES (?, ?, ?)");
const now = new Date().toISOString();
seedSettings.run("copilot_url", config.copilotUrl, now);
seedSettings.run("default_model", "gpt-5-mini", now);

// ── Settings helpers ────────────────────────────────────────────────────────
export function getSettingsFromDb(): SettingsRecord {
  const rows = db.prepare("SELECT key, value FROM settings").all() as Array<{ key: string; value: string }>;
  const map = Object.fromEntries(rows.map((r) => [r.key, r.value]));
  return {
    copilot_url: map.copilot_url ?? config.copilotUrl,
    default_model: map.default_model ?? "gpt-5-mini",
  };
}

export function updateSettingsInDb(patch: Partial<SettingsRecord>) {
  const ts = new Date().toISOString();
  const upsert = db.prepare(
    "INSERT INTO settings (key, value, updated_at) VALUES (?, ?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at",
  );
  if (patch.copilot_url !== undefined) upsert.run("copilot_url", patch.copilot_url, ts);
  if (patch.default_model !== undefined) upsert.run("default_model", patch.default_model, ts);
}

// ── API Key helpers ─────────────────────────────────────────────────────────
export function hashApiKey(apiKey: string) {
  return crypto.createHash("sha256").update(apiKey).digest("hex");
}

export function previewApiKey(apiKey: string) {
  return `${apiKey.slice(0, 8)}...${apiKey.slice(-4)}`;
}

export function createApiKeyRecord(input: { rawKey: string; name: string; model: string }) {
  const ts = new Date().toISOString();
  const statement = db.prepare(`
    INSERT INTO api_keys (key_hash, key_preview, name, model, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?)
  `);

  const result = statement.run(hashApiKey(input.rawKey), previewApiKey(input.rawKey), input.name, input.model, ts, ts);
  return getApiKeyById(Number(result.lastInsertRowid));
}

export function getApiKeyByHash(hash: string) {
  return db.prepare("SELECT * FROM api_keys WHERE key_hash = ? AND is_active = 1 AND is_deleted = 0").get(hash) as ApiKeyRecord | undefined;
}

export function getApiKeyById(id: number) {
  return db
    .prepare(
      `SELECT api_keys.*, MAX(requests.timestamp) AS last_used_at
       FROM api_keys
       LEFT JOIN requests ON requests.api_key_id = api_keys.id
       WHERE api_keys.id = ?
       GROUP BY api_keys.id`,
    )
    .get(id) as (ApiKeyRecord & { last_used_at: string | null }) | undefined;
}

export function listApiKeys(search?: string, sortBy?: string, sortDir?: string) {
  const allowedSort: Record<string, string> = {
    name: "api_keys.name",
    created_at: "api_keys.created_at",
    calls: "totalCalls",
    success_rate: "successRate",
    latency: "avgResponseTime",
    last_used_at: "last_used_at",
  };
  const orderCol = allowedSort[sortBy ?? ""] ?? "totalCalls";
  const orderDir = sortDir === "asc" ? "ASC" : "DESC";

  let sql = `
    SELECT api_keys.*,
      COUNT(requests.id) AS totalCalls,
      ROUND(COALESCE(AVG(requests.success), 0) * 100, 2) AS successRate,
      ROUND(COALESCE(AVG(requests.response_time_ms), 0), 2) AS avgResponseTime,
      MAX(requests.timestamp) AS last_used_at
    FROM api_keys
    LEFT JOIN requests ON requests.api_key_id = api_keys.id
  `;
  const params: string[] = [];
  if (search) {
    sql += " WHERE (api_keys.name LIKE ? OR api_keys.key_preview LIKE ?)";
    params.push(`%${search}%`, `%${search}%`);
  }
  // For datetime columns, explicitly cast to ensure proper sorting
  let orderClause = orderCol;
  if (["api_keys.created_at", "last_used_at"].includes(orderCol)) {
    orderClause = `COALESCE(${orderCol}, '1900-01-01') ${orderDir}`;
    sql += ` GROUP BY api_keys.id ORDER BY ${orderClause}, api_keys.created_at DESC`;
  } else {
    sql += ` GROUP BY api_keys.id ORDER BY ${orderCol} ${orderDir}, api_keys.created_at DESC`;
  }

  return db.prepare(sql).all(...params) as (ApiKeyRecord & {
    totalCalls: number;
    successRate: number;
    avgResponseTime: number;
    last_used_at: string | null;
  })[];
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

export function softDeleteApiKey(id: number) {
  const current = getApiKeyById(id);
  if (!current) return 0;
  db.prepare("UPDATE api_keys SET is_deleted = 1, is_active = 0, updated_at = ? WHERE id = ?").run(new Date().toISOString(), id);
  return 1;
}

export function insertRequestLog(record: RequestLogRecord) {
  db.prepare(
    `
    INSERT INTO requests (
      api_key_id, timestamp, method, path, status_code, success, response_time_ms, proxy_time_ms,
      prompt_tokens, completion_tokens, total_tokens,
      model_requested, model_used, error_message, ip_address, host
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `,
  ).run(
    record.apiKeyId,
    new Date().toISOString(),
    record.method,
    record.path,
    record.statusCode,
    record.success,
    record.responseTimeMs,
    record.proxyTimeMs,
    record.promptTokens,
    record.completionTokens,
    record.totalTokens,
    record.modelRequested,
    record.modelUsed,
    record.errorMessage,
    record.ipAddress ?? null,
    record.host ?? null,
  );
}

// ── Percentile helpers (computed JS-side) ───────────────────────────────────
function percentile(sorted: number[], p: number): number {
  if (sorted.length === 0) return 0;
  const idx = Math.ceil((p / 100) * sorted.length) - 1;
  return sorted[Math.max(0, idx)];
}

function toWindowStart(window: TimeWindow) {
  const ms = Date.now();
  const offsets: Record<TimeWindow, number> = {
    "24h": 24 * 60 * 60 * 1000,
    "7d": 7 * 24 * 60 * 60 * 1000,
    "30d": 30 * 24 * 60 * 60 * 1000,
    "90d": 90 * 24 * 60 * 60 * 1000,
  };
  return new Date(ms - offsets[window]).toISOString();
}

function bucketExpression(window: TimeWindow) {
  if (window === "24h") return "strftime('%Y-%m-%d %H:00:00', timestamp)";
  return "strftime('%Y-%m-%d', timestamp)";
}

function computePercentiles(windowStart: string, keyFilter?: number) {
  let where = "timestamp >= ?";
  const params: (string | number)[] = [windowStart];
  if (keyFilter !== undefined) {
    where += " AND api_key_id = ?";
    params.push(keyFilter);
  }

  const proxyTimes = (
    db.prepare(`SELECT proxy_time_ms AS v FROM requests WHERE ${where} ORDER BY proxy_time_ms`).all(...params) as { v: number }[]
  ).map((r) => r.v);
  const responseTimes = (
    db.prepare(`SELECT response_time_ms AS v FROM requests WHERE ${where} ORDER BY response_time_ms`).all(...params) as { v: number }[]
  ).map((r) => r.v);
  const tokens = (
    db.prepare(`SELECT COALESCE(total_tokens, 0) AS v FROM requests WHERE ${where} ORDER BY v`).all(...params) as { v: number }[]
  ).map((r) => r.v);

  return {
    p90ProxyTime: percentile(proxyTimes, 90),
    p95ProxyTime: percentile(proxyTimes, 95),
    p99ProxyTime: percentile(proxyTimes, 99),
    p90ResponseTime: percentile(responseTimes, 90),
    p95ResponseTime: percentile(responseTimes, 95),
    p99ResponseTime: percentile(responseTimes, 99),
    p90Tokens: percentile(tokens, 90),
    p95Tokens: percentile(tokens, 95),
    p99Tokens: percentile(tokens, 99),
  };
}

// ── Stats queries ───────────────────────────────────────────────────────────
export function getOverview(window: TimeWindow) {
  const windowStart = toWindowStart(window);
  const bucket = bucketExpression(window);

  const summary = db
    .prepare(
      `
    SELECT
      COUNT(*) AS totalCalls,
      ROUND(COALESCE(AVG(success), 0) * 100, 2) AS successRate,
      ROUND(COALESCE(AVG(proxy_time_ms), 0), 2) AS avgProxyTime,
      ROUND(COALESCE(AVG(response_time_ms), 0), 2) AS avgResponseTime,
      COUNT(DISTINCT api_key_id) AS activeKeys,
      ROUND(COALESCE(AVG(COALESCE(total_tokens, 0)), 0), 2) AS avgTokensPerRequest
    FROM requests
    WHERE timestamp >= ?
  `,
    )
    .get(windowStart) as Record<string, number>;

  const pValues = computePercentiles(windowStart);

  const keySummaries = db
    .prepare(
      `
    SELECT
      api_keys.id,
      api_keys.name,
      api_keys.model,
      api_keys.key_preview AS keyPreview,
      api_keys.is_deleted AS isDeleted,
      api_keys.created_at AS createdAt,
      COUNT(requests.id) AS totalCalls,
      ROUND(COALESCE(AVG(requests.success), 0) * 100, 2) AS successRate,
      ROUND(COALESCE(AVG(requests.proxy_time_ms), 0), 2) AS avgProxyTime,
      ROUND(COALESCE(AVG(requests.response_time_ms), 0), 2) AS avgResponseTime
    FROM api_keys
    LEFT JOIN requests ON requests.api_key_id = api_keys.id AND requests.timestamp >= ?
    GROUP BY api_keys.id
    ORDER BY totalCalls DESC, api_keys.created_at DESC
  `,
    )
    .all(windowStart);

  const timeline = db
    .prepare(
      `
    SELECT
      ${bucket} AS bucket,
      COUNT(*) AS calls,
      ROUND(COALESCE(AVG(proxy_time_ms), 0), 2) AS avgProxyTime,
      ROUND(COALESCE(AVG(response_time_ms), 0), 2) AS avgResponseTime,
      ROUND(COALESCE(AVG(success), 0) * 100, 2) AS successRate
    FROM requests
    WHERE timestamp >= ?
    GROUP BY bucket
    ORDER BY bucket ASC
  `,
    )
    .all(windowStart);

  return { summary: { ...summary, ...pValues }, keySummaries, timeline };
}

export function getKeyStats(id: number, window: TimeWindow | null) {
  const useAllTime = window === null;
  const windowStart = useAllTime ? "1970-01-01T00:00:00.000Z" : toWindowStart(window);
  const bucket = useAllTime ? "strftime('%Y-%m-%d', timestamp)" : bucketExpression(window);

  const stats = db
    .prepare(
      `
    SELECT
      COUNT(*) AS totalCalls,
      ROUND(COALESCE(AVG(success), 0) * 100, 2) AS successRate,
      ROUND(COALESCE(AVG(proxy_time_ms), 0), 2) AS avgProxyTime,
      ROUND(COALESCE(AVG(response_time_ms), 0), 2) AS avgResponseTime,
      ROUND(COALESCE(AVG(COALESCE(total_tokens, 0)), 0), 2) AS avgTokensPerRequest,
      COALESCE(SUM(prompt_tokens), 0) AS promptTokens,
      COALESCE(SUM(completion_tokens), 0) AS completionTokens,
      COALESCE(SUM(total_tokens), 0) AS totalTokens
    FROM requests
    WHERE api_key_id = ? AND timestamp >= ?
  `,
    )
    .get(id, windowStart) as Record<string, number>;

  const pValues = computePercentiles(windowStart, id);

  const timeline = db
    .prepare(
      `
    SELECT
      ${bucket} AS bucket,
      COUNT(*) AS calls,
      ROUND(COALESCE(AVG(proxy_time_ms), 0), 2) AS avgProxyTime,
      ROUND(COALESCE(AVG(response_time_ms), 0), 2) AS avgResponseTime,
      ROUND(COALESCE(AVG(success), 0) * 100, 2) AS successRate
    FROM requests
    WHERE api_key_id = ? AND timestamp >= ?
    GROUP BY bucket
    ORDER BY bucket ASC
  `,
    )
    .all(id, windowStart);

  const recentErrors = db
    .prepare(
      `
    SELECT id, timestamp, path, status_code, error_message
    FROM requests
    WHERE api_key_id = ? AND success = 0 AND timestamp >= ?
    ORDER BY timestamp DESC
    LIMIT 20
  `,
    )
    .all(id, windowStart);

  const callsByIpAndHost = db
    .prepare(
      `
    SELECT
      COALESCE(ip_address, 'Unknown') AS ip_address,
      COALESCE(host, 'Unknown') AS host,
      COUNT(*) AS calls
    FROM requests
    WHERE api_key_id = ? AND timestamp >= ?
    GROUP BY ip_address, host
    ORDER BY calls DESC
  `,
    )
    .all(id, windowStart) as Array<{ ip_address: string; host: string; calls: number }>;

  return { stats: { ...stats, ...pValues }, timeline, recentErrors, callsByIpAndHost };
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
