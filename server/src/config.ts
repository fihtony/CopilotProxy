import path from "node:path";
import dotenv from "dotenv";

dotenv.config();

const rootDir = path.resolve(process.cwd(), "..");

export const config = {
  port: Number(process.env.PORT ?? 3000),
  uiPort: Number(process.env.UI_PORT ?? 3001),
  // Default points to real Copilot Connect; set to :1289 to use Mock Copilot Connect.
  copilotUrl: process.env.COPILOT_URL ?? "http://127.0.0.1:1288",
  databasePath: process.env.DATABASE_PATH ?? path.join(rootDir, "server", "data", "copilot-server.db"),
  uiDistPath: path.join(rootDir, "ui", "dist"),
};
