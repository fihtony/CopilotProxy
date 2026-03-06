import type { AuthenticatedApiKey } from "./types.js";

declare global {
  namespace Express {
    interface Request {
      apiKey?: AuthenticatedApiKey;
    }
  }
}

export {};
