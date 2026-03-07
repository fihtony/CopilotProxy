import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { apiClient, type OverviewResponse } from "../api/client";
import { MetricCard } from "../components/MetricCard";
import { TimelineChart } from "../components/TimelineChart";
import { formatDate } from "../utils/dateFormatter";
import { HealthIndicator } from "../components/HealthIndicator";

const windows = ["24h", "7d", "30d", "90d"] as const;

export function Dashboard() {
  const navigate = useNavigate();
  const [timeWindow, setTimeWindow] = useState<(typeof windows)[number]>("24h");
  const [data, setData] = useState<OverviewResponse | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [search, setSearch] = useState("");
  const [sortBy, setSortBy] = useState("calls");
  const [sortDir, setSortDir] = useState<"asc" | "desc">("desc");
  const [showDeleted, setShowDeleted] = useState(false);
  const [showCustomModel, setShowCustomModel] = useState(false);

  // Always show page from beginning on load
  useEffect(() => {
    window.scrollTo(0, 0);
  }, []);

  useEffect(() => {
    setIsLoading(true);
    apiClient.get<OverviewResponse>(`/overview?window=${timeWindow}`).then((r) => {
      setData(r.data);
      setIsLoading(false);
    });
  }, [timeWindow]);

  const summary = data?.summary;
  const defaultModel = data?.defaultModel ?? "";

  // Client-side filter for the key table
  const filtered = (data?.keySummaries ?? []).filter((k) => {
    if (!search) return true;
    const s = search.toLowerCase();
    return k.name.toLowerCase().includes(s) || k.keyPreview.toLowerCase().includes(s);
  });

  function handleSort(col: string) {
    if (sortBy === col) {
      setSortDir((d) => (d === "asc" ? "desc" : "asc"));
    } else {
      setSortBy(col);
      setSortDir("desc");
    }
  }

  // Helper to compare values, handling timestamps
  function compareValues(a: any, b: any): number {
    if (a == null && b == null) return 0;
    if (a == null) return 1;
    if (b == null) return -1;
    // For ISO datetime strings, compare as timestamps
    if (typeof a === "string" && typeof b === "string" && /\d{4}-\d{2}-\d{2}/.test(a) && /\d{4}-\d{2}-\d{2}/.test(b)) {
      const timeA = new Date(a).getTime();
      const timeB = new Date(b).getTime();
      if (timeA < timeB) return -1;
      if (timeA > timeB) return 1;
      return 0;
    }
    // Standard comparison
    if (a < b) return -1;
    if (a > b) return 1;
    return 0;
  }

  const sortedAll = [...filtered].sort((a, b) => {
    const dir = sortDir === "asc" ? 1 : -1;
    const valMap: Record<string, (item: (typeof filtered)[0]) => any> = {
      name: (i) => i.name.toLowerCase(),
      calls: (i) => i.totalCalls,
      success_rate: (i) => i.successRate,
      latency: (i) => i.avgResponseTime,
      created_at: (i) => i.createdAt,
    };
    const fn = valMap[sortBy] ?? valMap.calls;
    const va = fn(a);
    const vb = fn(b);
    return compareValues(va, vb) * dir;
  });
  const sorted = (showDeleted ? sortedAll : sortedAll.filter((k) => !k.isDeleted)).filter(
    (k) => !showCustomModel || (defaultModel && k.model !== defaultModel),
  );

  function sortIcon(col: string) {
    if (sortBy !== col) return <span className="sort-icon sort-inactive">⇅</span>;
    return sortDir === "asc" ? <span className="sort-icon sort-active">↑</span> : <span className="sort-icon sort-active">↓</span>;
  }

  return (
    <div className="page-stack">
      <div className="hero-card">
        <div>
          <span className="eyebrow">Global Snapshot</span>
          <h1>Dashboard</h1>
          <p>Track key-level traffic, success rate, latency, and token consumption.</p>
        </div>
        <div style={{ display: "flex", alignItems: "center", gap: "1rem" }}>
          <HealthIndicator />
          <div className="segmented-control">
            {windows.map((item) => (
              <button key={item} className={item === timeWindow ? "active" : ""} onClick={() => setTimeWindow(item)}>
                {item}
              </button>
            ))}
          </div>
        </div>
      </div>

      <div className="metric-grid metric-grid-5">
        <MetricCard label="Total Requests" value={String(summary?.totalCalls ?? 0)} hints={[timeWindow]} />
        <MetricCard label="Success Rate" value={`${summary?.successRate ?? 0}%`} />
        <MetricCard
          label="Avg Proxy Latency"
          value={`${Math.round(summary?.avgProxyTime ?? 0)} ms`}
          hints={[`P90: ${summary?.p90ProxyTime ?? 0}`, `P95: ${summary?.p95ProxyTime ?? 0}`, `P99: ${summary?.p99ProxyTime ?? 0}`]}
        />
        <MetricCard
          label="Avg Response Time"
          value={`${Math.round(summary?.avgResponseTime ?? 0)} ms`}
          hints={[
            `P90: ${summary?.p90ResponseTime ?? 0}`,
            `P95: ${summary?.p95ResponseTime ?? 0}`,
            `P99: ${summary?.p99ResponseTime ?? 0}`,
          ]}
        />
        <MetricCard
          label="Avg Tokens"
          value={String(Math.round(summary?.avgTokensPerRequest ?? 0))}
          hints={[`P90: ${summary?.p90Tokens ?? 0}`, `P95: ${summary?.p95Tokens ?? 0}`, `P99: ${summary?.p99Tokens ?? 0}`]}
        />
      </div>

      {/* Full-width: Total Requests chart */}
      <TimelineChart
        title="Total Requests"
        subtitle="Number of requests over time"
        data={data?.timeline ?? []}
        dataKeys={[{ key: "calls", color: "#ff7a18", label: "Requests" }]}
      />

      {/* Side-by-side: Avg Latency + Success Rate */}
      <div className="chart-row-split">
        <TimelineChart
          title="Avg Response Latency"
          subtitle="Proxy latency vs total response time"
          data={data?.timeline ?? []}
          dataKeys={[
            { key: "avgProxyTime", color: "#34d399", label: "Proxy Latency" },
            { key: "avgResponseTime", color: "#60a5fa", label: "Response Time" },
          ]}
          unit=" ms"
        />
        <TimelineChart
          title="Success Rate"
          subtitle="Percentage of successful requests"
          data={data?.timeline ?? []}
          dataKeys={[{ key: "successRate", color: "#a78bfa", label: "Success %" }]}
          unit="%"
        />
      </div>

      <div className="table-card">
        <div className="section-head">
          <h3>API Keys</h3>
          <div style={{ display: "flex", alignItems: "center", gap: "0.75rem" }}>
            <button
              className="btn-sm secondary"
              onClick={() => setShowDeleted((d) => !d)}
              title={showDeleted ? "Hide deleted keys" : "Show deleted keys"}
            >
              {showDeleted ? "Hide Deleted" : "Show Deleted"}
            </button>
            <button
              className={`btn-sm ${showCustomModel ? "" : "secondary"}`}
              onClick={() => setShowCustomModel((v) => !v)}
              title="Show only keys with a custom model"
            >
              Custom Model Only
            </button>
            <div className="table-search-wrapper">
              <input
                className="table-search"
                placeholder="Search name or key…"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                data-testid="key-search"
              />
              {search && (
                <button className="table-search-clear" onClick={() => setSearch("")} title="Clear search">
                  ✕
                </button>
              )}
            </div>
          </div>
        </div>
        <table>
          <thead>
            <tr>
              <th className="sortable" onClick={() => handleSort("name")}>
                Name{sortIcon("name")}
              </th>
              <th>API Key</th>
              <th>Model</th>
              <th className="sortable" onClick={() => handleSort("calls")}>
                Requests{sortIcon("calls")}
              </th>
              <th className="sortable" onClick={() => handleSort("success_rate")}>
                Success{sortIcon("success_rate")}
              </th>
              <th className="sortable" onClick={() => handleSort("latency")}>
                Response{sortIcon("latency")}
              </th>
              <th className="sortable" onClick={() => handleSort("created_at")}>
                Created{sortIcon("created_at")}
              </th>
            </tr>
          </thead>
          <tbody>
            {sorted.map((item) => (
              <tr
                key={item.id}
                className={item.isDeleted ? "key-deleted" : "clickable-row"}
                onClick={() => {
                  sessionStorage.setItem("dashboardScrollPos", String(window.scrollY));
                  navigate(`/keys/${item.id}`);
                }}
              >
                <td>
                  <span style={{ display: "flex", alignItems: "center", gap: "0.5rem" }}>
                    {item.name}
                    {item.isDeleted && <span className="badge-deleted">Deleted</span>}
                  </span>
                </td>
                <td>{item.keyPreview}</td>
                <td>
                  <span className={defaultModel && item.model !== defaultModel ? "model-custom" : ""}>{item.model}</span>
                </td>
                <td>{item.totalCalls}</td>
                <td>{item.successRate}%</td>
                <td>{Math.round(item.avgResponseTime)} ms</td>
                <td>{formatDate(item.createdAt)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
