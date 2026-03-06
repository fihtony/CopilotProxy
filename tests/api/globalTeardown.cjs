// Jest globalTeardown: kills the Mock Copilot Connect process started by globalSetup.
const fs = require("fs");
const path = require("path");

const PID_FILE = path.join(__dirname, ".mock-copilot.pid");

module.exports = async function globalTeardown() {
  if (!fs.existsSync(PID_FILE)) return;
  const pid = Number(fs.readFileSync(PID_FILE, "utf8").trim());
  try {
    process.kill(pid, "SIGTERM");
    console.log(`[globalTeardown] Stopped Mock Copilot Connect (pid=${pid})`);
  } catch {
    // Process may have already exited.
  }
  fs.unlinkSync(PID_FILE);
};
