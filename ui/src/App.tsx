import { NavLink, Route, Routes } from "react-router-dom";
import { Overview } from "./pages/Overview";
import { KeysManage } from "./pages/KeysManage";
import { KeyDetail } from "./pages/KeyDetail";

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
            Overview
          </NavLink>
          <NavLink to="/keys">API Keys</NavLink>
        </nav>
      </aside>
      <main className="content-shell">
        <Routes>
          <Route path="/" element={<Overview />} />
          <Route path="/keys" element={<KeysManage />} />
          <Route path="/keys/:id" element={<KeyDetail />} />
        </Routes>
      </main>
    </div>
  );
}
