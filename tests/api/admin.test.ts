import request from "supertest";
import { createApp } from "../../server/src/app.js";

describe("admin routes", () => {
  const app = createApp();

  it("creates and lists api keys", async () => {
    const createResponse = await request(app).post("/api/keys").send({ name: "Test Key", model: "gpt-5-mini" }).expect(201);

    expect(createResponse.body.rawKey).toMatch(/^cps_/);

    const listResponse = await request(app).get("/api/keys").expect(200);
    expect(Array.isArray(listResponse.body.items)).toBe(true);
    expect(listResponse.body.items.some((item: { name: string }) => item.name === "Test Key")).toBe(true);
  });
});
