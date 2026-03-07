import { useEffect, useState } from "react";
import { apiClient, type HealthCheckResponse } from "../api/client";

export function HealthIndicator() {
  const [health, setHealth] = useState<HealthCheckResponse | null>(null);

  useEffect(() => {
    let active = true;
    const check = () => {
      apiClient
        .get<HealthCheckResponse>("/health/copilot")
        .then((r) => active && setHealth(r.data))
        .catch(() => active && setHealth({ ok: false }));
    };
    check();
    const id = setInterval(check, 30_000);
    return () => {
      active = false;
      clearInterval(id);
    };
  }, []);

  const ok = health?.ok ?? false;

  return (
    <span className="health-indicator" data-testid="health-indicator">
      <span className={`health-dot ${ok ? "ok" : "fail"}`} />
      {ok ? "Connected" : "Disconnected"}
      {health?.latencyMs !== undefined && ok ? ` (${health.latencyMs}ms)` : ""}
    </span>
  );
}
