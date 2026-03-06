// Jest setupFiles: runs in each test worker process before test module imports.
// Sets COPILOT_URL so config.ts picks it up when first imported.
process.env.COPILOT_URL = "http://127.0.0.1:1289";
