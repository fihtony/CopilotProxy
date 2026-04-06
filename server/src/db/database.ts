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
if (!columnExists("api_keys", "created_by_name")) {
  db.exec("ALTER TABLE api_keys ADD COLUMN created_by_name TEXT NOT NULL DEFAULT 'Unknown'");
}
if (!columnExists("api_keys", "created_by_email")) {
  db.exec("ALTER TABLE api_keys ADD COLUMN created_by_email TEXT NOT NULL DEFAULT ''");
}

// Seed default settings rows if not present
const seedSettings = db.prepare("INSERT OR IGNORE INTO settings (key, value, updated_at) VALUES (?, ?, ?)");
const now = new Date().toISOString();
seedSettings.run("copilot_url", config.copilotUrl, now);
seedSettings.run("default_model", "gpt-5-mini", now);
seedSettings.run("dashboard_time_window", "24h", now);
seedSettings.run("key_detail_time_window", "24h", now);

// ── Settings helpers ────────────────────────────────────────────────────────
export function getSettingsFromDb(): SettingsRecord {
  const rows = db.prepare("SELECT key, value FROM settings").all() as Array<{ key: string; value: string }>;
  const map = Object.fromEntries(rows.map((r) => [r.key, r.value]));
  return {
    copilot_url: map.copilot_url ?? config.copilotUrl,
    default_model: map.default_model ?? "gpt-5-mini",
    dashboard_time_window: (map.dashboard_time_window as TimeWindow | undefined) ?? "24h",
    key_detail_time_window: (map.key_detail_time_window as TimeWindow | undefined) ?? "24h",
  };
}

export function updateSettingsInDb(patch: Partial<SettingsRecord>) {
  const ts = new Date().toISOString();
  const upsert = db.prepare(
    "INSERT INTO settings (key, value, updated_at) VALUES (?, ?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at",
  );
  if (patch.copilot_url !== undefined) upsert.run("copilot_url", patch.copilot_url, ts);
  if (patch.default_model !== undefined) upsert.run("default_model", patch.default_model, ts);
  if (patch.dashboard_time_window !== undefined) upsert.run("dashboard_time_window", patch.dashboard_time_window, ts);
  if (patch.key_detail_time_window !== undefined) upsert.run("key_detail_time_window", patch.key_detail_time_window, ts);
}

// ── API Key helpers ─────────────────────────────────────────────────────────
export function hashApiKey(apiKey: string) {
  return crypto.createHash("sha256").update(apiKey).digest("hex");
}

export function previewApiKey(apiKey: string) {
  return `${apiKey.slice(0, 8)}...${apiKey.slice(-4)}`;
}

