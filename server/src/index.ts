import http from "node:http";
import { createAdminApp, createClientApp } from "./app.js";
import { config } from "./config.js";
import "./db/database.js";
import "./services/settingsService.js";

// Admin API server — port 8020 (dashboard UI → admin API)
const adminServer = http.createServer(createAdminApp());
adminServer.listen(config.adminPort, "127.0.0.1", () => {
  console.log(`Admin API server listening on http://127.0.0.1:${config.adminPort}`);
});

// Client API server — port 8022 (external clients → OpenAI-compatible proxy)
const clientServer = http.createServer(createClientApp());
clientServer.listen(config.clientPort, "127.0.0.1", () => {
  console.log(`Client API server listening on http://127.0.0.1:${config.clientPort}`);
});
