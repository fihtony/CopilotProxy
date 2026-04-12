import { useEffect, useState, useCallback, useMemo } from "react";
import { useParams, useNavigate } from "react-router-dom";
import Select, { type SingleValue, type StylesConfig } from "react-select";
import {
  apiClient,
  buildStatsQuery,
  parseAllowedModels,
  type ApiKeyItem,
  type HealthCheckResponse,
  type KeyStatsResponse,
  type TimeWindowValue,
  type AutoRefreshInterval,
  type SettingsResponse,
} from "../api/client";
import { MetricCard } from "../components/MetricCard";
import { Modal } from "../components/Modal";
import { TimelineChart } from "../components/TimelineChart";
import { RequestTable, type RequestItem } from "../components/RequestTable";
import { formatDateTime } from "../utils/dateFormatter";
import { formatLatencyMs } from "../utils/timelineUtils";
import { readTimeWindowPreference, saveTimeWindowPreference } from "../utils/timeWindowPreferences";
import { useAutoRefresh } from "../hooks/useAutoRefresh";
import { isPermissionDeniedError } from "../utils/errorHandler";

const windows = ["24h", "7d", "30d", "90d"] as const;
const MAX_ALLOWED_MODELS = 20;

const REQUEST_MODEL_COLORS = ["#60a5fa", "#34d399", "#f59e0b", "#f472b6", "#22d3ee", "#f87171", "#a78bfa"];

interface ModelOption {
  value: string;
  label: string;
}

const modelSelectStyles: StylesConfig<ModelOption, false> = {
  control: (base, state) => ({
    ...base,
    minHeight: 48,
    borderRadius: 14,
    backgroundColor: "rgba(12, 13, 17, 0.9)",
    borderColor: state.isFocused ? "#ff7a18" : "rgba(255, 255, 255, 0.08)",
    boxShadow: "none",
    ":hover": {
      borderColor: state.isFocused ? "#ff7a18" : "rgba(255, 255, 255, 0.18)",
    },
  }),
  valueContainer: (base) => ({
    ...base,
    padding: "0 0.9rem",
  }),
  input: (base) => ({
    ...base,
    color: "#f2f1eb",
    fontFamily: '"IBM Plex Mono", monospace',
    fontSize: "0.85rem",
  }),
  placeholder: (base) => ({
    ...base,
    color: "#abafc1",
    fontSize: "0.84rem",
  }),
  singleValue: (base) => ({
    ...base,
    color: "#f2f1eb",
    fontFamily: '"IBM Plex Mono", monospace',
    fontSize: "0.85rem",
  }),
  menu: (base) => ({
    ...base,
    borderRadius: 14,
    border: "1px solid rgba(255, 255, 255, 0.08)",
    backgroundColor: "rgba(18, 19, 24, 0.98)",
    overflow: "hidden",
  }),
  menuList: (base) => ({
    ...base,
    padding: 6,
  }),
  option: (base, state) => ({
    ...base,
    borderRadius: 10,
    backgroundColor: state.isSelected
      ? "rgba(255, 122, 24, 0.18)"
      : state.isFocused
        ? "rgba(255, 255, 255, 0.08)"
        : "transparent",
    color: "#f2f1eb",
    cursor: "pointer",
    fontFamily: '"IBM Plex Mono", monospace',
    fontSize: "0.84rem",
  }),
  dropdownIndicator: (base, state) => ({
    ...base,
    color: state.isFocused ? "#ff7a18" : "#abafc1",
    ":hover": { color: "#ff7a18" },
  }),
  clearIndicator: (base) => ({
    ...base,
    color: "#abafc1",
    ":hover": { color: "#f2f1eb" },
  }),
  indicatorSeparator: () => ({ display: "none" }),
  noOptionsMessage: (base) => ({
    ...base,
    color: "#abafc1",
    fontSize: "0.82rem",
  }),
  menuPortal: (base) => ({
    ...base,
    zIndex: 200,
  }),
};

function normalizeModelIds(models: string[]): string[] {
  const seen = new Set<string>();
  const normalized: string[] = [];
  for (const model of models) {
    const trimmed = model.trim();
    if (!trimmed || seen.has(trimmed)) {
      continue;
    }
    seen.add(trimmed);
    normalized.push(trimmed);
  }
  return normalized;
}

