import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

const adminPort = process.env.ADMIN_PORT || "8020";

export default defineConfig({
  plugins: [react()],
  // Development: only localhost / 127.0.0.1 on port 3020
  server: {
    host: "127.0.0.1",
    port: 3020,
    allowedHosts: ["localhost", "127.0.0.1"],
    proxy: {
      "/api/admin": {
        target: `http://127.0.0.1:${adminPort}`,
        changeOrigin: true,
      },
    },
  },
  // Production (vite preview): only copilot.tarch.ca; tunnel connects to 127.0.0.1:3020
  preview: {
    host: "127.0.0.1",
    port: 3020,
    allowedHosts: ["copilot.tarch.ca"],
    proxy: {
      "/api/admin": {
        target: `http://127.0.0.1:${adminPort}`,
        changeOrigin: true,
      },
    },
  },
});
