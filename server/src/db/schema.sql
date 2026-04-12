CREATE TABLE IF NOT EXISTS api_keys (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  key_hash TEXT NOT NULL UNIQUE,
  key_preview TEXT NOT NULL,
  name TEXT NOT NULL,
  allowed_models TEXT NOT NULL DEFAULT '[]',
  fallback_model TEXT NOT NULL DEFAULT 'gpt-5-mini',
  is_active INTEGER NOT NULL DEFAULT 1,
  is_deleted INTEGER NOT NULL DEFAULT 0,
  created_by_name TEXT NOT NULL DEFAULT 'Unknown',
  created_by_email TEXT NOT NULL DEFAULT '',
  deleted_at TEXT,
  -- Stored as ISO 8601 with UTC offset, e.g. "2024-01-01T12:00:00.000Z".
  -- Provided by the application (not CURRENT_TIMESTAMP) to include timezone info.
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS requests (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  api_key_id INTEGER NOT NULL,
  -- Stored as ISO 8601 with UTC offset, e.g. "2024-01-01T12:00:00.000Z".
  timestamp TEXT NOT NULL,
  method TEXT NOT NULL,
  path TEXT NOT NULL,
  status_code INTEGER NOT NULL,
  success INTEGER NOT NULL,
  response_time_ms INTEGER NOT NULL,
  proxy_time_ms INTEGER NOT NULL DEFAULT 0,
  prompt_tokens INTEGER,
  completion_tokens INTEGER,
  total_tokens INTEGER,
  model_requested TEXT,
  model_used TEXT NOT NULL,
  error_message TEXT,
  ip_address TEXT,
  host TEXT,
  FOREIGN KEY (api_key_id) REFERENCES api_keys(id)
);

CREATE TABLE IF NOT EXISTS settings (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_requests_api_key_id ON requests(api_key_id);
CREATE INDEX IF NOT EXISTS idx_requests_timestamp ON requests(timestamp);
CREATE INDEX IF NOT EXISTS idx_requests_api_key_model_used_timestamp ON requests(api_key_id, model_used, timestamp);
