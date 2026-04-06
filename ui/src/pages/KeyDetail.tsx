import { useEffect, useState } from "react";
import { useParams, useNavigate } from "react-router-dom";
import { apiClient, buildStatsQuery, type KeyStatsResponse, type TimeWindowValue } from "../api/client";
import { MetricCard } from "../components/MetricCard";
import { TimelineChart } from "../components/TimelineChart";
import { RequestTable, type RequestItem } from "../components/RequestTable";
import { formatDateTime } from "../utils/dateFormatter";
import { formatLatencyMs } from "../utils/timelineUtils";
import { readTimeWindowPreference, saveTimeWindowPreference } from "../utils/timeWindowPreferences";

const windows = ["24h", "7d", "30d", "90d"] as const;

export function KeyDetail() {
  const { id } = useParams();
  const navigate = useNavigate();
  const [timeWindow, setTimeWindow] = useState<TimeWindowValue>("24h");
  const [timeWindowReady, setTimeWindowReady] = useState(false);
  const [data, setData] = useState<KeyStatsResponse | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [history, setHistory] = useState<RequestItem[]>([]);

  // Always show page from beginning on load
  useEffect(() => {
    window.scrollTo(0, 0);
  }, []);

  useEffect(() => {
    let cancelled = false;
    readTimeWindowPreference("key_detail_time_window")
      .then((savedWindow) => {
        if (cancelled) return;
        setTimeWindow(savedWindow);
        setTimeWindowReady(true);
      })
      .catch(() => {
        if (cancelled) return;
        setTimeWindowReady(true);
      });

    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    if (!timeWindowReady) {
      return;
    }
    if (!id) {
      setIsLoading(false);
      return;
    }
    setIsLoading(true);
    apiClient.get<KeyStatsResponse>(`/keys/${id}/stats?${buildStatsQuery(timeWindow)}`).then((r) => {
      setData(r.data);
      setIsLoading(false);
    });
  }, [id, timeWindow, timeWindowReady]);

  async function handleTimeWindowChange(nextWindow: TimeWindowValue) {
    setTimeWindow(nextWindow);
    try {
      await saveTimeWindowPreference("key_detail_time_window", nextWindow);
    } catch {
      // Keep the selected window locally even if persistence fails.
    }
  }

  useEffect(() => {
    if (!id) return;
    apiClient.get<{ items: RequestItem[]; total: number }>(`/keys/${id}/history`).then((r) => {
      setHistory(r.data.items);
    });
  }, [id]);

  const handleBack = () => {
    // Try to restore scroll position from where we came
    const dashboardPos = sessionStorage.getItem("dashboardScrollPos");
    const keysManagePos = sessionStorage.getItem("keysManageScrollPos");

    // Determine which page we came from and restore appropriately
    if (keysManagePos) {
      sessionStorage.removeItem("keysManageScrollPos");
      navigate(-1);
      // Restore scroll after navigation
      setTimeout(() => {
        window.scrollTo(0, parseInt(keysManagePos, 10));
      }, 0);
    } else if (dashboardPos) {
      sessionStorage.removeItem("dashboardScrollPos");
      navigate(-1);
      // Restore scroll after navigation
      setTimeout(() => {
        window.scrollTo(0, parseInt(dashboardPos, 10));
      }, 0);
    } else {
      navigate("/keys");
    }
  };

  if (!id) {
    return <div className="empty-state">Select an API key.</div>;
  }

  const stats = data?.stats;
  const isDeleted = data?.item.is_deleted === 1;

  return (
    <div className="page-stack">
      <div className="hero-card">
        <div style={{ display: "flex", alignItems: "flex-start", gap: "1rem", flex: 1 }}>
          <button className="btn-back" onClick={handleBack} title="Go back">
            ←
          </button>
          <div>
            <span className="eyebrow">Key Dashboard</span>

            <h1>
              {data?.item.name ?? "Loading key…"}
              {isDeleted && (
                <span className="badge-deleted" style={{ marginLeft: "0.2rem" }}>
                  Deleted
                </span>
              )}
            </h1>

            <p style={{ display: "flex", flexWrap: "wrap", gap: "0.4rem 1.5rem", alignItems: "baseline", margin: 0 }}>
              <span>
                <span style={{ color: "var(--muted)", fontSize: "0.8rem" }}>api key:</span>{" "}
                <code style={{ marginLeft: "0.25rem" }}>{data?.item.key_preview ?? ""}</code>
              </span>
              <span>
                <span style={{ color: "var(--muted)", fontSize: "0.8rem" }}>model:</span> {data?.item.model ?? ""}
              </span>
              <span>
                <span style={{ color: "var(--muted)", fontSize: "0.8rem" }}>created:</span> {formatDateTime(data?.item.created_at)}
              </span>
              <span>
                <span style={{ color: "var(--muted)", fontSize: "0.8rem" }}>last used:</span> {formatDateTime(data?.item.last_used_at)}
              </span>
              {data?.item.created_by_name && (
                <span>
                  <span style={{ color: "var(--muted)", fontSize: "0.8rem" }}>created by:</span> {data.item.created_by_name}
                  {data.item.created_by_email && (
                    <span style={{ color: "var(--muted)", fontSize: "0.8rem" }}> ({data.item.created_by_email})</span>
                  )}
                </span>
              )}
            </p>
          </div>
        </div>
        {!isDeleted && timeWindowReady && (
          <div className="segmented-control">
            {windows.map((w) => (
              <button key={w} className={w === timeWindow ? "active" : ""} onClick={() => void handleTimeWindowChange(w)}>
                {w}
              </button>
            ))}
          </div>
        )}
      </div>

      <div className="metric-grid metric-grid-5">
        <MetricCard label="Total Requests" value={String(stats?.totalCalls ?? 0)} hints={[timeWindow]} />
        <MetricCard label="Success Rate" value={`${stats?.successRate ?? 0}%`} />
        <MetricCard
          label="Avg Proxy Latency"
          value={formatLatencyMs(stats?.avgProxyTime ?? 0)}
          hints={[`P90: ${formatLatencyMs(stats?.p90ProxyTime ?? 0)}`, `P99: ${formatLatencyMs(stats?.p99ProxyTime ?? 0)}`]}
        />
        <MetricCard
          label="Avg Response Time"
          value={formatLatencyMs(stats?.avgResponseTime ?? 0)}
          hints={[
            `P90: ${formatLatencyMs(stats?.p90ResponseTime ?? 0)}`,
            `P99: ${formatLatencyMs(stats?.p99ResponseTime ?? 0)}`,
          ]}
        />
        <MetricCard
          label="Avg Tokens"
          value={String(Math.round(stats?.avgTokensPerRequest ?? 0))}
          hints={[`P90: ${stats?.p90Tokens ?? 0}`, `P99: ${stats?.p99Tokens ?? 0}`]}
        />
      </div>

      {/* Full-width total requests chart */}
      <TimelineChart
        title="Total Requests"
        subtitle="Number of requests over time"
        data={data?.timeline ?? []}
        timeWindow={timeWindow}
        dataKeys={[{ key: "calls", color: "#ff7a18", label: "Requests" }]}
      />

      {/* Side-by-side: Avg Latency + Success Rate */}
      <div className="chart-row-split">
        <TimelineChart
          title="Avg Response Latency"
          subtitle="Proxy latency vs total response time"
          data={data?.timeline ?? []}
          timeWindow={timeWindow}
          dataKeys={[
            { key: "avgProxyTime", color: "#34d399", label: "Proxy Latency" },
            { key: "avgResponseTime", color: "#60a5fa", label: "Response Time" },
          ]}
          unit="ms"
          autoScaleMs
        />
        <TimelineChart
          title="Success Rate"
          subtitle="Percentage of successful requests"
          data={data?.timeline ?? []}
          timeWindow={timeWindow}
          dataKeys={[{ key: "successRate", color: "#a78bfa", label: "Success %" }]}
          unit="%"
        />
      </div>

      {/* Source: Host & IP */}
      {(data?.callsByIpAndHost?.length ?? 0) > 0 && (
        <div className="table-card">
          <div className="section-head">
            <h3>Source: Host &amp; IP</h3>
            <span className="section-sub">{timeWindow}</span>
          </div>
          <table>
            <thead>
              <tr>
                <th>Host</th>
                <th>IP Address</th>
                <th style={{ textAlign: "right" }}>Requests</th>
              </tr>
            </thead>
            <tbody>
              {data?.callsByIpAndHost.map((row, i) => (
                <tr key={i}>
                  <td>{row.host}</td>
                  <td>
                    <code>{row.ip_address}</code>
                  </td>
                  <td style={{ textAlign: "right" }}>{row.calls}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {/* Recent Errors */}
      {(data?.recentErrors?.length ?? 0) > 0 && (
        <div className="table-card">
          <div className="section-head">
            <h3>Recent Errors</h3>
          </div>
          <table>
            <thead>
              <tr>
                <th>Time</th>
                <th>Path</th>
                <th>Status</th>
                <th>Error</th>
              </tr>
            </thead>
            <tbody>
              {data?.recentErrors.map((err) => (
                <tr key={err.id}>
                  <td>{formatDateTime(err.timestamp)}</td>
                  <td>{err.path}</td>
                  <td>{err.status_code}</td>
                  <td className="error-cell">{err.error_message ?? "—"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {/* Request History */}
      <RequestTable items={history} />
    </div>
  );
}
