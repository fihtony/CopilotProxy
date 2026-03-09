/**
 * Cloudflare Authentication & Admin Middleware Tests
 *
 * Tests the JWT extraction logic and middleware behavior for the admin app /api/* routes.
 * - extractUserFromJwt(): Unit tests for JWT payload decoding
 * - cloudflareAuthMiddleware: Integration tests for Cloudflare Access integration
 *
 * In development (NODE_ENV !== "production"):
 *   - Middleware attaches LOCAL_ADMIN_USER: { name: "Local", email: "admin@localhost.com" }
 *   - Tests override to { name: "Test User", email: "test@localhost.com" } in beforeAll()
 *
 * In production (NODE_ENV === "production"):
 *   - Middleware requires CF-Access-JWT-Assertion header
 *   - JWT is decoded (without sig verification — CF validates at edge)
 *   - User extracted from JWT payload: { name, email }
 */

import { extractUserFromJwt, LOCAL_ADMIN_USER } from "../../server/src/middleware/cloudflareAuth.js";
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
    expect(user.email).toBe("alice@example.com");
    expect(user.name).toBe("Alice Smith");
  });

  it("falls back to email prefix when name is absent", () => {
    const jwt = makeJwt({ email: "bob@example.com" });
    const user = extractUserFromJwt(jwt);
    expect(user.email).toBe("bob@example.com");
    expect(user.name).toBe("bob");
  });

  it("falls back to email prefix when name is empty string", () => {
    const jwt = makeJwt({ email: "carol@example.com", name: "" });
    const user = extractUserFromJwt(jwt);
    expect(user.name).toBe("carol");
  });

  it("returns Unknown / unknown@localhost for wrong JWT segment count", () => {
    const user = extractUserFromJwt("not.a.valid.jwt.at.all");
    expect(user.name).toBe("Unknown");
    expect(user.email).toBe("unknown@localhost");
  });

  it("returns Unknown / unknown@localhost for a non-JSON payload", () => {
    const user = extractUserFromJwt("header.!!!.sig");
    expect(user.name).toBe("Unknown");
    expect(user.email).toBe("unknown@localhost");
  });

  it("returns unknown@localhost when email field is missing", () => {
    const jwt = makeJwt({ sub: "user-id-123" });
    const user = extractUserFromJwt(jwt);
    expect(user.email).toBe("unknown@localhost");
    expect(user.name).toBe("unknown");
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
    const res = await request(app).post("/api/admin/keys").send({ name: "CF Auth Test Key", model: "gpt-5-mini" }).expect(201);

    expect(res.body.item.created_by_name).toBe("Test User");
    expect(res.body.item.created_by_email).toBe("test@localhost.com");
  });
});
