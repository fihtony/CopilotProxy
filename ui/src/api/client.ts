import axios from "axios";

// Determine API base URL
// If VITE_PROXY_PORT is set (injected by build), use it
// Otherwise default to port 3000 on same host
function getApiBaseUrl(): string {
  const proxyPort = import.meta.env.VITE_PROXY_PORT || "3000";
  const host = window.location.hostname;
  return `http://${host}:${proxyPort}/api`;
}

export const apiClient = axios.create({
  baseURL: getApiBaseUrl(),
});

export const proxyClient = axios.create({
  baseURL: `http://${window.location.hostname}:${import.meta.env.VITE_PROXY_PORT || "3000"}/v1`,
});

export interface ApiKeyItem {
  id: number;
  key_hash: string;
  key_preview: string;
  name: string;
  model: string;
  is_active: number;
  is_deleted: number;
  created_at: string;
  updated_at: string;
  last_used_at?: string | null;
  totalCalls?: number;
  successRate?: number;
  avgResponseTime?: number;
}

export interface TimelinePoint {
  bucket: string;
  calls: number;
  avgProxyTime: number;
  avgResponseTime: number;
  successRate: number;
}

export interface OverviewResponse {
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
    model: string;
    keyPreview: string;
    isDeleted: number;
    createdAt: string;
    totalCalls: number;
    successRate: number;
    avgProxyTime: number;
    avgResponseTime: number;
  }>;
  timeline: TimelinePoint[];
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

export interface SettingsResponse {
  copilot_url: string;
  default_model: string;
}

export interface HealthCheckResponse {
  ok: boolean;
  latencyMs?: number;
  models?: string[];
  status?: number;
}
