import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { apiClient, type ApiKeyItem } from "../api/client";
import { KeyForm } from "../components/KeyForm";

interface CreateResponse {
  item: ApiKeyItem;
  rawKey: string;
}

export function KeysManage() {
  const [items, setItems] = useState<ApiKeyItem[]>([]);
  const [generatedKey, setGeneratedKey] = useState("");

  async function load() {
    const response = await apiClient.get<{ items: ApiKeyItem[] }>("/keys");
    setItems(response.data.items);
  }

  useEffect(() => {
    load();
  }, []);

  return (
    <div className="page-stack">
      <div className="hero-card slim">
        <div>
          <span className="eyebrow">Key Management</span>
          <h1>Issue, rotate and tune API keys</h1>
          <p>Create distinct policy buckets by key, each with its own forced Copilot model.</p>
        </div>
      </div>

      <div className="panel-grid">
        <div className="panel-card">
          <div className="section-head">
            <h3>Create a new key</h3>
            <p>The raw key is shown once after creation.</p>
          </div>
          <KeyForm
            onSubmit={async (payload) => {
              const response = await apiClient.post<CreateResponse>("/keys", payload);
              setGeneratedKey(response.data.rawKey);
              await load();
            }}
          />
          {generatedKey ? (
            <div className="callout" data-testid="generated-key">
              Generated key: {generatedKey}
            </div>
          ) : null}
        </div>

        <div className="panel-card">
          <div className="section-head">
            <h3>Existing keys</h3>
            <p>Inline edits are optimized for day-to-day operations.</p>
          </div>
          <div className="list-stack">
            {items.map((item) => (
              <article key={item.id} className="key-row" data-testid="key-row">
                <div>
                  <input
                    aria-label={`name-${item.id}`}
                    value={item.name}
                    onChange={(event) => {
                      setItems((current) => current.map((row) => (row.id === item.id ? { ...row, name: event.target.value } : row)));
                    }}
                  />
                  <p>{item.key_preview}</p>
                  <Link to={`/keys/${item.id}`}>Open dashboard</Link>
                </div>
                <input
                  aria-label={`model-${item.id}`}
                  value={item.model}
                  onChange={(event) => {
                    setItems((current) => current.map((row) => (row.id === item.id ? { ...row, model: event.target.value } : row)));
                  }}
                />
                <button
                  onClick={async () => {
                    await apiClient.patch(`/keys/${item.id}`, {
                      model: item.model,
                      name: item.name,
                      is_active: item.is_active,
                    });
                    await load();
                  }}
                >
                  Save
                </button>
                <button
                  onClick={async () => {
                    await apiClient.patch(`/keys/${item.id}`, {
                      is_active: item.is_active ? 0 : 1,
                    });
                    await load();
                  }}
                >
                  {item.is_active ? "Disable" : "Enable"}
                </button>
                <button
                  className="danger"
                  onClick={async () => {
                    await apiClient.delete(`/keys/${item.id}`);
                    await load();
                  }}
                >
                  Delete
                </button>
              </article>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}
