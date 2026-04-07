import { useEffect, useState, useCallback } from "react";
import { useNavigate } from "react-router-dom";
import { apiClient, type ApiKeyItem, type HealthCheckResponse, type SettingsResponse } from "../api/client";
import { Modal } from "../components/Modal";
import { formatDateTime } from "../utils/dateFormatter";
import { isPermissionDeniedError } from "../utils/errorHandler";

interface CreateResponse {
  item: ApiKeyItem;
  rawKey: string;
}

export function KeysManage() {
  const navigate = useNavigate();
  const [items, setItems] = useState<ApiKeyItem[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [search, setSearch] = useState("");
  const [sortBy, setSortBy] = useState("created_at");
  const [sortDir, setSortDir] = useState<"asc" | "desc">("desc");
  const [showDeleted, setShowDeleted] = useState(false);
  const [showCustomModel, setShowCustomModel] = useState(false);
  const [defaultModel, setDefaultModel] = useState("");

  // Create modal
  const [showCreate, setShowCreate] = useState(false);
  const [createName, setCreateName] = useState("");
  const [createModel, setCreateModel] = useState("");
  const [createError, setCreateError] = useState("");
  const [models, setModels] = useState<string[]>([]);
  const [createdKey, setCreatedKey] = useState("");
  const [copied, setCopied] = useState(false);

  // Edit modal
  const [editItem, setEditItem] = useState<ApiKeyItem | null>(null);
  const [editName, setEditName] = useState("");
  const [editModel, setEditModel] = useState("");

  // Delete modal
  const [deleteItem, setDeleteItem] = useState<ApiKeyItem | null>(null);

  // Permission denied modal
  const [showPermissionDenied, setShowPermissionDenied] = useState(false);

  // Restore scroll position on mount, and fetch default model for highlight
  useEffect(() => {
    let cancelled = false;

    window.scrollTo(0, 0);
    apiClient
      .get<SettingsResponse>("/settings")
      .then((r) => {
        if (cancelled) {
          return;
        }

        setDefaultModel(r.data.default_model);
      })
      .catch(() => {});

    return () => {
      cancelled = true;
    };
  }, []);

  const load = useCallback(async () => {
    setIsLoading(true);
    try {
      const response = await apiClient.get<{ items: ApiKeyItem[] }>(
        `/keys?search=${encodeURIComponent(search)}&sortBy=${sortBy}&sortDir=${sortDir}`,
      );
      setItems(response.data.items);
    } catch {
      // Keep the current list visible if a refresh fails.
    } finally {
      setIsLoading(false);
    }
  }, [search, sortBy, sortDir]);

  // Debounce the load call to avoid rapid-fire requests on every keystroke
  useEffect(() => {
    const t = setTimeout(load, 200);
    return () => clearTimeout(t);
  }, [load]);

  async function fetchModels(): Promise<string> {
    try {
      const s = await apiClient.get<SettingsResponse>("/settings");
      const r = await apiClient.post<HealthCheckResponse>("/health/copilot", { copilot_url: s.data.copilot_url });
      if (r.data.models) setModels(r.data.models);
      return s.data.default_model;
    } catch {
      return "";
    }
  }

  function openCreate() {
    setCreatedKey("");
    setCopied(false);
    setCreateName("");
    setCreateModel("");
    setCreateError("");
    setModels([]);
    setShowCreate(true);
    fetchModels().then((defaultModel) => {
      if (defaultModel) setCreateModel(defaultModel);
    });
  }

  function openEdit(item: ApiKeyItem) {
    setEditItem(item);
    setEditName(item.name);
    setEditModel(item.model);
    fetchModels();
  }

  async function handleCreate() {
    setCreateError("");
    // Client-side duplicate name check
    if (items.some((i) => !i.is_deleted && i.name.toLowerCase() === createName.trim().toLowerCase())) {
      setCreateError(`A key named "${createName}" already exists. Please choose a different name.`);
      return;
    }
    try {
      const r = await apiClient.post<CreateResponse>("/keys", { name: createName.trim(), model: createModel || undefined });
      setCreatedKey(r.data.rawKey);
    } catch (error) {
      if (isPermissionDeniedError(error)) {
        setShowPermissionDenied(true);
      } else {
        setCreateError("Failed to create key. Please try again.");
      }
    }
  }

  async function handleCopy() {
    await navigator.clipboard.writeText(createdKey);
    setCopied(true);
  }

  async function handleEdit() {
    if (!editItem) return;
    try {
      await apiClient.patch(`/keys/${editItem.id}`, { name: editName, model: editModel });
      setEditItem(null);
      await load();
    } catch (error) {
      if (isPermissionDeniedError(error)) {
        setShowPermissionDenied(true);
      }
    }
  }

  async function handleDelete() {
    if (!deleteItem) return;
    try {
      await apiClient.delete(`/keys/${deleteItem.id}`);
      setDeleteItem(null);
      await load();
    } catch (error) {
      if (isPermissionDeniedError(error)) {
        setShowPermissionDenied(true);
      }
    }
  }

  function handleSort(col: string) {
    if (sortBy === col) {
      setSortDir((d) => (d === "asc" ? "desc" : "asc"));
    } else {
      setSortBy(col);
      setSortDir("desc");
    }
  }

  function sortIcon(col: string) {
    if (sortBy !== col) return <span className="sort-icon sort-inactive">⇅</span>;
    return sortDir === "asc" ? <span className="sort-icon sort-active">↑</span> : <span className="sort-icon sort-active">↓</span>;
  }

  const visibleItems = (showDeleted ? items : items.filter((i) => !i.is_deleted)).filter(
    (i) => !showCustomModel || (defaultModel && i.model !== defaultModel),
  );

  return (
    <div className="page-stack">
      <div className="hero-card">
        <div>
          <span className="eyebrow">Key Management</span>
          <h1>API Keys</h1>
          <p>Create distinct policy buckets by key, each with its own forced Copilot model.</p>
        </div>
        <button onClick={openCreate} data-testid="open-create">
          Create New Key
        </button>
      </div>

      <div className="table-card">
        <div className="section-head">
          <h3>Existing Keys</h3>
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
              <th className="sortable" onClick={() => handleSort("created_at")}>
                Created{sortIcon("created_at")}
              </th>
              <th className="sortable" onClick={() => handleSort("last_used_at")}>
                Last Used{sortIcon("last_used_at")}
              </th>
              <th>Actions</th>
            </tr>
          </thead>
          <tbody>
            {visibleItems.map((item) => (
              <tr
                key={item.id}
                className={item.is_deleted ? "key-deleted" : "clickable-row"}
                data-testid="key-row"
                onClick={() => {
                  sessionStorage.setItem("keysManageScrollPos", String(window.scrollY));
                  navigate(`/keys/${item.id}`);
                }}
              >
                <td>
                  <span style={{ display: "flex", alignItems: "center", gap: "0.5rem" }}>
                    {item.name}
                    {item.is_deleted === 1 && <span className="badge-deleted">Deleted</span>}
                  </span>
                </td>
                <td>{item.key_preview}</td>
                <td>
                  <span className={defaultModel && item.model !== defaultModel ? "model-custom" : ""}>{item.model}</span>
                </td>
                <td>{formatDateTime(item.created_at)}</td>
                <td>{formatDateTime(item.last_used_at)}</td>
                <td onClick={(e) => e.stopPropagation()}>
                  {!item.is_deleted && (
                    <button className="btn-sm secondary" onClick={() => openEdit(item)} data-testid="edit-key">
                      Edit
                    </button>
                  )}
                  {!item.is_deleted && (
                    <button className="btn-sm danger" onClick={() => setDeleteItem(item)} data-testid="delete-key">
                      Delete
                    </button>
                  )}
                  <button className="btn-sm secondary" onClick={() => navigate(`/keys/${item.id}`)} data-testid="view-dashboard">
                    Dashboard
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        {visibleItems.length === 0 && <p className="empty-state">No API keys yet.</p>}
      </div>

      {/* Create Key Modal */}
      <Modal
        open={showCreate}
        title="Create New API Key"
        onClose={() => {
          setShowCreate(false);
          if (createdKey) load();
        }}
      >
        {!createdKey ? (
          <form
            className="key-form"
            onSubmit={(e) => {
              e.preventDefault();
              handleCreate();
            }}
          >
            <div>
              <label htmlFor="create-name">Name</label>
              <input
                id="create-name"
                value={createName}
                onChange={(e) => {
                  setCreateName(e.target.value);
                  setCreateError("");
                }}
                required
                data-testid="create-name"
              />
            </div>
            <div>
              <label htmlFor="create-model">Model</label>
              {models.length > 0 ? (
                <select
                  id="create-model"
                  value={createModel}
                  onChange={(e) => setCreateModel(e.target.value)}
                  data-testid="create-model"
                  className="model-select"
                >
                  {models.map((m) => (
                    <option key={m} value={m}>
                      {m}
                    </option>
                  ))}
                </select>
              ) : (
                <input
                  id="create-model"
                  value={createModel}
                  onChange={(e) => setCreateModel(e.target.value)}
                  placeholder="gpt-5-mini"
                  data-testid="create-model"
                />
              )}
            </div>
            {createError && (
              <p className="callout callout-error" style={{ margin: 0 }}>
                {createError}
              </p>
            )}
            <button type="submit" data-testid="create-submit">
              Create
            </button>
          </form>
        ) : (
          <div>
            <p>
              Your new API key (shown <strong>only once</strong>):
            </p>
            <div className="callout key-display" data-testid="generated-key">
              <code>{createdKey}</code>
              <button className="btn-sm" onClick={handleCopy} data-testid="copy-key">
                {copied ? "Copied ✓" : "Copy"}
              </button>
            </div>
            <button
              onClick={() => {
                setShowCreate(false);
                load();
              }}
              style={{ marginTop: "1rem" }}
            >
              Done
            </button>
          </div>
        )}
      </Modal>

      {/* Edit Key Modal */}
      <Modal open={!!editItem} title="Edit API Key" onClose={() => setEditItem(null)}>
        <form
          className="key-form"
          onSubmit={(e) => {
            e.preventDefault();
            handleEdit();
          }}
        >
          <div>
            <label>API Key</label>
            <input value={editItem?.key_preview ?? ""} disabled />
          </div>
          <div>
            <label htmlFor="edit-name">Name</label>
            <input id="edit-name" value={editName} onChange={(e) => setEditName(e.target.value)} required data-testid="edit-name" />
          </div>
          <div>
            <label htmlFor="edit-model">Model</label>
            {models.length > 0 ? (
              <select
                id="edit-model"
                value={editModel}
                onChange={(e) => setEditModel(e.target.value)}
                data-testid="edit-model"
                className="model-select"
              >
                {models.map((m) => (
                  <option key={m} value={m}>
                    {m}
                  </option>
                ))}
              </select>
            ) : (
              <input id="edit-model" value={editModel} onChange={(e) => setEditModel(e.target.value)} data-testid="edit-model" />
            )}
          </div>
          <button type="submit" data-testid="edit-submit">
            Save
          </button>
        </form>
      </Modal>

      {/* Delete Confirmation Modal */}
      <Modal open={!!deleteItem} title="Delete API Key" onClose={() => setDeleteItem(null)}>
        <p>
          Are you sure you want to delete <strong>{deleteItem?.name}</strong>?
        </p>
        <p style={{ color: "var(--muted)", fontSize: "0.9rem" }}>
          The key will be deactivated and marked as deleted. Historical data will remain accessible.
        </p>
        <div style={{ display: "flex", gap: "0.75rem", marginTop: "1rem" }}>
          <button className="danger" onClick={handleDelete} data-testid="confirm-delete">
            Delete
          </button>
          <button onClick={() => setDeleteItem(null)}>Cancel</button>
        </div>
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
