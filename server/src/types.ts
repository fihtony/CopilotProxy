export type TimeWindow = "1h" | "24h" | "7d" | "30d";

export interface ApiKeyRecord {
  id: number;
  key_hash: string;
  key_preview: string;
  name: string;
  model: string;
  is_active: number;
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
  promptTokens: number | null;
  completionTokens: number | null;
  totalTokens: number | null;
  modelRequested: string | null;
  modelUsed: string;
  errorMessage: string | null;
}
