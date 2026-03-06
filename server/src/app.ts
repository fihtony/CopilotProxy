import express from "express";
import cors from "cors";
import morgan from "morgan";
import adminRouter from "./routes/admin.js";
import proxyRouter from "./routes/proxy.js";

export function createApp() {
  const app = express();

  app.use(cors());
  app.use(express.json({ limit: "2mb" }));
  app.use(morgan("dev"));

  app.get("/health", (_req, res) => {
    res.json({ ok: true });
  });

  app.use("/api", adminRouter);
  app.use("/v1", proxyRouter);

  return app;
}
