import path from "node:path";
import dotenv from "dotenv";

dotenv.config();

const rootDir = path.resolve(process.cwd(), "..");

// Resolve database path: if relative, resolve from project root; if absolute, use as-is
function resolveDatabasePath(dbPath?: string): string {
  if (!dbPath) {
    return path.join(rootDir, "data", "copilot-proxy.db");
  }

  if (path.isAbsolute(dbPath)) {
    return dbPath;
  }

  // Relative path: resolve from project root
  return path.resolve(rootDir, dbPath);
}

export const config = {
  // Port 8020: Admin API (for the dashboard UI)
  adminPort: Number(process.env.ADMIN_PORT ?? 8020),
  // Port 8022: Client API (OpenAI-compatible proxy, requires API key)
  clientPort: Number(process.env.CLIENT_PORT ?? 8022),
  // Default points to real CopilotConnect (echo mode for dev/tests, bridge mode for production)
  copilotUrl: process.env.COPILOT_URL ?? "http://127.0.0.1:1288",
  databasePath: resolveDatabasePath(process.env.DATABASE_PATH),
  uiDistPath: path.join(rootDir, "ui", "dist"),
};
