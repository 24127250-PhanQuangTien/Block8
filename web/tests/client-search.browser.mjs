import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { loginSeedUser } from "./auth-helper.mjs";

const require = createRequire(import.meta.url);
const { chromium } = require(process.env.PLAYWRIGHT_MODULE || "playwright");
const base = process.env.WEB_TEST_URL || "http://localhost:5173";
const chefs = [
  { id: 1, name: "Đặng Văn Đạt", specialty: "Bếp Việt", dishes: [], createdAt: "2026-01-01" },
  { id: 2, name: "Nguyễn An", specialty: "Món nướng", dishes: [], createdAt: "2026-01-01" },
];
const ingredients = [
  { id: 1, name: "Thịt thăn bò Úc", category: "Thịt", unit: "kg", quantity: 5, createdAt: "2026-01-01", _count: { dishes: 1 } },
  { id: 2, name: "Bánh hỏi heo quay", category: "Khác", unit: "gam", quantity: 5, createdAt: "2026-01-01", _count: { dishes: 1 } },
  { id: 3, name: "Thịt ba chỉ heo", category: "Thịt", unit: "gam", quantity: 5, createdAt: "2026-01-01", _count: { dishes: 1 } },
];
const browser = await chromium.launch({ channel: "chrome", headless: true });
try
{
  const page = await browser.newPage();
  const requests = [];
  const errors = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await page.route("**/api/**", async (route) =>
  {
    assert.equal(route.request().method(), "GET");
    const url = new URL(route.request().url());
    requests.push(url);
    if (url.pathname === "/api/me") {
      await route.fulfill({ json: { email: "browser-test@example.test" } });
      return;
    }
    if (url.pathname === "/api/csrf") {
      await route.fulfill({ json: { token: "browser-test-csrf" } });
      return;
    }
    const data = url.pathname === "/api/chefs" ? chefs : url.pathname === "/api/ingredients" ? ingredients : {
      items: [{ id: 1, name: "Bánh hỏi heo quay", price: 50000, category: "Món Khô", available: true, chef: chefs[0], ingredients }],
      total: 1, page: 1, pageSize: 10,
    };
    await route.fulfill({ json: { ok: true, data, error: null } });
  });

  await loginSeedUser(page, base);
  await page.goto(base + "/admin/chefs");
  await page.locator(".data-table tbody tr").nth(1).waitFor();
  const chefLoads = requests.length;
  await page.locator("#filter-q").fill("dang van dat");
  await page.locator("button[type=submit]").click();
  await page.waitForFunction(() => document.querySelectorAll(".data-table tbody tr").length === 1);
  assert.match(await page.locator(".data-table tbody").innerText(), /Đặng Văn Đạt/);
  assert.equal(requests.length, chefLoads);

  await page.goto(base + "/admin/ingredients");
  await page.locator(".data-table tbody tr").nth(2).waitFor();
  const ingredientLoads = requests.length;
  await page.locator("#filter-q").fill("thit");
  await page.locator("#filter-unit").fill("kg");
  await page.locator("button[type=submit]").click();
  await page.waitForFunction(() => document.querySelectorAll(".data-table tbody tr").length === 1);
  await page.locator(".ingredient-tag-btn").filter({ hasText: /^Thịt$/ }).click();
  assert.match(await page.locator(".data-table tbody").innerText(), /Thịt thăn bò Úc/);
  assert.equal(requests.length, ingredientLoads);
  await page.getByRole("button", { name: "Xóa Bộ Lọc" }).click();
  await page.waitForFunction(() => document.querySelectorAll(".data-table tbody tr").length === 3);
  await page.goBack();
  await page.waitForFunction(() => document.querySelectorAll(".data-table tbody tr").length === 1);
  assert.equal(requests.length, ingredientLoads);
  await page.reload();
  await page.locator(".data-table tbody").getByText("Thịt thăn bò Úc", { exact: true }).waitFor();
  assert.equal(await page.locator("#filter-q").inputValue(), "thit");

  await page.goto(base + "/admin/dishes/new");
  await page.locator("#name").waitFor();
  const formLoads = requests.length;
  await page.getByRole("button", { name: "Chọn thêm nguyên liệu", exact: true }).click();
  await page.getByRole("textbox", { name: "Tìm nhanh nguyên liệu", exact: true }).fill("banh qauy");
  await page.locator(".ingredient-popup-item").getByText("Bánh hỏi heo quay", { exact: true }).waitFor();
  assert.equal(await page.locator(".ingredient-popup-item").count(), 1);
  await page.locator(".ingredient-popup-item").click();
  await page.getByRole("button", { name: "Xong (1)", exact: true }).click();
  assert.equal(await page.locator(".selected-ingredient-row").count(), 1);
  assert.equal(requests.length, formLoads);
  assert.ok(requests.filter((url) => ["/api/chefs", "/api/ingredients"].includes(url.pathname)).every((url) => !url.search));

  for (const path of ["/dishes", "/admin/dishes"])
  {
    const prefix = path === "/dishes" ? "dish" : "admin-dish";
    await page.goto(base + path);
    await page.locator(`#${prefix}-search-query`).fill("banh hoi heo quay");
    const response = page.waitForResponse((response) =>
    {
      const url = new URL(response.url());
      return url.pathname === "/api/dishes" && url.searchParams.get("q") === "banh hoi heo quay" && url.searchParams.get("match") === "fuzzy";
    });
    await page.locator(".dish-search-actions button[type=submit]").click();
    await response;
    if (path.startsWith("/admin")) assert.equal(await page.locator(".dish-view-switch").count(), 0);
  }
  assert.deepEqual(errors, []);
  console.log("PASS: client searches make no extra API requests; popup selection, URL reload and both dish fuzzy requests work.");
}
finally
{
  await browser.close();
}
