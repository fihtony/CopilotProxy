import type { AuthenticatedApiKey } from "./types.js";
import type { AdminUser } from "./middleware/cloudflareAuth.js";

declare global {
  namespace Express {
    interface Request {
      apiKey?: AuthenticatedApiKey;
      adminUser?: AdminUser;
    }
  }
}

export {};
