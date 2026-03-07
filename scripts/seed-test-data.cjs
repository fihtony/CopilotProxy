/**
 * Seed test data across 90 days so the timeline charts show meaningful data
 * for all time-window filters (24h / 7d / 30d / 90d).
 *
 * Usage:  node scripts/seed-test-data.cjs
 */
"use strict";

const Database = require("../node_modules/better-sqlite3");
const path = require("path");

const DB_PATH = path.resolve(__dirname, "../data/copilot-proxy.db");
const db = new Database(DB_PATH);

// ── helpers ──────────────────────────────────────────────────────────────────
function randInt(min, max) {
  return Math.floor(Math.random() * (max - min + 1)) + min;
}
function randFloat(min, max) {
  return Math.random() * (max - min) + min;
}

const MODELS = ["gpt-5-mini", "gpt-4o", "claude-3-5-sonnet"];
const PATHS = ["/v1/chat/completions", "/v1/completions"];

// ── ensure we have a test API key to attach data to ──────────────────────────
let seedKey = db.prepare("SELECT id FROM api_keys WHERE name = 'Seed Test Key'").get();
if (!seedKey) {
  const now = new Date().toISOString();
  const hash = "seed_" + Math.random().toString(36).slice(2);
  db.prepare(
    `
    INSERT INTO api_keys (key_hash, key_preview, name, model, is_active, is_deleted, created_at, updated_at)
    VALUES (?, ?, ?, ?, 1, 0, ?, ?)
  `,
  ).run(hash, "cps_seed...0000", "Seed Test Key", "gpt-5-mini", now, now);
  seedKey = db.prepare("SELECT id FROM api_keys WHERE name = 'Seed Test Key'").get();
}

// Also use any existing active key for extra variety
const existingKeys = db.prepare("SELECT id FROM api_keys WHERE is_deleted = 0 LIMIT 5").all();
const keyIds = [...new Set([seedKey.id, ...existingKeys.map((k) => k.id)])];

console.log(`Seeding data for key IDs: ${keyIds.join(", ")}`);

const insert = db.prepare(`
  INSERT INTO requests (
    api_key_id, timestamp, method, path, status_code, success,
    response_time_ms, proxy_time_ms,
    prompt_tokens, completion_tokens, total_tokens,
    model_requested, model_used, error_message
  ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
`);

const NOW = Date.now();
const DAY_MS = 24 * 60 * 60 * 1000;

// Distribution: more calls in recent days, sparse early on
const dayBuckets = [
  // [daysAgo, callsPerDay]
  ...Array.from({ length: 60 }, (_, i) => [90 - i, randInt(2, 8)]), // 90d–31d ago: sparse
  ...Array.from({ length: 21 }, (_, i) => [30 - i, randInt(10, 25)]), // 30d–10d ago: medium
  ...Array.from({ length: 7 }, (_, i) => [7 - i, randInt(20, 50)]), // 7d ago: higher
  ...Array.from({ length: 1 }, () => [0, randInt(30, 60)]), // today: high
];

const insertMany = db.transaction((buckets) => {
  let total = 0;
  for (const [daysAgo, count] of buckets) {
    for (let c = 0; c < count; c++) {
      const keyId = keyIds[randInt(0, keyIds.length - 1)];
      // Spread calls randomly within the day
      const offsetMs = randInt(0, DAY_MS - 1);
      const ts = new Date(NOW - daysAgo * DAY_MS + offsetMs).toISOString();
      const isError = Math.random() < 0.08; // 8% error rate
      const status = isError ? (Math.random() < 0.5 ? 500 : 429) : 200;
      const responseMs = randInt(120, 1800);
      const proxyMs = randInt(5, Math.min(responseMs - 10, 200));
      const prompt = randInt(80, 600);
      const completion = randInt(50, 400);
      const model = MODELS[randInt(0, MODELS.length - 1)];

      insert.run(
        keyId,
        ts,
        "POST",
        PATHS[randInt(0, PATHS.length - 1)],
        status,
        isError ? 0 : 1,
        responseMs,
        proxyMs,
        prompt,
        completion,
        prompt + completion,
        model,
        model,
        isError ? "Internal server error" : null,
      );
      total++;
    }
  }
  return total;
});

const count = insertMany(dayBuckets);
console.log(`✓ Inserted ${count} test requests spanning 90 days.`);
db.close();
