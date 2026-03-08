import express from "express";
import cors from "cors";
import morgan from "morgan";
import adminRouter from "./routes/admin.js";
import proxyRouter from "./routes/proxy.js";
import { cloudflareAuthMiddleware } from "./middleware/cloudflareAuth.js";

export function createApp() {
  const app = express();

  app.use(cors());
  // 10 MB covers large vision payloads (base64 images) and long conversation histories.
  app.use(express.json({ limit: "10mb" }));
  app.use(morgan("dev"));

  app.get("/health", (_req, res) => {
    res.json({ ok: true });
  });

  // Admin API: always run cloudflareAuthMiddleware.
  // In dev/test it attaches a predefined user; in production it validates the
  // CF-Access-JWT-Assertion header and extracts the user from the token.
  app.use("/admin/api", cloudflareAuthMiddleware, adminRouter);

  // Client API (no Cloudflare Access, uses API key auth instead)
  app.use("/v1", proxyRouter);

  return app;
}
