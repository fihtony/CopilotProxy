// Playwright globalSetup: switches CopilotConnect to echo mode before e2e tests run.
// Echo mode returns [Echo] <user message> responses without consuming real Copilot tokens.
// Requires CopilotConnect to be running on the configured port (default: 1288).
const http = require("http");

const COPILOT_URL = process.env.COPILOT_URL || "http://127.0.0.1:1288";

function parseUrl(urlStr) {
  const u = new URL(urlStr);
  return { host: u.hostname, port: parseInt(u.port || "80", 10) };
}

function httpPost(urlStr, body) {
  return new Promise((resolve, reject) => {
    const { host, port } = parseUrl(urlStr);
    const data = JSON.stringify(body);
    const req = http.request(
      {
        host,
        port,
        path: "/v1/mode",
        method: "POST",
        headers: { "Content-Type": "application/json", "Content-Length": Buffer.byteLength(data) },
      },
      (res) => {
        let raw = "";
        res.on("data", (c) => (raw += c));
        res.on("end", () => resolve({ status: res.statusCode, body: raw }));
      },
    );
    req.on("error", reject);
    req.write(data);
    req.end();
  });
}

function httpGet(urlStr, path) {
  return new Promise((resolve, reject) => {
    const { host, port } = parseUrl(urlStr);
    const req = http.request({ host, port, path, method: "GET" }, (res) => {
      let raw = "";
      res.on("data", (c) => (raw += c));
      res.on("end", () => resolve({ status: res.statusCode, body: raw }));
    });
    req.on("error", reject);
    req.end();
  });
}

module.exports = async function globalSetup() {
  // Verify CopilotConnect is reachable
  let health;
  try {
    health = await httpGet(COPILOT_URL, "/health");
  } catch (err) {
    throw new Error(
      `CopilotConnect is not reachable at ${COPILOT_URL}. ` +
        `Ensure VS Code with the CopilotConnect extension is running. ` +
        `Original error: ${err.message}`,
    );
  }

  if (health.status !== 200) {
    throw new Error(`CopilotConnect health check returned HTTP ${health.status}`);
  }

  // Switch to echo mode so tests don't consume real Copilot tokens
  try {
    const modeRes = await httpPost(COPILOT_URL, { mode: "echo" });
    if (modeRes.status !== 200) {
      console.warn(`[globalSetup] Warning: could not switch CopilotConnect to echo mode (HTTP ${modeRes.status})`);
    } else {
      console.log(`[globalSetup] CopilotConnect switched to echo mode at ${COPILOT_URL}`);
    }
  } catch (err) {
    console.warn(`[globalSetup] Warning: failed to switch to echo mode: ${err.message}`);
  }
};
