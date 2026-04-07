import fs from "node:fs";
import path from "node:path";
import { Request, Response, NextFunction } from "express";

export interface AdminUser {
  name: string;
  email: string;
}

/**
 * Local admin user identity used in non-production environments when the
 * LOCAL_BYPASS_OAUTH_ALLOWED=true flag is present in the .env file.
 * This is a mutable export to allow tests to override it.
 */
export const LOCAL_ADMIN_USER: AdminUser = {
  name: "Local",
  email: "admin@localhost.com",
};

/**
 * Locate the .env file on disk. The server runs from the server/ subdirectory,
 * so the canonical .env lives one level up at the project root. The server/
 * directory itself is checked as a fallback for direct invocation (e.g. unit tests).
 */
function findEnvFilePath(): string | null {
  const candidates = [
    path.join(path.resolve(process.cwd(), ".."), ".env"), // project root when cwd=server/
    path.join(process.cwd(), ".env"), // server/ dir (when invoked from project root)
  ];
  for (const p of candidates) {
    if (fs.existsSync(p)) return p;
  }
  return null;
}

/**
 * Read LOCAL_BYPASS_OAUTH_ALLOWED directly from the .env file on every call.
 * No in-memory caching — the file is always read fresh from disk.
 *
 * Return value rules:
 *   - NODE_ENV === "production"  → always false; bypass is categorically forbidden.
 *   - NODE_ENV === "test"        → always true; automated tests bypass auth.
 *   - Otherwise (development)   → true only when the .env file explicitly contains
 *                                  LOCAL_BYPASS_OAUTH_ALLOWED=true.
 *
 * Setting the env var at the shell level (export LOCAL_BYPASS_OAUTH_ALLOWED=true) is
 * intentionally insufficient — it must be present in the .env file on disk.
 */
export function readLocalBypassAllowed(): boolean {
  // Production: no bypass path exists under any circumstances.
  if (process.env.NODE_ENV === "production") return false;

  // Automated tests: bypass without requiring a .env file.
  if (process.env.NODE_ENV === "test") return true;

  // Development: only bypass when the flag is explicitly written in the .env file.
  try {
    const envPath = findEnvFilePath();
    if (!envPath) return false;

    const content = fs.readFileSync(envPath, "utf8");
    for (const line of content.split("\n")) {
      const trimmed = line.trim();
      if (trimmed.startsWith("#") || !trimmed.includes("=")) continue;
      const eq = trimmed.indexOf("=");
      const key = trimmed.slice(0, eq).trim();
      // Strip optional surrounding quotes from the value.
      const value = trimmed
        .slice(eq + 1)
        .trim()
        .replace(/^["']|["']$/g, "");
      if (key === "LOCAL_BYPASS_OAUTH_ALLOWED") {
        return value.toLowerCase() === "true";
      }
    }
    return false;
  } catch {
    return false;
  }
}

/**
 * Decodes the payload of a Cloudflare Access JWT without signature verification.
 * Cloudflare validates the token at the edge; this reads user context from the
 * already-trusted payload.
 *
 * CF Access JWT payload fields used:
 *   email - user's email address
 *   name  - user's display name (optional; falls back to the local part of email)
 *   exp   - expiry timestamp (validated here as a defence-in-depth measure)
 *
 * TODO: Full RSA signature verification via JWKS requires:
 *   CF_TEAM_DOMAIN=<your-team>.cloudflareaccess.com
 *   CF_ACCESS_AUD=<application audience tag from CF Zero Trust dashboard>
 * Install the `jose` package and implement JWKS-based verification when those vars are set.
 */
export function extractUserFromJwt(jwt: string): AdminUser | null {
  const parts = jwt.split(".");
  if (parts.length !== 3) {
    return null;
  }
  try {
    const payloadJson = Buffer.from(parts[1], "base64url").toString("utf8");
    const payload = JSON.parse(payloadJson) as Record<string, unknown>;

    // Reject expired tokens even without full signature verification
    const now = Math.floor(Date.now() / 1000);
    if (typeof payload.exp === "number" && payload.exp < now) {
      return null;
    }

    const email = typeof payload.email === "string" && payload.email ? payload.email : "unknown@localhost";
    // CF Access does not always include a 'name' claim; fall back to email prefix
    const name = typeof payload.name === "string" && payload.name ? payload.name : email.split("@")[0];
    return { name, email };
  } catch {
    return null;
  }
}

/**
 * Cloudflare Access JWT Middleware
 *
 * Attaches `req.adminUser` with the authenticated user's name and email.
 *
 * Behavior by environment:
 *   NODE_ENV === "test"        → bypasses auth; attaches LOCAL_ADMIN_USER (automated tests)
 *   NODE_ENV !== "production"  → bypasses if .env file has LOCAL_BYPASS_OAUTH_ALLOWED=true;
 *                                otherwise requires CF-Access-JWT-Assertion
 *   NODE_ENV === "production"  → ALWAYS requires CF-Access-JWT-Assertion; no bypass possible
 */
export const cloudflareAuthMiddleware = (req: Request, res: Response, next: NextFunction) => {
  // Non-production with bypass flag in .env (or test mode): attach the local user and proceed.
  if (readLocalBypassAllowed()) {
    req.adminUser = LOCAL_ADMIN_USER;
    return next();
  }

  // Production (or dev without bypass): requires a valid Cloudflare Access JWT.
  const cfJwt = req.headers["cf-access-jwt-assertion"];

  if (!cfJwt) {
    return res.status(401).json({
      error: "Unauthorized",
      message: "Missing Cloudflare Access token",
      hint: "Request must come through Cloudflare Access",
    });
  }

  const user = extractUserFromJwt(String(cfJwt));
  if (!user) {
    return res.status(401).json({
      error: "Unauthorized",
      message: "Invalid or expired Cloudflare Access token",
    });
  }

  req.adminUser = user;
  next();
};

/**
 * Write-operation defense-in-depth guard.
 *
 * Applied to all mutation routes (POST, PATCH, DELETE, PUT) on the admin API.
 * On every write request in dev mode this re-reads the .env file to confirm
 * LOCAL_BYPASS_OAUTH_ALLOWED is still true. This prevents the scenario where
 * the flag was set when the server started but has since been removed from .env.
 *
 * In production: no-op — cloudflareAuthMiddleware already enforces CF JWT.
 * In test:       no-op — automated tests bypass auth entirely.
 */
export const requireLocalBypassForWrite = (req: Request, res: Response, next: NextFunction) => {
  if (process.env.NODE_ENV === "production" || process.env.NODE_ENV === "test") {
    return next();
  }

  // Dev mode: confirm .env still authorises the bypass before committing any mutation.
  if (!readLocalBypassAllowed()) {
    return res.status(403).json({
      error: "Forbidden",
      message: "Write operations require LOCAL_BYPASS_OAUTH_ALLOWED=true in .env while running in dev mode",
    });
  }
  next();
};
