import { Request, Response, NextFunction } from "express";

export interface AdminUser {
  name: string;
  email: string;
}

/**
 * Local admin user identity used in non-production environments.
 * This is a mutable export to allow tests to override it.
 */
export const LOCAL_ADMIN_USER: AdminUser = {
  name: "Local",
  email: "admin@localhost.com",
};

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
 *   NODE_ENV !== "production" → uses LOCAL_ADMIN_USER (development/tests)
 *   NODE_ENV === "production" → requires CF-Access-JWT-Assertion header; user extracted from JWT
 */
export const cloudflareAuthMiddleware = (req: Request, res: Response, next: NextFunction) => {
  // Development/test: auto-pass with the current LOCAL_ADMIN_USER.
  if (process.env.NODE_ENV !== "production") {
    req.adminUser = LOCAL_ADMIN_USER;
    return next();
  }

  // Production: requires a valid Cloudflare Access JWT
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
