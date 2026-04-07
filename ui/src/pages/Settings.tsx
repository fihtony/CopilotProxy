import { useEffect, useState } from "react";
import { apiClient, type SettingsResponse, type HealthCheckResponse, type AutoRefreshInterval } from "../api/client";
import { Modal } from "../components/Modal";
import { isPermissionDeniedError } from "../utils/errorHandler";

export function Settings() {
  const [url, setUrl] = useState("");
  const [defaultModel, setDefaultModel] = useState("");
  const [models, setModels] = useState<string[]>([]);
  const [testResult, setTestResult] = useState<HealthCheckResponse | null>(null);
  const [testing, setTesting] = useState(false);
  const [autoRefreshInterval, setAutoRefreshInterval] = useState<AutoRefreshInterval>("30");
  const [loadError, setLoadError] = useState<string | null>(null);
  const [savingSettings, setSavingSettings] = useState(false);
  const [settingsSaveError, setSettingsSaveError] = useState<string | null>(null);
  const [settingsSaved, setSettingsSaved] = useState(false);
  const [savingAutoRefresh, setSavingAutoRefresh] = useState(false);
  const [autoRefreshSaveError, setAutoRefreshSaveError] = useState<string | null>(null);
  const [autoRefreshSaved, setAutoRefreshSaved] = useState(false);
  const [initialUrl, setInitialUrl] = useState("");
  const [initialModel, setInitialModel] = useState("");
  const [initialAutoRefresh, setInitialAutoRefresh] = useState<AutoRefreshInterval>("30");

  // Permission denied modal
  const [showPermissionDenied, setShowPermissionDenied] = useState(false);

  useEffect(() => {
    let cancelled = false;

    apiClient
      .get<SettingsResponse>("/settings")
      .then((r) => {
        if (cancelled) {
          return;
        }

        setLoadError(null);
        setUrl(r.data.copilot_url);
        setDefaultModel(r.data.default_model);
        setAutoRefreshInterval(r.data.auto_refresh_interval ?? "30");
        setInitialUrl(r.data.copilot_url);
        setInitialModel(r.data.default_model);
        setInitialAutoRefresh(r.data.auto_refresh_interval ?? "30");
      })
      .catch(() => {
        if (cancelled) {
          return;
        }

        setLoadError("Failed to load settings. Refresh the page and try again.");
      });

    return () => {
      cancelled = true;
    };
  }, []);

  const isSettingsDirty = url !== initialUrl || defaultModel !== initialModel;
  const isAutoRefreshDirty = autoRefreshInterval !== initialAutoRefresh;

  function handleUrlChange(v: string) {
    setUrl(v);
    // Reset models when URL changes so user re-fetches from new endpoint
    if (models.length > 0) {
      setModels([]);
      setTestResult(null);
    }
  }

  async function getModels() {
    setTestResult(null);
    setModels([]);
    setTesting(true);
    try {
      const r = await apiClient.post<HealthCheckResponse>("/health/copilot", { copilot_url: url });
      setTestResult(r.data);
      if (r.data.models) setModels(r.data.models);
    } catch {
      setTestResult({ ok: false });
    } finally {
      setTesting(false);
    }
  }

  async function saveSettings() {
    setSavingSettings(true);
    setSettingsSaved(false);
    setSettingsSaveError(null);

    try {
      await apiClient.put("/settings", { copilot_url: url, default_model: defaultModel });
      setInitialUrl(url);
      setInitialModel(defaultModel);
      setSettingsSaved(true);
      setTimeout(() => setSettingsSaved(false), 3000);
    } catch (error) {
      if (isPermissionDeniedError(error)) {
        setShowPermissionDenied(true);
      } else {
        setSettingsSaveError("Failed to save settings. Please try again.");
      }
    } finally {
      setSavingSettings(false);
    }
  }

  async function saveAutoRefreshSettings() {
    setSavingAutoRefresh(true);
    setAutoRefreshSaved(false);
    setAutoRefreshSaveError(null);

    try {
      await apiClient.put("/settings", { auto_refresh_interval: autoRefreshInterval });
      setInitialAutoRefresh(autoRefreshInterval);
      setAutoRefreshSaved(true);
      setTimeout(() => setAutoRefreshSaved(false), 3000);
    } catch (error) {
      if (isPermissionDeniedError(error)) {
        setShowPermissionDenied(true);
      } else {
        setAutoRefreshSaveError("Failed to save auto-refresh settings. Please try again.");
      }
    } finally {
      setSavingAutoRefresh(false);
    }
  }

  return (
    <div className="page-stack">
      {loadError && (
        <div className="callout callout-error" data-testid="settings-load-error">
          {loadError}
        </div>
      )}

      <div className="hero-card slim">
        <div>
          <span className="eyebrow">Configuration</span>
          <h1>Settings</h1>
          <p>Configure the upstream Copilot Connect service and default model.</p>
        </div>
      </div>

      <div className="panel-card">
        <div className="section-head">
          <h3>Copilot Connect</h3>
        </div>
        <div className="settings-form">
          <label htmlFor="copilot-url">Backend URL</label>
          <div className="settings-url-input-wrap">
            <input
              id="copilot-url"
              value={url}
              onChange={(e) => handleUrlChange(e.target.value)}
              placeholder="http://127.0.0.1:1288"
              data-testid="settings-url"
            />
            <button type="button" onClick={getModels} disabled={!url.trim() || testing} data-testid="test-connection">
              {testing ? "Connecting…" : "Get Models"}
            </button>
          </div>
          {testResult && (
            <div className={`callout ${testResult.ok ? "" : "callout-error"}`} data-testid="test-result" style={{ marginTop: "0.5rem" }}>
              {testResult.ok ? `Connected in ${testResult.latencyMs}ms — ${models.length} model(s) available` : "Connection failed"}
            </div>
          )}

          <div>
            <label htmlFor="default-model">Default Model</label>
            {models.length > 0 ? (
              <select
                id="default-model"
                value={defaultModel}
                onChange={(e) => setDefaultModel(e.target.value)}
                data-testid="settings-model"
              >
                {models.map((m) => (
                  <option key={m} value={m}>
                    {m}
                  </option>
                ))}
              </select>
            ) : (
              <input
                id="default-model"
                value={defaultModel}
                disabled
                placeholder="Click 'Get Models' to load available models"
                data-testid="settings-model"
              />
            )}
          </div>

          <div style={{ display: "flex", alignItems: "center", gap: "1rem" }}>
            <button type="button" onClick={() => void saveSettings()} disabled={savingSettings || !isSettingsDirty} data-testid="settings-save">
              {savingSettings ? "Saving…" : "Save Settings"}
            </button>
            {settingsSaved && <span className="save-ok">Settings saved ✓</span>}
            {settingsSaveError && <span className="save-error">{settingsSaveError}</span>}
          </div>
        </div>
      </div>

      <div className="panel-card">
        <div className="section-head">
          <h3>Auto Refresh</h3>
        </div>
        <div className="settings-form">
          <label htmlFor="auto-refresh-interval">Refresh Interval</label>
          <select
            id="auto-refresh-interval"
            value={autoRefreshInterval}
            onChange={(e) => setAutoRefreshInterval(e.target.value as AutoRefreshInterval)}
            data-testid="settings-auto-refresh"
          >
            <option value="15">15 seconds</option>
            <option value="30">30 seconds</option>
            <option value="60">1 minute</option>
            <option value="180">3 minutes</option>
            <option value="300">5 minutes</option>
            <option value="900">15 minutes</option>
            <option value="1800">30 minutes</option>
            <option value="never">Never</option>
          </select>
          <p style={{ color: "var(--muted)", fontSize: "0.85rem", margin: 0 }}>
            Automatically refreshes the Dashboard and API Keys pages at this interval.
          </p>

          <div style={{ display: "flex", alignItems: "center", gap: "1rem" }}>
            <button
              type="button"
              onClick={() => void saveAutoRefreshSettings()}
              disabled={savingAutoRefresh || !isAutoRefreshDirty}
              data-testid="settings-auto-refresh-save"
            >
              {savingAutoRefresh ? "Saving…" : "Save Auto Refresh"}
            </button>
            {autoRefreshSaved && <span className="save-ok">Auto-refresh settings saved ✓</span>}
            {autoRefreshSaveError && <span className="save-error">{autoRefreshSaveError}</span>}
          </div>
        </div>
      </div>

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
