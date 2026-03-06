// Jest globalSetup: starts Mock Copilot Connect on :1289 before API integration tests run.
// Writes PID to a temp file so globalTeardown can kill the process.
const { spawn } = require("child_process");
const path = require("path");
const fs = require("fs");
const http = require("http");

const PID_FILE = path.join(__dirname, ".mock-copilot.pid");
const MOCK_PORT = 1289;
const MOCK_DIR = path.resolve(__dirname, "../../mockCopilot");

function waitForPort(port, retries = 20, delayMs = 200) {
  return new Promise((resolve, reject) => {
    let attempts = 0;
    function tryConnect() {
      const req = http.get(`http://127.0.0.1:${port}/health`, (res) => {
        if (res.statusCode === 200) return resolve();
        retry();
      });
      req.on("error", retry);
      req.end();
    }
    function retry() {
      attempts += 1;
      if (attempts >= retries) return reject(new Error(`Mock Copilot not ready after ${retries} attempts`));
      setTimeout(tryConnect, delayMs);
    }
    tryConnect();
  });
}

module.exports = async function globalSetup() {
  const proc = spawn("node", ["server.js"], {
    cwd: MOCK_DIR,
    env: { ...process.env, PORT: String(MOCK_PORT) },
    detached: true,
    stdio: "ignore",
  });
  proc.unref();
  fs.writeFileSync(PID_FILE, String(proc.pid));
  await waitForPort(MOCK_PORT);
  console.log(`[globalSetup] Mock Copilot Connect started (pid=${proc.pid}) on :${MOCK_PORT}`);
};
