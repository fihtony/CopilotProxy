import { defineConfig } from "@playwright/test";

export default defineConfig({
  testDir: ".",
  timeout: 60_000,
  workers: 1,
  globalSetup: "./globalSetup.cjs",
  globalTeardown: "./globalTeardown.cjs",
  use: {
    baseURL: "http://127.0.0.1:3020",
    trace: "retain-on-failure",
  },
  webServer: {
    command: "npm run dev",
    port: 3020,
    reuseExistingServer: !process.env.CI,
    timeout: 120_000,
  },
});
