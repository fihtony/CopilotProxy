import axios from "axios";

export const apiClient = axios.create({
  baseURL: "http://127.0.0.1:3000/api",
});

export const proxyClient = axios.create({
  baseURL: "http://127.0.0.1:3000/v1",
});

export interface ApiKeyItem {
  id: number;
  key_hash: string;
  key_preview: string;
  name: string;
  model: string;
  is_active: number;
  created_at: string;
  updated_at: string;
}

export interface OverviewResponse {
  summary: {
    totalCalls: number;
    successRate: number;
    avgResponseTime: number;
    activeKeys: number;
    totalTokens: number;
  };
  keySummaries: Array<{
    id: number;
    name: string;
    model: string;
    keyPreview: string;
    totalCalls: number;
    successRate: number;
    avgResponseTime: number;
    totalTokens: number;
  }>;
}
