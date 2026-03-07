import { useEffect, useState } from "react";
import { apiClient, type SettingsResponse, type HealthCheckResponse } from "../api/client";

export function Settings() {
  const [url, setUrl] = useState("");
  const [defaultModel, setDefaultModel] = useState("");
  const [models, setModels] = useState<string[]>([]);
  const [testResult, setTestResult] = useState<HealthCheckResponse | null>(null);
  const [testing, setTesting] = useState(false);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [initialUrl, setInitialUrl] = useState("");
  const [initialModel, setInitialModel] = useState("");

  useEffect(() => {
    apiClient.get<SettingsResponse>("/settings").then((r) => {
      setUrl(r.data.copilot_url);
      setDefaultModel(r.data.default_model);
      setInitialUrl(r.data.copilot_url);
      setInitialModel(r.data.default_model);
    });
  }, []);

  const isDirty = url !== initialUrl || defaultModel !== initialModel;

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

  async function save() {
    setSaving(true);
    setSaved(false);
    await apiClient.put("/settings", { copilot_url: url, default_model: defaultModel });
    setSaving(false);
    setSaved(true);
    setInitialUrl(url);
    setInitialModel(defaultModel);
    setTimeout(() => setSaved(false), 3000);
  }

  return (
    <div className="page-stack">
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
            <button type="button" onClick={save} disabled={saving || !isDirty} data-testid="settings-save">
              {saving ? "Saving…" : "Save Settings"}
            </button>
            {saved && <span className="save-ok">Settings saved ✓</span>}
          </div>
        </div>
      </div>
    </div>
  );
}
