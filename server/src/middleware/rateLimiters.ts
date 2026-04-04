import type { Request, Response } from "express";
import rateLimit from "express-rate-limit";

function numericEnv(name: string, fallback: number): number {
  const value = Number(process.env[name]);
  return Number.isFinite(value) && value > 0 ? value : fallback;
}

function extractClientKey(req: Request): string {
  const cfIp = typeof req.headers["cf-connecting-ip"] === "string" ? req.headers["cf-connecting-ip"].trim() : "";
  if (cfIp) {
    return `ip:${cfIp}`;
  }

  const forwarded = typeof req.headers["x-forwarded-for"] === "string" ? req.headers["x-forwarded-for"].split(",")[0].trim() : "";
  if (forwarded) {
    return `ip:${forwarded}`;
  }

  return `ip:${req.socket.remoteAddress ?? "unknown"}`;
}

function rateLimitHandler(_req: Request, res: Response) {
  res.status(429).json({ error: { message: "Rate limit exceeded" } });
}

const commonOptions = {
  windowMs: 60_000,
  standardHeaders: true,
  legacyHeaders: false,
  skip: () => process.env.NODE_ENV === "test",
  handler: rateLimitHandler,
};

export const adminRateLimit = rateLimit({
  ...commonOptions,
  max: numericEnv("ADMIN_RATE_LIMIT_PER_MINUTE", 60),
  keyGenerator: extractClientKey,
});

export const clientRateLimit = rateLimit({
  ...commonOptions,
  max: numericEnv("CLIENT_RATE_LIMIT_PER_MINUTE", 120),
  keyGenerator: (req) => (req.apiKey ? `key:${req.apiKey.id}` : extractClientKey(req)),
});