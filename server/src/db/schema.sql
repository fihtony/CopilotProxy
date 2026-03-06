CREATE TABLE IF NOT EXISTS api_keys (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  key_hash TEXT NOT NULL UNIQUE,
  key_preview TEXT NOT NULL,
  name TEXT NOT NULL,
  model TEXT NOT NULL,
  is_active INTEGER NOT NULL DEFAULT 1,
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
  prompt_tokens INTEGER,
  completion_tokens INTEGER,
  total_tokens INTEGER,
  model_requested TEXT,
  model_used TEXT NOT NULL,
  error_message TEXT,
  FOREIGN KEY (api_key_id) REFERENCES api_keys(id)
);

CREATE INDEX IF NOT EXISTS idx_requests_api_key_id ON requests(api_key_id);
CREATE INDEX IF NOT EXISTS idx_requests_timestamp ON requests(timestamp);
