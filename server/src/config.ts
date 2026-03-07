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
  port: Number(process.env.PROXY_PORT ?? 3000),
  uiPort: Number(process.env.UI_PORT ?? 3001),
  // Default points to real Copilot Connect; set to :1289 to use Mock Copilot Connect.
  copilotUrl: process.env.COPILOT_URL ?? "http://127.0.0.1:1288",
  databasePath: resolveDatabasePath(process.env.DATABASE_PATH),
  uiDistPath: path.join(rootDir, "ui", "dist"),
};
