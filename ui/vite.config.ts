import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

const adminPort = process.env.ADMIN_PORT || "8020";
const previewSecurityHeaders = {
  "Content-Security-Policy":
    "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; connect-src 'self'; font-src 'self'; object-src 'none'; base-uri 'self'; form-action 'self'; frame-ancestors 'none'",
  "Referrer-Policy": "strict-origin-when-cross-origin",
  "X-Content-Type-Options": "nosniff",
  "X-Frame-Options": "DENY",
  "Permissions-Policy": "camera=(), microphone=(), geolocation=()",
  "Strict-Transport-Security": "max-age=31536000; includeSubDomains",
};

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
    headers: previewSecurityHeaders,
    proxy: {
      "/api/admin": {
        target: `http://127.0.0.1:${adminPort}`,
        changeOrigin: true,
      },
    },
  },
});
