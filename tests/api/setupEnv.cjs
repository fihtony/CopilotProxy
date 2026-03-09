// Jest setupFiles: runs in each test worker process before test module imports.
// Sets COPILOT_URL so config.ts picks it up when first imported.
// Tests use CopilotConnect echo mode (port 1288) — no real Copilot tokens consumed.
process.env.COPILOT_URL = process.env.COPILOT_URL || "http://127.0.0.1:1288";
