// Playwright globalTeardown: switches CopilotConnect back to bridge mode after e2e tests complete.
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

module.exports = async function globalTeardown() {
  try {
    await httpPost(COPILOT_URL, { mode: "bridge" });
    console.log(`[globalTeardown] CopilotConnect restored to bridge mode at ${COPILOT_URL}`);
  } catch (err) {
    console.warn(`[globalTeardown] Warning: failed to restore bridge mode: ${err.message}`);
  }
};
