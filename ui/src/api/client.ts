import axios from "axios";

// Frontend uses same-origin /api/admin; Vite (3020) proxies it to the admin backend (8020).
// Client API (/api/v1) is exposed on 8022 by the tunnel; the dashboard does not call it.
const ADMIN_BASE = "/api/admin";

export const apiClient = axios.create({
  baseURL: ADMIN_BASE,
});

export interface ApiKeyItem {
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
