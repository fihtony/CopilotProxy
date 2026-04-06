export type TimeWindow = "24h" | "7d" | "30d" | "90d";

export interface ApiKeyRecord {
  id: number;
  key_hash: string;
  key_preview: string;
  name: string;
  model: string;
  is_active: number;
  is_deleted: number;
  created_by_name: string;
  created_by_email: string;
  created_at: string;
  updated_at: string;
}

export interface AuthenticatedApiKey {
  id: number;
  name: string;
  model: string;
  keyPreview: string;
}

export interface RequestLogRecord {
  apiKeyId: number;
  method: string;
  path: string;
  statusCode: number;
  success: number;
  responseTimeMs: number;
  proxyTimeMs: number;
  promptTokens: number | null;
  completionTokens: number | null;
  totalTokens: number | null;
  modelRequested: string | null;
  modelUsed: string;
  errorMessage: string | null;
  ipAddress: string | null;
  host: string | null;
}

export interface SettingsRecord {
  copilot_url: string;
  default_model: string;
  dashboard_time_window: TimeWindow;
  key_detail_time_window: TimeWindow;
}
