const assert = require("node:assert/strict");
const request = require("supertest");
const app = require("../../src/app");

async function createAuthenticatedAgent() {
  const email = process.env.SEED_USER_EMAIL;
  const password = process.env.SEED_USER_PASSWORD;
  if (!email || !password) {
    throw new Error("Set SEED_USER_EMAIL and SEED_USER_PASSWORD, then run seed:auth before API regression tests.");
  }

  const agent = request.agent(app);
  const loginPage = await agent.get("/login");
  assert.equal(loginPage.status, 200);
  const csrfToken = loginPage.text.match(/name="_csrf" value="([^"]+)"/)?.[1];
  assert.ok(csrfToken, "Login form should render a CSRF token.");
  const loginResponse = await agent
    .post("/login")
    .type("form")
    .send({ _csrf: csrfToken, email, password })
    .redirects(0);
  assert.equal(loginResponse.status, 303, "Seed user should log in successfully.");
  assert.equal(loginResponse.headers.location, "/");
  return agent;
}

module.exports = { createAuthenticatedAgent };