function toModelOption(model: string): ModelOption {
  return { value: model, label: model };
}

export function KeyDetail() {
  const { id } = useParams();
  const navigate = useNavigate();
  const [timeWindow, setTimeWindow] = useState<TimeWindowValue>("24h");
  const [timeWindowReady, setTimeWindowReady] = useState(false);
  const [data, setData] = useState<KeyStatsResponse | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [history, setHistory] = useState<RequestItem[]>([]);
  const [autoRefreshInterval, setAutoRefreshInterval] = useState<number | "never" | null>(null);
  const [selectedModel, setSelectedModel] = useState<string>("total");
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false);
  const [showEditModal, setShowEditModal] = useState(false);
  const [editName, setEditName] = useState("");
  const [editAllowedModels, setEditAllowedModels] = useState<string[]>([]);
  const [editFallbackModel, setEditFallbackModel] = useState("");
  const [editManualModelInput, setEditManualModelInput] = useState("");
  const [editModelQuery, setEditModelQuery] = useState("");
  const [availableModels, setAvailableModels] = useState<string[]>([]);
  const [editError, setEditError] = useState("");
  const [showPermissionDenied, setShowPermissionDenied] = useState(false);

  // Reset model selection when navigating to a different key
  useEffect(() => {
    setSelectedModel("total");
  }, [id]);

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
    let cancelled = false;

    apiClient
      .get<SettingsResponse>("/settings")
      .then((r) => {
        if (cancelled) {
          return;
        }

        const raw: AutoRefreshInterval = r.data.auto_refresh_interval ?? "30";
        setAutoRefreshInterval(raw === "never" ? "never" : Number(raw));
      })
      .catch(() => {
        if (cancelled) {
          return;
        }

        setAutoRefreshInterval(30);
      });

    return () => {
      cancelled = true;
    };
  }, []);

  const loadStats = useCallback(async () => {
    if (!timeWindowReady || !id) {
      return;
    }

    setIsLoading(true);
    try {
      const [statsResult, historyResult] = await Promise.allSettled([
        apiClient.get<KeyStatsResponse>(`/keys/${id}/stats?${buildStatsQuery(timeWindow)}`),
        apiClient.get<{ items: RequestItem[]; total: number }>(`/keys/${id}/history`),
      ]);

      // Update stats if successful
      if (statsResult.status === "fulfilled") {
        setData(statsResult.value.data);
      }

      // Update history if successful
      if (historyResult.status === "fulfilled") {
        setHistory(historyResult.value.data.items);
      }
    } catch {
      // Keep the last loaded key data visible if a refresh fails.
    } finally {
      setIsLoading(false);
    }
  }, [id, timeWindow, timeWindowReady]);

  useEffect(() => {
    loadStats();
  }, [loadStats]);

  const resetRefreshTimer = useAutoRefresh(autoRefreshInterval, loadStats);

  async function handleManualRefresh() {
    await loadStats();
    resetRefreshTimer();
  }

  async function fetchModels(): Promise<string> {
    let defaultModel = "";
    try {
      const settings = await apiClient.get<SettingsResponse>("/settings");
      defaultModel = settings.data.default_model.trim();
      const health = await apiClient.post<HealthCheckResponse>("/health/copilot", { copilot_url: settings.data.copilot_url });
      setAvailableModels(normalizeModelIds(health.data.models ?? []));
      return defaultModel;
    } catch {
      setAvailableModels([]);
      return defaultModel;
    }
  }

  function normalizeModelList(raw: string): string[] {
    return normalizeModelIds(raw.split(/[,\n]/));
  }

  function addAllowedModel(
    model: string,
    current: string[],
    setCurrent: (v: string[]) => void,
    setFallback: (v: string) => void,
    currentFallback: string,
  ) {
    const trimmedModel = model.trim();
    if (!trimmedModel || current.includes(trimmedModel)) {
      return;
    }

    const next = [...current, trimmedModel];
    setCurrent(next);
    if (!currentFallback) {
      setFallback(trimmedModel);
    }
  }

  function toggleAllowedModel(
    model: string,
    current: string[],
    setCurrent: (v: string[]) => void,
    setFallback: (v: string) => void,
    currentFallback: string,
  ) {
    if (current.includes(model)) {
      const next = current.filter((m) => m !== model);
      setCurrent(next);
      if (currentFallback === model) {
        setFallback(next.length === 1 ? next[0] : "");
      }
    } else {
      const next = [...current, model];
      setCurrent(next);
      if (!currentFallback) setFallback(model);
    }
  }

  function addManualModels(
    input: string,
    current: string[],
    setCurrent: (v: string[]) => void,
    setFallback: (v: string) => void,
    currentFallback: string,
    setInput: (v: string) => void,
  ) {
    const newModels = normalizeModelList(input);
    if (newModels.length === 0) return;
    const combined = [...current];
    for (const model of newModels) {
      if (!combined.includes(model)) combined.push(model);
    }
    setCurrent(combined);
    if (!currentFallback && combined.length > 0) setFallback(combined[0]);
    setInput("");
  }

  function handleEditKey() {
    if (!data?.item || isDeleted) {
      return;
    }

    const models = parseAllowedModels(data.item);
    const preparedModels = models.length > 0 ? models : [data.item.fallback_model];
    setEditName(data.item.name);
    setEditAllowedModels(preparedModels);
    setEditFallbackModel(data.item.fallback_model);
    setEditManualModelInput("");
    setEditModelQuery("");
    setEditError("");
    setShowEditModal(true);
    void fetchModels();
  }

  async function handleSaveEdit() {
    if (!id || !data?.item) {
      return;
    }

    const nextName = editName.trim();
    if (!nextName) {
      setEditError("Name is required.");
      return;
    }
    if (editAllowedModels.length === 0) {
      setEditError("Select at least one model.");
      return;
    }
    if (editAllowedModels.length > MAX_ALLOWED_MODELS) {
      setEditError(`Maximum ${MAX_ALLOWED_MODELS} models allowed.`);
      return;
    }
    if (!editFallbackModel || !editAllowedModels.includes(editFallbackModel)) {
      setEditError("Please select a fallback model from the allowed models.");
      return;
    }

    try {
      const response = await apiClient.patch<{ item: ApiKeyItem }>(`/keys/${id}`, {
        name: nextName,
        allowed_models: editAllowedModels,
        fallback_model: editFallbackModel,
      });

      setData((prev) => {
        if (!prev) {
          return prev;
        }
        return { ...prev, item: response.data.item };
      });
      setShowEditModal(false);
      setEditError("");

      await loadStats();
      resetRefreshTimer();
    } catch (error) {
      if (isPermissionDeniedError(error)) {
        setShowPermissionDenied(true);
      } else {
        setEditError("Failed to update key. Please try again.");
      }
    }
  }

  async function handleDeleteKey() {
    if (!id) return;
    try {
      await apiClient.delete(`/keys/${id}`);
      setShowDeleteConfirm(false);
      handleBack();
    } catch (error) {
      setShowDeleteConfirm(false);
      if (isPermissionDeniedError(error)) {
        setShowPermissionDenied(true);
      }
    }
  }

  async function handleTimeWindowChange(nextWindow: TimeWindowValue) {
    setTimeWindow(nextWindow);
    resetRefreshTimer();
    try {
      await saveTimeWindowPreference("key_detail_time_window", nextWindow);
    } catch {
      // Keep the selected window locally even if persistence fails.
    }
  }

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
  const detailModels = data?.item ? parseAllowedModels(data.item) : [];
  const detailFallbackModel = data?.item?.fallback_model ?? "";
  const detailOtherModels = detailModels.filter((model) => model !== detailFallbackModel);

  // Build model selector options: Total first, then fallback, then other allowed models
  const modelSelectorOptions = useMemo((): Array<{ value: string; label: string }> => {
    if (!data?.item) return [{ value: "total", label: "Total Requests" }];
    const models = parseAllowedModels(data.item);
    const fallback = data.item.fallback_model;
    const others = models.filter((m) => m !== fallback);
    return [
      { value: "total", label: "Total Requests" },
      { value: fallback, label: `${fallback} (fallback)` },
      ...others.map((m) => ({ value: m, label: m })),
    ];
  }, [data]);

  const modelAvailable = selectedModel === "total" || Boolean(data?.request_timeline_by_model?.[selectedModel]);
  const effectiveModel = modelAvailable ? selectedModel : "total";
  const isTotal = effectiveModel === "total";
  const latencyChartData = isTotal ? (data?.timeline ?? []) : (data?.response_timeline_by_model[effectiveModel] ?? []);
  const latencyDataKeys = isTotal
    ? [
        { key: "avgProxyTime", color: "#34d399", label: "Proxy Latency" },
        { key: "avgResponseTime", color: "#60a5fa", label: "Response Time" },
      ]
    : [{ key: "avgResponseTime", color: "#60a5fa", label: "Response Time" }];
  const successChartData = isTotal ? (data?.timeline ?? []) : (data?.success_timeline_by_model[effectiveModel] ?? []);

  const requestChartSeries = useMemo(() => {
    const timeline = data?.timeline ?? [];
    const modelCandidates = detailModels.filter((model) => Boolean(data?.request_timeline_by_model?.[model]));
    const modelEntries = modelCandidates.map((model, index) => ({
      model,
      dataKey: `model_${index}`,
      color: REQUEST_MODEL_COLORS[index % REQUEST_MODEL_COLORS.length],
      map: new Map((data?.request_timeline_by_model?.[model] ?? []).map((point) => [point.bucket, point.calls] as const)),
    }));

    const mergedData = timeline.map((point) => {
      const row: Record<string, string | number> = {
        bucket: point.bucket,
        calls: point.calls,
      };
      for (const entry of modelEntries) {
        row[entry.dataKey] = entry.map.get(point.bucket) ?? 0;
      }
      return row;
    });

    return {
      data: mergedData,
      dataKeys: [
        { key: "calls", color: "#ff7a18", label: "Total Requests" },
        ...modelEntries.map((entry) => ({ key: entry.dataKey, color: entry.color, label: entry.model })),
      ],
    };
  }, [data, detailModels]);

  function renderModelSelector() {
    const selectableOptions = availableModels.filter((model) => !editAllowedModels.includes(model)).map(toModelOption);
    const fallbackOptions = editAllowedModels.map(toModelOption);
    const selectedFallback = fallbackOptions.find((option) => option.value === editFallbackModel) ?? null;
    const menuPortalTarget = typeof document === "undefined" ? undefined : document.body;

    return (
      <>
        <div>
          <label>Allowed Models</label>
          {availableModels.length > 0 ? (
            <div className="model-select-stack" data-testid="detail-edit-model-dropdown">
              <Select<ModelOption, false>
                inputId="detail-edit-model-picker"
                instanceId="detail-edit-model-picker"
                aria-label="Allowed models selector"
                options={selectableOptions}
                value={null}
                inputValue={editModelQuery}
                onInputChange={(value, actionMeta) => {
                  if (actionMeta.action === "input-change") {
                    setEditModelQuery(value);
                  }
                  if (actionMeta.action === "menu-close") {
                    setEditModelQuery("");
                  }
                }}
                onChange={(option: SingleValue<ModelOption>) => {
                  if (!option || editAllowedModels.length >= MAX_ALLOWED_MODELS) {
                    return;
                  }
                  addAllowedModel(option.value, editAllowedModels, setEditAllowedModels, setEditFallbackModel, editFallbackModel);
                  setEditModelQuery("");
                }}
                styles={modelSelectStyles}
                classNamePrefix="model-picker-select"
                placeholder={editAllowedModels.length >= MAX_ALLOWED_MODELS ? `Maximum ${MAX_ALLOWED_MODELS} models selected` : "Type to filter and add a model"}
                noOptionsMessage={() => {
                  if (editAllowedModels.length >= MAX_ALLOWED_MODELS) {
                    return `Maximum ${MAX_ALLOWED_MODELS} models selected`;
                  }
                  return editModelQuery.trim() ? "No matching models" : "No more models available";
                }}
                isClearable
                isDisabled={editAllowedModels.length >= MAX_ALLOWED_MODELS || selectableOptions.length === 0}
                menuPortalTarget={menuPortalTarget}
              />
              <p className="model-helper-text">Type to filter the available model IDs, then select one to add it below.</p>
            </div>
          ) : (
            <div>
              <textarea
                value={editManualModelInput}
                onChange={(event) => setEditManualModelInput(event.target.value)}
                placeholder="Enter model names, comma or newline separated"
                rows={3}
                data-testid="detail-edit-model-manual"
                className="model-textarea"
              />
              <button
                type="button"
                className="btn-sm secondary"
                onClick={() =>
                  addManualModels(
                    editManualModelInput,
                    editAllowedModels,
                    setEditAllowedModels,
                    setEditFallbackModel,
                    editFallbackModel,
                    setEditManualModelInput,
                  )
                }
                data-testid="detail-edit-model-add"
              >
                Add
              </button>
              <p className="model-helper-text">Upstream models are unavailable, so you can paste model IDs manually.</p>
            </div>
          )}
        </div>

        {editAllowedModels.length > 0 && (
          <div className="model-chips" data-testid="detail-edit-model-chips">
            {editAllowedModels.map((model) => (
              <span key={model} className="model-chip">
                <span>{model}</span>
                {model === editFallbackModel && <span className="model-chip-tag">fallback</span>}
                <button
                  type="button"
                  className="model-chip-remove"
                  onClick={() => toggleAllowedModel(model, editAllowedModels, setEditAllowedModels, setEditFallbackModel, editFallbackModel)}
                  aria-label={`Remove ${model}`}
                >
                  ×
                </button>
              </span>
            ))}
          </div>
        )}

        {editAllowedModels.length > 0 && (
          <div>
            <label htmlFor="detail-edit-fallback">Fallback Model</label>
            <div data-testid="detail-edit-fallback">
              <Select<ModelOption, false>
                inputId="detail-edit-fallback"
                instanceId="detail-edit-fallback"
                aria-label="Fallback model selector"
                options={editAllowedModels.map(toModelOption)}
                value={selectedFallback}
                onChange={(option: SingleValue<ModelOption>) => setEditFallbackModel(option?.value ?? "")}
                styles={modelSelectStyles}
                classNamePrefix="model-picker-select"
                placeholder="Select fallback model"
                isSearchable={false}
                isDisabled={editAllowedModels.length <= 1}
                menuPortalTarget={menuPortalTarget}
              />
            </div>
          </div>
        )}
      </>
    );
  }

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
              {data?.item.created_by_name && (
                <span>
                  <span style={{ color: "var(--muted)", fontSize: "0.8rem" }}>created by:</span> {data.item.created_by_name}
                  {data.item.created_by_email && (
                    <span style={{ color: "var(--muted)", fontSize: "0.8rem" }}> ({data.item.created_by_email})</span>
                  )}
                </span>
              )}
              <span>
                <span style={{ color: "var(--muted)", fontSize: "0.8rem" }}>created:</span> {formatDateTime(data?.item.created_at)}
              </span>
              <span>
                <span style={{ color: "var(--muted)", fontSize: "0.8rem" }}>last used:</span> {formatDateTime(data?.item.last_used_at)}
              </span>
              {isDeleted && (
                <span>
                  <span style={{ color: "var(--muted)", fontSize: "0.8rem" }}>deleted at:</span>{" "}
                  {formatDateTime(data?.item.deleted_at ?? data?.item.updated_at)}
                </span>
              )}
            </p>
            <p style={{ margin: "0.3rem 0 0", fontSize: "0.88rem", lineHeight: 1.5 }}>
              <span style={{ color: "var(--muted)", fontSize: "0.8rem" }}>models:</span>{" "}
              {data?.item ? (
                <span className="detail-model-list">
                  <span className="detail-model-chip">
                    <span>{detailFallbackModel}</span>
                    <span className="fallback-tag">fallback</span>
                  </span>
                  {detailOtherModels.map((model) => (
                    <span key={model} className="model-tag">{model}</span>
                  ))}
                </span>
              ) : null}
            </p>
          </div>
        </div>
        {!isDeleted && timeWindowReady && (
          <div className="key-detail-controls">
            <div className="segmented-control">
              {windows.map((w) => (
                <button key={w} className={w === timeWindow ? "active" : ""} onClick={() => void handleTimeWindowChange(w)}>
                  {w}
                </button>
              ))}
            </div>
            <div className="key-detail-actions-row">
              <button
                className="btn-icon-refresh"
                onClick={() => { void handleManualRefresh(); }}
                title="Refresh"
                aria-label="Refresh"
              >
                ↻
              </button>
              <button
                className="btn-action-text"
                onClick={handleEditKey}
                data-testid="detail-edit-key"
              >
                <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/>
                  <path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"/>
                </svg>
                Edit
              </button>
              <button
                className="btn-action-text danger"
                onClick={() => setShowDeleteConfirm(true)}
                data-testid="detail-delete-key"
              >
                <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <polyline points="3 6 5 6 21 6"/>
                  <path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6"/>
                  <path d="M10 11v6M14 11v6"/>
                  <path d="M9 6V4a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v2"/>
                </svg>
                Delete
              </button>
            </div>
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
        subtitle="Total requests plus per-model lines"
        data={requestChartSeries.data}
        timeWindow={timeWindow}
        dataKeys={requestChartSeries.dataKeys}
      />

      {/* Side-by-side: Avg Latency + Success Rate */}
      <div className="chart-row-split">
        <TimelineChart
          title="Avg Response Latency"
          subtitle={isTotal ? "Proxy latency vs total response time" : `Response time for ${effectiveModel}`}
          data={latencyChartData}
          timeWindow={timeWindow}
          dataKeys={latencyDataKeys}
          unit="ms"
          autoScaleMs
          selectorOptions={modelSelectorOptions.length > 1 ? modelSelectorOptions : undefined}
          selectorValue={effectiveModel}
          onSelectorChange={setSelectedModel}
        />
        <TimelineChart
          title="Success Rate"
          subtitle="Percentage of successful requests"
          data={successChartData}
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

      {/* Delete Confirmation Modal */}
      <Modal open={showDeleteConfirm} title="Delete API Key" onClose={() => setShowDeleteConfirm(false)}>
        <p>
          Are you sure you want to delete <strong>{data?.item.name}</strong>?
        </p>
        <p style={{ color: "var(--muted)", fontSize: "0.9rem" }}>
          The key will be deactivated and marked as deleted. Historical data will remain accessible.
        </p>
        <div style={{ display: "flex", gap: "0.75rem", marginTop: "1rem" }}>
          <button className="danger" onClick={() => void handleDeleteKey()} data-testid="confirm-delete">
            Delete
          </button>
          <button onClick={() => setShowDeleteConfirm(false)}>Cancel</button>
        </div>
      </Modal>

      {/* Edit Key Modal */}
      <Modal open={showEditModal} title="Edit API Key" onClose={() => setShowEditModal(false)}>
        <form
          className="key-form"
          onSubmit={(event) => {
            event.preventDefault();
            void handleSaveEdit();
          }}
        >
          <div>
            <label>API Key</label>
            <input value={data?.item.key_preview ?? ""} disabled />
          </div>
          <div>
            <label htmlFor="detail-edit-name">Name</label>
            <input
              id="detail-edit-name"
              value={editName}
              onChange={(event) => {
                setEditName(event.target.value);
                setEditError("");
              }}
              required
              data-testid="detail-edit-name"
            />
          </div>
          {renderModelSelector()}
          {editError && (
            <p className="callout callout-error" style={{ margin: 0 }}>
              {editError}
            </p>
          )}
          <button type="submit" data-testid="detail-edit-submit">
            Save
          </button>
        </form>
      </Modal>

      {/* Permission Denied Modal */}
      <Modal open={showPermissionDenied} title="Permission Denied" onClose={() => setShowPermissionDenied(false)}>
        <p>You don't have permission to complete this operation.</p>
        <button onClick={() => setShowPermissionDenied(false)} style={{ marginTop: "1rem" }}>
          OK
        </button>
      </Modal>
    </div>
  );
}
