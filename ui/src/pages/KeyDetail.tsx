import { useEffect, useState } from "react";
import { Link, useParams } from "react-router-dom";
import { apiClient } from "../api/client";
import { MetricCard } from "../components/MetricCard";
import { RequestTable } from "../components/RequestTable";
import { TimelineChart } from "../components/TimelineChart";

const windows = ["1h", "24h", "7d", "30d"] as const;

interface HistoryResponse {
  items: Array<{
    id: number;
    timestamp: string;
    path: string;
    status_code: number;
    response_time_ms: number;
    model_requested: string | null;
    model_used: string;
    total_tokens: number | null;
    success: number;
    error_message: string | null;
  }>;
  total: number;
}

interface StatsResponse {
  item: {
    id: number;
    name: string;
    key_preview: string;
    model: string;
  };
  stats: {
    totalCalls: number;
    successRate: number;
    avgResponseTime: number;
    promptTokens: number;
    completionTokens: number;
    totalTokens: number;
  };
  timeline: Array<{
    bucket: string;
    calls: number;
    avgResponseTime: number;
    successRate: number;
  }>;
}

export function KeyDetail() {
  const { id } = useParams();
  const [window, setWindow] = useState<(typeof windows)[number]>("24h");
  const [stats, setStats] = useState<StatsResponse | null>(null);
  const [history, setHistory] = useState<HistoryResponse>({ items: [], total: 0 });

  useEffect(() => {
    if (!id) {
      return;
    }

    apiClient.get<StatsResponse>(`/keys/${id}/stats?window=${window}`).then((response) => setStats(response.data));
    apiClient.get<HistoryResponse>(`/keys/${id}/history?page=1&limit=20`).then((response) => setHistory(response.data));
  }, [id, window]);

  if (!id) {
    return <div className="empty-state">Select an API key.</div>;
  }

  return (
    <div className="page-stack">
      <div className="hero-card">
        <div>
          <span className="eyebrow">Key Dashboard</span>
          <h1>{stats?.item.name ?? "Loading key..."}</h1>
          <p>
            {stats?.item.key_preview ?? ""} forcing model {stats?.item.model ?? ""}
          </p>
          <Link to="/keys">Back to key management</Link>
        </div>
        <div className="segmented-control">
          {windows.map((item) => (
            <button key={item} className={item === window ? "active" : ""} onClick={() => setWindow(item)}>
              {item}
            </button>
          ))}
        </div>
      </div>

      <div className="metric-grid">
        <MetricCard label="Total Calls" value={String(stats?.stats.totalCalls ?? 0)} />
        <MetricCard label="Success Rate" value={`${stats?.stats.successRate ?? 0}%`} />
        <MetricCard label="Average Latency" value={`${Math.round(stats?.stats.avgResponseTime ?? 0)} ms`} />
        <MetricCard label="Total Tokens" value={String(stats?.stats.totalTokens ?? 0)} />
      </div>

      <TimelineChart data={stats?.timeline ?? []} />
      <RequestTable items={history.items} />
    </div>
  );
}
