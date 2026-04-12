import axios from "axios";

// Frontend uses same-origin /api/admin; Vite (3020) proxies it to the admin backend (8020).
// Client API (/api/v1) is exposed on 8022 by the tunnel; the dashboard does not call it.
const ADMIN_BASE = "/api/admin";

export const apiClient = axios.create({
  baseURL: ADMIN_BASE,
});

export function getBrowserTimeZone() {
  return Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC";
}

export function buildStatsQuery(window: string) {
  return new URLSearchParams({ window, timezone: getBrowserTimeZone() }).toString();
}

export type TimeWindowValue = "24h" | "7d" | "30d" | "90d";

export type AllowedModelsValue = string[] | string;

export interface ApiKeyItem {
  id: number;
  key_hash: string;
  key_preview: string;
  name: string;
  allowed_models: AllowedModelsValue;
  fallback_model: string;
  is_active: number;
  is_deleted: number;
  created_by_name: string;
  created_by_email: string;
  deleted_at?: string | null;
  created_at: string;
  updated_at: string;
  last_used_at?: string | null;
  totalCalls?: number;
  successRate?: number;
  avgResponseTime?: number;
}

/** Parsed allowed_models from JSON string, with fallback first in display order */
export function parseAllowedModels(item: Pick<ApiKeyItem, "allowed_models">): string[] {
  const { allowed_models } = item;

  if (Array.isArray(allowed_models)) {
    return allowed_models.filter((model): model is string => typeof model === "string").map((model) => model.trim()).filter(Boolean);
  }

  try {
    const models = JSON.parse(allowed_models) as string[];
    return Array.isArray(models) ? models.filter((model): model is string => typeof model === "string").map((model) => model.trim()).filter(Boolean) : [];
  } catch {
    return [];
  }
}

/** Format models for display: fallback first with (fallback) marker */
export function formatModelDisplay(item: Pick<ApiKeyItem, "allowed_models" | "fallback_model">): string {
  const models = parseAllowedModels(item);
  const fallback = item.fallback_model;
  const others = models.filter((m) => m !== fallback);
  const parts = [`${fallback}(fallback)`, ...others];
  return parts.join(', ');
}

export interface TimelinePoint {
  bucket: string;
  calls: number;
  avgProxyTime: number;
  avgResponseTime: number;
  successRate: number;
}

export interface OverviewResponse {
  defaultModel: string;
  summary: {
    totalCalls: number;
    successRate: number;
    avgProxyTime: number;
    avgResponseTime: number;
    activeKeys: number;
    avgTokensPerRequest: number;
    p90ProxyTime: number;
    p95ProxyTime: number;
    p99ProxyTime: number;
    p90ResponseTime: number;
    p95ResponseTime: number;
    p99ResponseTime: number;
    p90Tokens: number;
    p95Tokens: number;
    p99Tokens: number;
  };
  keySummaries: Array<{
    id: number;
    name: string;
    allowed_models: AllowedModelsValue;
    fallback_model: string;
    keyPreview: string;
    isDeleted: number;
    createdAt: string;
    totalCalls: number;
    successRate: number;
    avgProxyTime: number;
    avgResponseTime: number;
  }>;
  timeline: TimelinePoint[];
  request_timeline_total?: Array<{ bucket: string; calls: number }>;
  request_timeline_by_model: Record<string, Array<{ bucket: string; calls: number }>>;
  response_timeline_by_model: Record<string, Array<{ bucket: string; avgResponseTime: number }>>;
  success_timeline_by_model: Record<string, Array<{ bucket: string; successRate: number }>>;
}

export interface KeyStatsResponse {
  item: ApiKeyItem;
  stats: {
    totalCalls: number;
    successRate: number;
    avgProxyTime: number;
    avgResponseTime: number;
    avgTokensPerRequest: number;
    promptTokens: number;
    completionTokens: number;
    totalTokens: number;
    p90ProxyTime: number;
    p95ProxyTime: number;
    p99ProxyTime: number;
    p90ResponseTime: number;
    p95ResponseTime: number;
    p99ResponseTime: number;
    p90Tokens: number;
    p95Tokens: number;
    p99Tokens: number;
  };
  timeline: TimelinePoint[];
  request_timeline_total?: Array<{ bucket: string; calls: number }>;
  request_timeline_by_model: Record<string, Array<{ bucket: string; calls: number }>>;
  response_timeline_by_model: Record<string, Array<{ bucket: string; avgResponseTime: number }>>;
  success_timeline_by_model: Record<string, Array<{ bucket: string; successRate: number }>>;
  recentErrors: Array<{
    id: number;
    timestamp: string;
    path: string;
    status_code: number;
    error_message: string | null;
  }>;
  callsByIpAndHost: Array<{
    ip_address: string;
    host: string;
    calls: number;
  }>;
}

export type AutoRefreshInterval = "15" | "30" | "60" | "180" | "300" | "900" | "1800" | "never";

export interface SettingsResponse {
  copilot_url: string;
  default_model: string;
  dashboard_time_window: TimeWindowValue;
  key_detail_time_window: TimeWindowValue;
  auto_refresh_interval: AutoRefreshInterval;
}

export interface HealthCheckResponse {
  ok: boolean;
  latencyMs?: number;
  models?: string[];
  status?: number;
}
