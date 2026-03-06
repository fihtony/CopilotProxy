import { useEffect, useState } from "react";
import { apiClient, type OverviewResponse } from "../api/client";
import { MetricCard } from "../components/MetricCard";

const windows = ["1h", "24h", "7d", "30d"] as const;

export function Overview() {
  const [window, setWindow] = useState<(typeof windows)[number]>("24h");
  const [data, setData] = useState<OverviewResponse | null>(null);

  useEffect(() => {
    apiClient.get<OverviewResponse>(`/overview?window=${window}`).then((response) => setData(response.data));
  }, [window]);

  return (
    <div className="page-stack">
      <div className="hero-card">
        <div>
          <span className="eyebrow">Global Snapshot</span>
          <h1>Copilot Proxy command deck</h1>
          <p>Track key-level traffic, success rate, latency, and token consumption from one place.</p>
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
        <MetricCard label="Total Calls" value={String(data?.summary.totalCalls ?? 0)} hint={`Window ${window}`} />
        <MetricCard label="Success Rate" value={`${data?.summary.successRate ?? 0}%`} />
        <MetricCard label="Average Latency" value={`${Math.round(data?.summary.avgResponseTime ?? 0)} ms`} />
        <MetricCard label="Token Volume" value={String(data?.summary.totalTokens ?? 0)} />
      </div>

      <div className="table-card">
        <div className="section-head">
          <h3>API Keys</h3>
          <p>Top keys by volume in the selected time window.</p>
        </div>
        <table>
          <thead>
            <tr>
              <th>Name</th>
              <th>Preview</th>
              <th>Model</th>
              <th>Calls</th>
              <th>Success</th>
              <th>Latency</th>
            </tr>
          </thead>
          <tbody>
            {data?.keySummaries.map((item) => (
              <tr key={item.id}>
                <td>{item.name}</td>
                <td>{item.keyPreview}</td>
                <td>{item.model}</td>
                <td>{item.totalCalls}</td>
                <td>{item.successRate}%</td>
                <td>{Math.round(item.avgResponseTime)} ms</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
