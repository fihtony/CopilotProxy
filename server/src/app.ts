import express from "express";
import cors from "cors";
import helmet from "helmet";
import morgan from "morgan";
import adminRouter from "./routes/admin.js";
import proxyRouter from "./routes/proxy.js";
import { cloudflareAuthMiddleware } from "./middleware/cloudflareAuth.js";
import { adminRateLimit } from "./middleware/rateLimiters.js";

/** Launch timestamp in YYYY/MM/DD HH:MM:SS format (local time), recorded once at module load time. */
const LAUNCH_TIME = formatDateTime(new Date());

/** Format a Date as YYYY/MM/DD HH:MM:SS (local time). Mirrors dateFormatter.ts in the UI. */
function formatDateTime(d: Date): string {
  const pad = (n: number) => String(n).padStart(2, "0");
  return (
    `${d.getFullYear()}/${pad(d.getMonth() + 1)}/${pad(d.getDate())}` +
    ` ${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`
  );
}

/** Allowed origins for the Admin API CORS policy.
 *  In production, only the UI origin (served by Cloudflare tunnel) may call admin routes.
 *  In dev/test, the Vite dev server on port 3020 is also allowed.
 */
function adminCorsOrigins(): string[] {
  const uiOrigin = process.env.UI_ORIGIN ?? "https://copilot.tarch.ca";
  if (process.env.NODE_ENV !== "production") {
    return [uiOrigin, "http://127.0.0.1:3020", "http://localhost:3020"];
  }
  return [uiOrigin];
}

/**
 * Admin app — port 8020
 * Routes: GET /health, /api/* (protected by cloudflareAuthMiddleware)
 */
export function createAdminApp() {
  const app = express();

  // Security headers first: CSP, HSTS, X-Frame-Options, etc.
  // This hardens the browser-facing surfaces and complements Cloudflare's edge headers.
  app.use(
    helmet({
      contentSecurityPolicy: {
        directives: {
          defaultSrc: ["'self'"],
          scriptSrc: ["'self'"],
          // 'unsafe-inline' required for recharts inline SVG styles
          styleSrc: ["'self'", "'unsafe-inline'"],
          connectSrc: ["'self'"],
          imgSrc: ["'self'", "data:"],
          fontSrc: ["'self'"],
          frameAncestors: ["'none'"],
        },
      },
      // Cloudflare handles HSTS at the edge; set it at app level too for defence in depth
      strictTransportSecurity: { maxAge: 31536000, includeSubDomains: true },
    }),
  );
  app.use(cors({ origin: adminCorsOrigins(), credentials: false }));
  app.use(express.json({ limit: "10mb" }));
  app.use(morgan("dev"));

  app.get("/health", (_req, res) => {
    res.json({ ok: true, launch_time: LAUNCH_TIME });
  });

  // Admin API: always run cloudflareAuthMiddleware.
  // In dev/test it attaches a predefined user; in production it validates the
  // CF-Access-JWT-Assertion header and extracts the user from the token.
  app.use("/api/admin", adminRateLimit, cloudflareAuthMiddleware, adminRouter);

  return app;
}

/**
 * Client app — port 8022
 * Routes: GET /health, /api/v1/* (requires API key auth)
 */
export function createClientApp() {
  const app = express();

  // Minimal security headers for the API surface (no CSP; clients are not browsers)
  app.use(helmet({ contentSecurityPolicy: false }));
  // Wide-open CORS: this is an OpenAI-compatible API requiring Bearer auth;
  // any client (browser app, server) may legitimately call it.
  app.use(cors());
  // 10 MB covers large vision payloads (base64 images) and long conversation histories.
  app.use(express.json({ limit: "10mb" }));
  app.use(morgan("dev"));

  app.get("/health", (_req, res) => {
    res.json({ ok: true, launch_time: LAUNCH_TIME });
  });

  // Client API (OpenAI-compatible proxy, requires API key authentication)
  app.use("/api/v1", proxyRouter);

  return app;
}

/**
 * Combined app for testing — mounts both admin and client routes on a single Express instance.
 * This avoids the need for two separate supertest instances in most automated tests.
 */
export function createApp() {
  const app = express();

  app.use(helmet({ contentSecurityPolicy: false }));
  app.use(cors());
  app.use(express.json({ limit: "10mb" }));
  app.use(morgan("dev"));

  app.get("/health", (_req, res) => {
    res.json({ ok: true, launch_time: LAUNCH_TIME });
  });

  app.use("/api/admin", adminRateLimit, cloudflareAuthMiddleware, adminRouter);
  app.use("/api/v1", proxyRouter);

  return app;
}
