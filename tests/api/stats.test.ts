import request from "supertest";
import { createApp } from "../../server/src/app.js";

describe("stats routes", () => {
  const app = createApp();

  it("records requests and exposes overview", async () => {
    const createResponse = await request(app).post("/api/keys").send({ name: "Stats Key", model: "gpt-5-mini" }).expect(201);

    await request(app)
      .post("/v1/chat/completions")
      .set("Authorization", `Bearer ${createResponse.body.rawKey}`)
      .send({ model: "wrong-model", messages: [{ role: "user", content: "metrics" }] })
      .expect(200);

    const overview = await request(app).get("/api/overview?window=24h").expect(200);
    expect(overview.body.summary.totalCalls).toBeGreaterThan(0);

    const history = await request(app).get(`/api/keys/${createResponse.body.item.id}/history`).expect(200);
    expect(history.body.total).toBeGreaterThan(0);
  });
});
