const test = require("node:test");
const assert = require("node:assert/strict");
const path = require("node:path");
require("dotenv").config({ path: path.resolve(__dirname, "../../.env") });

if (!process.env.DATABASE_URL) {
  test("API integration checks require DATABASE_URL and an applied auth migration", { skip: true }, () => {});
} else {
  process.env.SESSION_SECRET ||= "test-session-secret-only-not-for-production";
  process.env.OTP_PEPPER ||= "test-otp-pepper-only-not-for-production";
  const request = require("supertest");
  const app = require("../src/app");
  const prisma = require("../src/prisma");
  const { closeSessionPool } = require("../src/services/session");

  test.after(async () => {
    await Promise.all([prisma.$disconnect(), closeSessionPool()]);
  });

  for (const [method, route] of [
    ["get", "/"],
    ["get", "/assets/img/logo.svg"],
    ["get", "/api/dishes"],
    ["get", "/api/dishes/1"],
    ["get", "/api/chefs"],
    ["get", "/api/ingredients"],
    ["post", "/api/dishes"],
    ["patch", "/api/dishes/1"],
    ["delete", "/api/dishes/1"],
    ["get", "/api/me"],
    ["get", "/api/csrf"],
  ]) {
    test(`unauthenticated ${method.toUpperCase()} ${route} redirects to login`, async () => {
      const response = await request(app)[method](route);
      assert.equal(response.status, 303);
      assert.equal(response.headers.location, "/login");
    });
  }

  test("public auth form renders a synchronizer token and never exposes a CAPTCHA answer", async () => {
    const response = await request(app).get("/register");
    assert.equal(response.status, 200);
    assert.match(response.text, /name="_csrf"/);
    assert.match(response.text, /captchaChallengeId/);
    assert.doesNotMatch(response.text, /name="text"/);
    assert.equal(response.headers["cache-control"], "no-store");
  });

  test("public CSRF refresh endpoint returns the active form session token without caching", async () => {
    const agent = request.agent(app);
    const form = await agent.get("/login");
    const token = form.text.match(/name="_csrf" value="([^"]+)"/)?.[1];
    const response = await agent.get("/csrf-token");

    assert.equal(response.status, 200);
    assert.equal(response.body.token, token);
    assert.equal(response.headers["cache-control"], "no-store");
  });

  test("server does not expose the Express framework header", async () => {
    const response = await request(app).get("/login");
    assert.equal(response.status, 200);
    assert.equal(response.headers["x-powered-by"], undefined);
    assert.match(response.text, /name="_csrf"/);
  });
}
