import { createRequire } from "node:module";
import path from "node:path";
import { fileURLToPath } from "node:url";

const testsDirectory = path.dirname(fileURLToPath(import.meta.url));
const projectRoot = path.resolve(testsDirectory, "../..");
const require = createRequire(path.join(projectRoot, "api", "package.json"));
require("dotenv").config({ path: path.join(projectRoot, ".env") });

export async function loginSeedUser(page, base) {
  const email = process.env.SEED_USER_EMAIL;
  const password = process.env.SEED_USER_PASSWORD;
  if (!email || !password) {
    throw new Error("Set SEED_USER_EMAIL and SEED_USER_PASSWORD, then run seed:auth before browser regression tests.");
  }
  await page.goto(`${base}/login`);
  await page.locator('input[name="email"]').fill(email);
  await page.locator('input[name="password"]').fill(password);
  await page.locator('form[action="/login"] button[type="submit"]').click();
  await page.waitForURL(`${base}/`);
}
