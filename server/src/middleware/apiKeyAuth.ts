import type { NextFunction, Request, Response } from "express";
import { hashApiKey } from "../db/database.js";
import { getApiKeyAuthSnapshotByHash } from "../services/apiKeyCacheService.js";

export function apiKeyAuth(req: Request, res: Response, next: NextFunction) {
  const authHeader = req.headers.authorization;
  if (!authHeader?.startsWith("Bearer ")) {
    return res.status(401).json({ error: { message: "Missing Bearer API key" } });
  }

  const rawKey = authHeader.slice("Bearer ".length).trim();
  const keyHash = hashApiKey(rawKey);
  const snapshot = getApiKeyAuthSnapshotByHash(keyHash);
  if (!snapshot) {
    return res.status(401).json({ error: { message: "Invalid or inactive API key" } });
  }

  req.apiKey = {
    id: snapshot.apiKeyId,
    name: snapshot.name,
    keyPreview: snapshot.keyPreview,
    allowedModels: snapshot.allowedModels,
    fallbackModel: snapshot.fallbackModel,
  };

  next();
}
