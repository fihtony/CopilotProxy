import type { NextFunction, Request, Response } from "express";
import { getApiKeyByHash, hashApiKey } from "../db/database.js";

export function apiKeyAuth(req: Request, res: Response, next: NextFunction) {
  const authHeader = req.headers.authorization;
  if (!authHeader?.startsWith("Bearer ")) {
    return res.status(401).json({ error: { message: "Missing Bearer API key" } });
  }

  const rawKey = authHeader.slice("Bearer ".length).trim();
  const apiKey = getApiKeyByHash(hashApiKey(rawKey));
  if (!apiKey) {
    return res.status(401).json({ error: { message: "Invalid or inactive API key" } });
  }

  req.apiKey = {
    id: apiKey.id,
    name: apiKey.name,
    model: apiKey.model,
    keyPreview: apiKey.key_preview,
  };

  next();
}