export function createApiKeyRecord(input: { rawKey: string; name: string; model: string; createdByName: string; createdByEmail: string }) {
  const ts = new Date().toISOString();
  const statement = db.prepare(`
    INSERT INTO api_keys (key_hash, key_preview, name, model, created_by_name, created_by_email, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)
  `);

  const result = statement.run(
    hashApiKey(input.rawKey),
    previewApiKey(input.rawKey),
    input.name,
    input.model,
    input.createdByName,
    input.createdByEmail,
    ts,
    ts,
  );
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

// ── Stats helpers ───────────────────────────────────────────────────────────
interface StatsRequestRow {
  id: number;
  api_key_id: number;
  timestamp: string;
  path: string;
  status_code: number;
  success: number;
  response_time_ms: number;
  proxy_time_ms: number;
  prompt_tokens: number | null;
  completion_tokens: number | null;
  total_tokens: number | null;
  error_message: string | null;
  ip_address: string | null;
  host: string | null;
}

interface LocalDate {
  year: number;
  month: number;
  day: number;
}

interface LocalDateTime extends LocalDate {
  hour: number;
  minute: number;
  second: number;
}

interface WindowSeries {
  expectedBuckets: string[];
  bucketForTimestamp: (timestamp: string) => string | null;
  coarseStart: string;
}

interface SummaryAccumulator {
  calls: number;
  successCalls: number;
  proxyTimeSum: number;
  responseTimeSum: number;
  promptTokens: number;
  completionTokens: number;
  totalTokens: number;
}

interface TimelineAccumulator {
  calls: number;
  successCalls: number;
  proxyTimeSum: number;
  responseTimeSum: number;
}

const HOUR_MS = 60 * 60 * 1000;
const formatterCache = new Map<string, Intl.DateTimeFormat>();

function pad2(value: number) {
  return String(value).padStart(2, "0");
}

function round2(value: number) {
  return Math.round(value * 100) / 100;
}

function percentile(sorted: number[], p: number): number {
  if (sorted.length === 0) return 0;
  const idx = Math.ceil((p / 100) * sorted.length) - 1;
  return sorted[Math.max(0, idx)];
}

function getFormatter(timeZone: string) {
  let formatter = formatterCache.get(timeZone);
  if (!formatter) {
    formatter = new Intl.DateTimeFormat("en-CA", {
      timeZone,
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
      hourCycle: "h23",
    });
    formatterCache.set(timeZone, formatter);
  }
  return formatter;
}

function normalizeTimeZone(timeZone?: string) {
  if (timeZone) {
    try {
      Intl.DateTimeFormat("en-US", { timeZone }).format(new Date());
      return timeZone;
    } catch {
      // fall through to default
    }
  }
  return Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC";
}

function toLocalDateKey(parts: LocalDate) {
  return `${parts.year}-${pad2(parts.month)}-${pad2(parts.day)}`;
}

function parseLocalDateKey(value: string): LocalDate {
  const [year, month, day] = value.split("-").map(Number);
  return { year, month, day };
}

function localDateValue(parts: LocalDate) {
  return Date.UTC(parts.year, parts.month - 1, parts.day);
}

function addLocalDays(parts: LocalDate, days: number): LocalDate {
  const date = new Date(Date.UTC(parts.year, parts.month - 1, parts.day));
  date.setUTCDate(date.getUTCDate() + days);
  return {
    year: date.getUTCFullYear(),
    month: date.getUTCMonth() + 1,
    day: date.getUTCDate(),
  };
}

function getLocalDateTime(date: Date, timeZone: string): LocalDateTime {
  const parts = getFormatter(timeZone).formatToParts(date);
  const values = Object.fromEntries(parts.map((part) => [part.type, part.value]));
  return {
    year: Number(values.year),
    month: Number(values.month),
    day: Number(values.day),
    hour: Number(values.hour),
    minute: Number(values.minute),
    second: Number(values.second),
  };
}

function getTimeZoneOffsetMs(date: Date, timeZone: string) {
  const parts = getLocalDateTime(date, timeZone);
  return Date.UTC(parts.year, parts.month - 1, parts.day, parts.hour, parts.minute, parts.second) - date.getTime();
}

function localDateTimeToUtc(parts: LocalDateTime, timeZone: string) {
  const utcGuess = new Date(Date.UTC(parts.year, parts.month - 1, parts.day, parts.hour, parts.minute, parts.second));
  const initialOffset = getTimeZoneOffsetMs(utcGuess, timeZone);
  const candidate = new Date(utcGuess.getTime() - initialOffset);
  const candidateOffset = getTimeZoneOffsetMs(candidate, timeZone);
  if (candidateOffset !== initialOffset) {
    return new Date(utcGuess.getTime() - candidateOffset);
  }
  return candidate;
}

function toHourBucketKey(date: Date, timeZone: string) {
  const parts = getLocalDateTime(date, timeZone);
  return `${toLocalDateKey(parts)} ${pad2(parts.hour)}:00:00`;
}

function toFourHourBucketKey(date: Date, timeZone: string) {
  const parts = getLocalDateTime(date, timeZone);
  const hour = Math.floor(parts.hour / 4) * 4;
  return `${toLocalDateKey(parts)} ${pad2(hour)}:00:00`;
}

function getTodayInTimeZone(timeZone: string, now: Date) {
  const parts = getLocalDateTime(now, timeZone);
  return { year: parts.year, month: parts.month, day: parts.day };
}

function buildWindowSeries(window: TimeWindow, timeZone: string, now = new Date()): WindowSeries {
  const expectedBuckets: string[] = [];

  if (window === "24h") {
    const currentLocal = getLocalDateTime(now, timeZone);
    const currentHourUtc = localDateTimeToUtc({ ...currentLocal, minute: 0, second: 0 }, timeZone);
    const earliestHourUtc = new Date(currentHourUtc.getTime() - 23 * HOUR_MS);
    for (let i = 0; i < 24; i++) {
      expectedBuckets.push(toHourBucketKey(new Date(earliestHourUtc.getTime() + i * HOUR_MS), timeZone));
    }
    const expectedSet = new Set(expectedBuckets);
    return {
      expectedBuckets,
      coarseStart: earliestHourUtc.toISOString(),
      bucketForTimestamp: (timestamp) => {
        const bucket = toHourBucketKey(new Date(timestamp), timeZone);
        return expectedSet.has(bucket) ? bucket : null;
      },
    };
  }

  const today = getTodayInTimeZone(timeZone, now);
  if (window === "7d") {
    const startDay = addLocalDays(today, -6);
    for (let day = 0; day < 7; day++) {
      const currentDay = addLocalDays(startDay, day);
      for (let hour = 0; hour < 24; hour += 4) {
        expectedBuckets.push(`${toLocalDateKey(currentDay)} ${pad2(hour)}:00:00`);
      }
    }
    const expectedSet = new Set(expectedBuckets);
    return {
      expectedBuckets,
      coarseStart: localDateTimeToUtc({ ...startDay, hour: 0, minute: 0, second: 0 }, timeZone).toISOString(),
      bucketForTimestamp: (timestamp) => {
        const bucket = toFourHourBucketKey(new Date(timestamp), timeZone);
        return expectedSet.has(bucket) ? bucket : null;
      },
    };
  }

  if (window === "30d") {
    const startDay = addLocalDays(today, -29);
    for (let day = 0; day < 30; day++) {
      expectedBuckets.push(toLocalDateKey(addLocalDays(startDay, day)));
    }
    const expectedSet = new Set(expectedBuckets);
    return {
      expectedBuckets,
      coarseStart: localDateTimeToUtc({ ...startDay, hour: 0, minute: 0, second: 0 }, timeZone).toISOString(),
      bucketForTimestamp: (timestamp) => {
        const bucket = toLocalDateKey(getLocalDateTime(new Date(timestamp), timeZone));
        return expectedSet.has(bucket) ? bucket : null;
      },
    };
  }

  const startDay = addLocalDays(today, -89);
  const dateToBucket = new Map<string, string>();
  for (let index = 0; index < 90; index++) {
    const day = addLocalDays(startDay, index);
    const dayKey = toLocalDateKey(day);
    const bucketKey = toLocalDateKey(addLocalDays(startDay, Math.floor(index / 3) * 3));
    dateToBucket.set(dayKey, bucketKey);
    if (index % 3 === 0) {
      expectedBuckets.push(bucketKey);
    }
  }

  return {
    expectedBuckets,
    coarseStart: localDateTimeToUtc({ ...startDay, hour: 0, minute: 0, second: 0 }, timeZone).toISOString(),
    bucketForTimestamp: (timestamp) => dateToBucket.get(toLocalDateKey(getLocalDateTime(new Date(timestamp), timeZone))) ?? null,
  };
}

function buildAllTimeSeries(rows: StatsRequestRow[], timeZone: string): WindowSeries {
  if (rows.length === 0) {
    return {
      expectedBuckets: [],
      coarseStart: "1970-01-01T00:00:00.000Z",
      bucketForTimestamp: () => null,
    };
  }

  const earliest = rows.reduce((min, row) => (row.timestamp < min.timestamp ? row : min), rows[0]);
  const startDay = parseLocalDateKey(toLocalDateKey(getLocalDateTime(new Date(earliest.timestamp), timeZone)));
  const today = getTodayInTimeZone(timeZone, new Date());
  const expectedBuckets: string[] = [];
  for (let cursor = startDay; localDateValue(cursor) <= localDateValue(today); cursor = addLocalDays(cursor, 1)) {
    expectedBuckets.push(toLocalDateKey(cursor));
  }
  const expectedSet = new Set(expectedBuckets);
  return {
    expectedBuckets,
    coarseStart: earliest.timestamp,
    bucketForTimestamp: (timestamp) => {
      const bucket = toLocalDateKey(getLocalDateTime(new Date(timestamp), timeZone));
      return expectedSet.has(bucket) ? bucket : null;
    },
  };
}

function createSummaryAccumulator(): SummaryAccumulator {
  return {
    calls: 0,
    successCalls: 0,
    proxyTimeSum: 0,
    responseTimeSum: 0,
    promptTokens: 0,
    completionTokens: 0,
    totalTokens: 0,
  };
}

function addRowToSummary(accumulator: SummaryAccumulator, row: StatsRequestRow) {
  accumulator.calls += 1;
  if (row.success === 1) {
    accumulator.successCalls += 1;
    accumulator.proxyTimeSum += row.proxy_time_ms;
    accumulator.responseTimeSum += row.response_time_ms;
  }
  accumulator.promptTokens += row.prompt_tokens ?? 0;
  accumulator.completionTokens += row.completion_tokens ?? 0;
  accumulator.totalTokens += row.total_tokens ?? 0;
}

function finalizeSummary(accumulator: SummaryAccumulator) {
  return {
    totalCalls: accumulator.calls,
    successRate: accumulator.calls === 0 ? 0 : round2((accumulator.successCalls / accumulator.calls) * 100),
    avgProxyTime: accumulator.successCalls === 0 ? 0 : round2(accumulator.proxyTimeSum / accumulator.successCalls),
    avgResponseTime: accumulator.successCalls === 0 ? 0 : round2(accumulator.responseTimeSum / accumulator.successCalls),
    avgTokensPerRequest: accumulator.calls === 0 ? 0 : round2(accumulator.totalTokens / accumulator.calls),
    promptTokens: accumulator.promptTokens,
    completionTokens: accumulator.completionTokens,
    totalTokens: accumulator.totalTokens,
  };
}

function computePercentilesFromRows(rows: StatsRequestRow[]) {
  const successfulRows = rows.filter((row) => row.success === 1);
  const proxyTimes = successfulRows.map((row) => row.proxy_time_ms).sort((a, b) => a - b);
  const responseTimes = successfulRows.map((row) => row.response_time_ms).sort((a, b) => a - b);
  const tokens = rows.map((row) => row.total_tokens ?? 0).sort((a, b) => a - b);

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

function buildTimeline(rows: StatsRequestRow[], series: WindowSeries) {
  const timelineMap = new Map<string, TimelineAccumulator>(
    series.expectedBuckets.map((bucket) => [bucket, { calls: 0, successCalls: 0, proxyTimeSum: 0, responseTimeSum: 0 }]),
  );
  const filteredRows: StatsRequestRow[] = [];

  for (const row of rows) {
    const bucket = series.bucketForTimestamp(row.timestamp);
    if (!bucket) {
      continue;
    }

    filteredRows.push(row);
    const accumulator = timelineMap.get(bucket);
    if (!accumulator) {
      continue;
    }

    accumulator.calls += 1;
    if (row.success === 1) {
      accumulator.successCalls += 1;
      accumulator.proxyTimeSum += row.proxy_time_ms;
      accumulator.responseTimeSum += row.response_time_ms;
    }
  }

  const timeline = series.expectedBuckets.map((bucket) => {
    const accumulator = timelineMap.get(bucket)!;
    return {
      bucket,
      calls: accumulator.calls,
      avgProxyTime: accumulator.successCalls === 0 ? 0 : round2(accumulator.proxyTimeSum / accumulator.successCalls),
      avgResponseTime: accumulator.successCalls === 0 ? 0 : round2(accumulator.responseTimeSum / accumulator.successCalls),
      successRate: accumulator.calls === 0 ? 0 : round2((accumulator.successCalls / accumulator.calls) * 100),
    };
  });

  return { filteredRows, timeline };
}

function getOverviewRows(windowStart: string) {
  return db
    .prepare(
      `
    SELECT
      requests.id,
      requests.api_key_id,
      requests.timestamp,
      requests.path,
      requests.status_code,
      requests.success,
      requests.response_time_ms,
      requests.proxy_time_ms,
      requests.prompt_tokens,
      requests.completion_tokens,
      requests.total_tokens,
      requests.error_message,
      requests.ip_address,
      requests.host
    FROM requests
    WHERE requests.timestamp >= ?
    ORDER BY requests.timestamp ASC
  `,
    )
    .all(windowStart) as StatsRequestRow[];
}

function getKeyRequestRows(id: number, windowStart: string) {
  return db
    .prepare(
      `
    SELECT
      id,
      api_key_id,
      timestamp,
      path,
      status_code,
      success,
      response_time_ms,
      proxy_time_ms,
      prompt_tokens,
      completion_tokens,
      total_tokens,
      error_message,
      ip_address,
      host
    FROM requests
    WHERE api_key_id = ? AND timestamp >= ?
    ORDER BY timestamp ASC
  `,
    )
    .all(id, windowStart) as StatsRequestRow[];
}

function buildCallsByIpAndHost(rows: StatsRequestRow[]) {
  const map = new Map<string, { ip_address: string; host: string; calls: number }>();
  for (const row of rows) {
    const ip_address = row.ip_address ?? "Unknown";
    const host = row.host ?? "Unknown";
    const key = `${ip_address}\u0000${host}`;
    const current = map.get(key);
    if (current) {
      current.calls += 1;
    } else {
      map.set(key, { ip_address, host, calls: 1 });
    }
  }
  return [...map.values()].sort((left, right) => right.calls - left.calls || left.host.localeCompare(right.host));
}

// ── Stats queries ───────────────────────────────────────────────────────────
export function getOverview(window: TimeWindow, timeZone?: string) {
  const resolvedTimeZone = normalizeTimeZone(timeZone);
  const series = buildWindowSeries(window, resolvedTimeZone);
  const rows = getOverviewRows(series.coarseStart);
  const { filteredRows, timeline } = buildTimeline(rows, series);

  const summaryAccumulator = createSummaryAccumulator();
  for (const row of filteredRows) {
    addRowToSummary(summaryAccumulator, row);
  }

  const summary = {
    ...finalizeSummary(summaryAccumulator),
    activeKeys: new Set(filteredRows.map((row) => row.api_key_id)).size,
  };
  const pValues = computePercentilesFromRows(filteredRows);

  const allKeys = db.prepare("SELECT id, name, model, key_preview AS keyPreview, is_deleted AS isDeleted, created_at AS createdAt FROM api_keys").all() as Array<{
    id: number;
    name: string;
    model: string;
    keyPreview: string;
    isDeleted: number;
    createdAt: string;
  }>;

  const perKey = new Map<number, SummaryAccumulator>();
  for (const row of filteredRows) {
    const accumulator = perKey.get(row.api_key_id) ?? createSummaryAccumulator();
    addRowToSummary(accumulator, row);
    perKey.set(row.api_key_id, accumulator);
  }

  const keySummaries = allKeys
    .map((key) => {
      const accumulator = perKey.get(key.id) ?? createSummaryAccumulator();
      const summaryForKey = finalizeSummary(accumulator);
      return {
        ...key,
        totalCalls: summaryForKey.totalCalls,
        successRate: summaryForKey.successRate,
        avgProxyTime: summaryForKey.avgProxyTime,
        avgResponseTime: summaryForKey.avgResponseTime,
      };
    })
    .sort((left, right) => right.totalCalls - left.totalCalls || right.createdAt.localeCompare(left.createdAt));

  return { summary: { ...summary, ...pValues }, keySummaries, timeline };
}

export function getKeyStats(id: number, window: TimeWindow | null, timeZone?: string) {
  const resolvedTimeZone = normalizeTimeZone(timeZone);
  const useAllTime = window === null;
  const coarseStart = useAllTime ? "1970-01-01T00:00:00.000Z" : buildWindowSeries(window, resolvedTimeZone).coarseStart;
  const rows = getKeyRequestRows(id, coarseStart);
  const series = useAllTime ? buildAllTimeSeries(rows, resolvedTimeZone) : buildWindowSeries(window, resolvedTimeZone);
  const { filteredRows, timeline } = buildTimeline(rows, series);

  const statsAccumulator = createSummaryAccumulator();
  for (const row of filteredRows) {
    addRowToSummary(statsAccumulator, row);
  }

  const stats = finalizeSummary(statsAccumulator);
  const pValues = computePercentilesFromRows(filteredRows);
  const recentErrors = filteredRows
    .filter((row) => row.success === 0)
    .sort((left, right) => right.timestamp.localeCompare(left.timestamp))
    .slice(0, 20)
    .map((row) => ({
      id: row.id,
      timestamp: row.timestamp,
      path: row.path,
      status_code: row.status_code,
      error_message: row.error_message,
    }));

  return {
    stats: { ...stats, ...pValues },
    timeline,
    recentErrors,
    callsByIpAndHost: buildCallsByIpAndHost(filteredRows),
  };
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
