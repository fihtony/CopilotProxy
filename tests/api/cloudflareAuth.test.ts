/**
 * Cloudflare Authentication & Admin Middleware Tests
 *
 * Tests the JWT extraction logic and middleware behavior for the admin app /api/* routes.
 * - extractUserFromJwt(): Unit tests for JWT payload decoding
 * - readLocalBypassAllowed(): Unit tests for the .env file bypass check
 * - cloudflareAuthMiddleware: Integration tests for Cloudflare Access integration
 *
 * Bypass behaviour (readLocalBypassAllowed):
 *   NODE_ENV === "test"        → always true (automated tests never need a .env)
 *   NODE_ENV === "production"  → always false (no bypass path exists)
 *   NODE_ENV === "development" → true only when .env file contains LOCAL_BYPASS_OAUTH_ALLOWED=true
 *
 * In test environment (NODE_ENV === "test"):
 *   - Middleware attaches LOCAL_ADMIN_USER: { name: "Local", email: "admin@localhost.com" }
 *   - Tests override to { name: "Test User", email: "test@localhost.com" } in beforeAll()
 */

import { extractUserFromJwt, readLocalBypassAllowed, LOCAL_ADMIN_USER } from "../../server/src/middleware/cloudflareAuth.js";
import request from "supertest";
import { createApp } from "../../server/src/app.js";

// ── Unit tests: extractUserFromJwt ──────────────────────────────────────────

describe("extractUserFromJwt", () => {
  function makeJwt(payload: Record<string, unknown>): string {
    const header = Buffer.from(JSON.stringify({ alg: "RS256", typ: "JWT" })).toString("base64url");
    const body = Buffer.from(JSON.stringify(payload)).toString("base64url");
    return `${header}.${body}.fakesig`;
  }

  it("extracts email and name from a CF Access JWT payload", () => {
    const jwt = makeJwt({ email: "alice@example.com", name: "Alice Smith" });
    const user = extractUserFromJwt(jwt);
    expect(user).not.toBeNull();
    expect(user!.email).toBe("alice@example.com");
    expect(user!.name).toBe("Alice Smith");
  });

  it("falls back to email prefix when name is absent", () => {
    const jwt = makeJwt({ email: "bob@example.com" });
    const user = extractUserFromJwt(jwt);
    expect(user).not.toBeNull();
    expect(user!.email).toBe("bob@example.com");
    expect(user!.name).toBe("bob");
  });

  it("falls back to email prefix when name is empty string", () => {
    const jwt = makeJwt({ email: "carol@example.com", name: "" });
    const user = extractUserFromJwt(jwt);
    expect(user).not.toBeNull();
    expect(user!.name).toBe("carol");
  });

  it("returns Unknown / unknown@localhost for wrong JWT segment count", () => {
    const user = extractUserFromJwt("not.a.valid.jwt.at.all");
    expect(user).toBeNull();
  });

  it("returns Unknown / unknown@localhost for a non-JSON payload", () => {
    const user = extractUserFromJwt("header.!!!.sig");
    expect(user).toBeNull();
  });

  it("returns unknown@localhost when email field is missing", () => {
    const jwt = makeJwt({ sub: "user-id-123" });
    const user = extractUserFromJwt(jwt);
    expect(user).not.toBeNull();
    expect(user!.email).toBe("unknown@localhost");
    expect(user!.name).toBe("unknown");
  });
});

// ── Unit tests: readLocalBypassAllowed ──────────────────────────────────────

describe("readLocalBypassAllowed", () => {
  it("returns true in test environment (NODE_ENV === 'test') without any .env file", () => {
    // Tests always bypass auth so they can run without a .env file.
    expect(process.env.NODE_ENV).toBe("test");
    expect(readLocalBypassAllowed()).toBe(true);
  });
});

// ── Integration test: middleware uses LOCAL_ADMIN_USER in non-production ──

describe("cloudflareAuthMiddleware — predefined local user", () => {
  const app = createApp();

  beforeAll(() => {
    // Override LOCAL_ADMIN_USER for this suite.
    LOCAL_ADMIN_USER.name = "Test User";
    LOCAL_ADMIN_USER.email = "test@localhost.com";
  });

  afterAll(() => {
    LOCAL_ADMIN_USER.name = "Local";
    LOCAL_ADMIN_USER.email = "admin@localhost.com";
  });

  it("attaches test user via LOCAL_ADMIN_USER override when creating an API key", async () => {
    // In development/test (NODE_ENV !== production), middleware uses LOCAL_ADMIN_USER.
    const res = await request(app).post("/api/admin/keys").send({ name: "CF Auth Test Key", allowed_models: ["gpt-5-mini"], fallback_model: "gpt-5-mini" }).expect(201);

    expect(res.body.item.created_by_name).toBe("Test User");
    expect(res.body.item.created_by_email).toBe("test@localhost.com");
  });
});
