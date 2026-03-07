import { NavLink, Route, Routes } from "react-router-dom";
import { Dashboard } from "./pages/Dashboard";
import { KeysManage } from "./pages/KeysManage";
import { KeyDetail } from "./pages/KeyDetail";
import { Settings } from "./pages/Settings";

export default function App() {
  return (
    <div className="app-shell">
      <aside className="sidebar">
        <div>
          <span className="eyebrow">Copilot Proxy</span>
          <h2>Admin Console</h2>
        </div>
        <nav>
          <NavLink to="/" end>
            Dashboard
          </NavLink>
          <NavLink to="/keys">API Keys</NavLink>
          <NavLink to="/settings">Settings</NavLink>
        </nav>
      </aside>
      <main className="content-shell">
        <Routes>
          <Route path="/" element={<Dashboard />} />
          <Route path="/keys" element={<KeysManage />} />
          <Route path="/keys/:id" element={<KeyDetail />} />
          <Route path="/settings" element={<Settings />} />
        </Routes>
      </main>
    </div>
  );
}
