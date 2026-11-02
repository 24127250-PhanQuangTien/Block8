// Optional browser check: install Playwright outside the app and set PLAYWRIGHT_MODULE
// to its package directory. Requires a running Vite server (WEB_TEST_URL if not :5173).
// All API calls are intercepted; this script never writes to the real database.
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { mkdir, writeFile } from "node:fs/promises";
import { loginSeedUser } from "./auth-helper.mjs";

const require = createRequire(import.meta.url);
const { chromium } = require(process.env.PLAYWRIGHT_MODULE || "playwright");
const base = process.env.WEB_TEST_URL || "http://localhost:5173";
const artifacts = new URL("../../.temp/part1-checks/", import.meta.url);
await mkdir(artifacts, { recursive: true });
const chefs = Array.from({ length: 70 }, (_, index) => ({
  id: index + 1,
  name: index === 41 ? "Đặng Văn Đạt" : `Đầu bếp Nguyễn Văn ${index + 1}`,
  specialty: index === 41 ? "Hải sản, món nướng và ẩm thực Huế truyền thống dành cho thực đơn theo mùa" : "Ẩm thực Việt Nam",
}));
const ingredients = [
  { id: 1, name: "Thịt thăn bò Úc", unit: "gam", category: "Thịt" },
  { id: 2, name: "Sườn heo non", unit: "kg", category: "Thịt" },
  { id: 3, name: "Nước mắm cá cơm", unit: "ml", category: "Gia vị" },
  { id: 4, name: "Hải sản", unit: "gam", category: "Hải sản" },
  { id: 5, name: "ă â ê ô ơ ư đ ắ ễ ộ ự".normalize("NFD"), unit: "gam", category: "Rau" },
];
const longCategory = "Món đặc biệt theo mùa với nguyên liệu và hương vị truyền thống ".repeat(3);
const dish = { id: 8, name: "Món kiểm thử", price: 55000, category: longCategory, chefId: 42, chef: chefs[41], ingredients: [{ ...ingredients[0], quantity: 250 }], available: true, description: "Dữ liệu mock", createdAt: "2026-01-01" };
const browser = await chromium.launch({ channel: process.env.BROWSER_CHANNEL || "chrome", headless: true });
const results = [];

async function setup(width, options = {})
{
  const context = await browser.newContext({ viewport: { width, height: 844 }, isMobile: width < 768, hasTouch: width < 768 });
  const page = await context.newPage();
  page.setDefaultTimeout(10000);
  const writes = [];
  let chefFailed = options.chefError;
  let releaseChefs;
  const chefGate = options.delayChefs ? new Promise((resolve) => { releaseChefs = resolve; }) : Promise.resolve();
  await page.route("https://**", (route) => route.abort());
  await page.route("**/api/**", async (route) =>
  {
    const request = route.request();
    const url = new URL(request.url());
    if (url.pathname === "/api/me") {
      await route.fulfill({ json: { email: "browser-test@example.test" } });
      return;
    }
    if (url.pathname === "/api/csrf") {
      await route.fulfill({ json: { token: "browser-test-csrf" } });
      return;
    }
    let data;
    if (request.method() !== "GET")
    {
      writes.push({ method: request.method(), path: url.pathname, data: request.postDataJSON() });
      if (options.validationError)
      {
        await route.fulfill({ json: { ok: false, error: { code: "VALIDATION_FAILED", message: "Kiểm tra dữ liệu", fields: { chefId: "Đầu bếp không hợp lệ" } } } });
        return;
      }
      data = dish;
    }
    else if (url.pathname === "/api/chefs")
    {
      await chefGate;
      if (chefFailed)
      {
        await route.fulfill({ status: 503, json: { message: "Lỗi mock" } });
        return;
      }
      data = options.emptyChefs ? [] : chefs;
    }
    else if (url.pathname.startsWith("/api/ingredients"))
    {
      data = /\/\d+$/.test(url.pathname) ? ingredients[0] : ingredients;
    }
    else
    {
      data = /\/\d+$/.test(url.pathname) ? dish : { items: [dish], total: 1, page: 1, pageSize: 10 };
    }
    await route.fulfill({ json: { ok: true, data } });
  });
  page.on("pageerror", (error) => { throw error; });
  await loginSeedUser(page, base);
  return { page, context, writes, releaseChefs, allowChefs: () => { chefFailed = false; } };
}

async function assertLayout(page)
{
  const layout = await page.evaluate(() =>
  {
    const width = document.documentElement.clientWidth;
    const selectors = "select, .chef-select, .chef-select-list, .ingredient-select-card, .ingredient-select-header, .ingredient-qty-box, .category-pill, .ingredient-tag-btn, .admin-filter-form, .search-form";
    const outside = [...document.querySelectorAll(selectors)].filter((el) =>
    {
      const r = el.getBoundingClientRect();
      return r.width && (r.left < -1 || r.right > width + 1 || el.scrollWidth > el.clientWidth + 2);
    }).map((el) => ({ tag: el.tagName, className: el.className, width: el.clientWidth, scrollWidth: el.scrollWidth }));
    return { outside, width, scrollWidth: document.documentElement.scrollWidth };
  });
  assert.deepEqual(layout.outside, [], JSON.stringify(layout));
  assert.ok(layout.scrollWidth <= layout.width + 1, JSON.stringify(layout));
}

try
{
  for (const width of [1440, 375, 390, 440])
  {
    const { page, context, writes } = await setup(width, { validationError: true });
    await page.goto(`${base}/admin/dishes/new`);
    const combo = page.getByRole("combobox", { name: "Đầu Bếp Phụ Trách:" });
    await combo.waitFor();
    await page.evaluate(() => document.fonts.ready);
    if (width === 390)
    {
      const cdp = await context.newCDPSession(page);
      await cdp.send("DOM.enable");
      await cdp.send("CSS.enable");
      const { root } = await cdp.send("DOM.getDocument");
      const fontEvidence = {};
      for (const selector of [".form-label", "#name", "#chefId", ".ingredient-name strong", ".ingredient-select-card:last-child strong", ".ingredient-tag-btn span"])
      {
        const { nodeId } = await cdp.send("DOM.querySelector", { nodeId: root.nodeId, selector });
        const { fonts } = await cdp.send("CSS.getPlatformFontsForNode", { nodeId });
        fontEvidence[selector] = fonts;
        assert.ok(fonts.length > 0, selector);
        assert.ok(fonts.every((font) => font.familyName === "Noto Sans" && font.isCustomFont), JSON.stringify({ selector, fonts }));
      }
      await writeFile(new URL("rendered-fonts.json", artifacts), JSON.stringify(fontEvidence, null, 2));
    }
    await page.locator("#name").fill("Thịt thăn bò Úc");
    await page.locator("#price").fill("55000");
    await combo.fill("chuỗi chưa được chọn");
    await combo.press("Escape");
    await page.getByRole("button", { name: "Lưu Món Ăn", exact: true }).click();
    assert.equal(writes.length, 0, "Typing must not create a chefId or bypass required selection");
    await combo.fill("DANG hai san");
    assert.equal(await page.getByRole("option").count(), 1);
    await combo.press("ArrowUp");
    await combo.press("Enter");
    assert.equal(writes.length, 0, "Enter selects without submitting");
    assert.equal(await page.locator('input[name="chefId"]').inputValue(), "42");
    await combo.click();
    await combo.fill("không có đầu bếp này");
    assert.equal(await page.getByRole("option").count(), 0);
    assert.match(await page.getByRole("status").innerText(), /Không tìm thấy/);
    await combo.press("Escape");
    assert.equal(await page.locator('input[name="chefId"]').inputValue(), "42");
    await combo.click();
    await combo.press("Tab");
    assert.equal(await combo.getAttribute("aria-expanded"), "false");
    assert.equal(await page.locator('input[name="chefId"]').inputValue(), "42");
    const firstCard = page.locator(".ingredient-select-card").filter({ hasText: "Thịt thăn bò Úc" });
    await firstCard.getByRole("checkbox").check();
    await page.getByRole("textbox", { name: "Số lượng Thịt thăn bò Úc", exact: true }).fill("275");
    await page.getByRole("textbox", { name: "Đơn vị Thịt thăn bò Úc", exact: true }).fill("gam");
    await page.getByRole("textbox", { name: "Tìm nhanh nguyên liệu", exact: true }).fill("mắm");
    assert.equal(await page.locator(".ingredient-select-card").count(), 1);
    await page.getByRole("textbox", { name: "Tìm nhanh nguyên liệu", exact: true }).fill("");
    await page.getByRole("button", { name: /^Đã chọn/ }).click();
    assert.equal(await page.locator(".ingredient-select-card").count(), 1);
    assert.equal(await page.getByRole("textbox", { name: "Số lượng Thịt thăn bò Úc", exact: true }).inputValue(), "275");
    await assertLayout(page);
    await page.getByRole("button", { name: "Lưu Món Ăn", exact: true }).click();
    await page.locator("#chef-error").waitFor();
    assert.equal(writes[0].data.chefId, 42);
    assert.deepEqual(writes[0].data.ingredientIds, [1]);
    assert.equal(writes[0].data.ingredientQuantities[1], "275");
    assert.equal(writes[0].data.ingredientUnits[1], "gam");
    assert.equal(await page.locator("#name").inputValue(), "Thịt thăn bò Úc");
    assert.equal(await page.locator('input[name="chefId"]').inputValue(), "42");
    await combo.click();
    assert.equal(await page.getByRole("option").count(), 70);
    for (let i = 0; i < 35; i++)
    {
      await combo.press("ArrowDown");
    }
    assert.ok(await page.locator(".chef-select-list").evaluate((el) => el.scrollTop > 0));
    await assertLayout(page);
    await page.screenshot({ path: new URL(`create-${width}.png`, artifacts).pathname.replace(/^\/(\w:)/, "$1"), fullPage: true });
    await combo.press("Escape");
    await page.goto(`${base}/admin/dishes/8/edit`);
    await page.locator(".ingredient-qty-input").waitFor();
    assert.match(await page.locator(".chef-select-selection").innerText(), /Đặng Văn Đạt/);
    assert.equal(await page.locator(".ingredient-qty-input").inputValue(), "250");
    await assertLayout(page);
    await context.close();
    results.push(`create/edit, keyboard, validation, payload and layout: ${width}px`);
    console.log(results.at(-1));
  }

  for (const options of [{ chefError: true }, { emptyChefs: true }, { delayChefs: true }])
  {
    const { page, context, releaseChefs, allowChefs } = await setup(390, options);
    await page.goto(`${base}/admin/dishes/8/edit`);
    const combo = page.locator("#chefId");
    await combo.waitFor();
    if (options.chefError)
    {
      allowChefs();
      await page.getByRole("button", { name: "Thử lại", exact: true }).click();
      await page.waitForFunction(() => document.querySelector(".chef-select-selection")?.textContent.includes("Đặng Văn Đạt"));
    }
    else if (options.delayChefs)
    {
      assert.equal(await combo.getAttribute("aria-busy"), "true");
      assert.equal(await page.locator('input[name="chefId"]').inputValue(), "42");
      await page.locator("#description").fill("Giữ thông tin khi đang tải");
      releaseChefs();
      await page.waitForFunction(() => document.querySelector(".chef-select-selection")?.textContent.includes("Đặng Văn Đạt"));
      assert.equal(await page.locator("#description").inputValue(), "Giữ thông tin khi đang tải");
    }
    else
    {
      await combo.click();
      assert.match(await page.getByRole("status").innerText(), /Không tìm thấy/);
    }
    assert.equal(await page.locator('input[name="chefId"]').inputValue(), "42");
    await context.close();
  }
  results.push("chef loading, empty list and error/retry preserve edit data");
  console.log(results.at(-1));

  {
    const { page, context, writes } = await setup(390);
    await page.goto(`${base}/admin/dishes/new`);
    await page.locator("#name").fill("Món mới dùng mock");
    await page.locator("#price").fill("55000");
    const combo = page.locator("#chefId");
    await combo.tap();
    const list = page.locator(".chef-select-list");
    await list.scrollIntoViewIfNeeded();
    const box = await list.boundingBox();
    const cdp = await context.newCDPSession(page);
    const scrollBefore = await list.evaluate((el) => el.scrollTop);
    const touchX = box.x + box.width / 2;
    const touchY = Math.min(box.y + box.height - 20, 800);
    await cdp.send("Input.dispatchTouchEvent", { type: "touchStart", touchPoints: [{ x: touchX, y: touchY }] });
    for (let step = 1; step <= 10; step++)
    {
      await cdp.send("Input.dispatchTouchEvent", { type: "touchMove", touchPoints: [{ x: touchX, y: touchY - step * 15 }] });
      await new Promise((resolve) => setTimeout(resolve, 20));
    }
    await cdp.send("Input.dispatchTouchEvent", { type: "touchEnd", touchPoints: [] });
    await page.waitForFunction((before) => document.querySelector(".chef-select-list").scrollTop > before, scrollBefore);
    await page.setViewportSize({ width: 390, height: 420 });
    await combo.fill("DANG");
    await combo.scrollIntoViewIfNeeded();
    await assertLayout(page);
    await page.screenshot({ path: new URL("reduced-viewport.png", artifacts).pathname.replace(/^\/(\w:)/, "$1") });
    await page.getByRole("option").tap();
    assert.equal(await page.locator('input[name="chefId"]').inputValue(), "42");
    await page.setViewportSize({ width: 390, height: 844 });
    await page.locator(".ingredient-select-card").first().getByRole("checkbox").tap();
    await page.getByRole("button", { name: "Lưu Món Ăn", exact: true }).tap();
    await page.waitForURL(base + "/admin/dishes");
    assert.equal(writes[0].method, "POST");
    assert.equal(writes[0].data.chefId, 42);
    await context.close();
    results.push("touch scroll/tap, reduced viewport and successful create");
    console.log(results.at(-1));
  }

  for (const width of [1440, 375, 390, 440])
  {
    const { page, context, writes } = await setup(width);
    for (const route of ["/dishes", "/admin/dishes", "/admin/ingredients", "/admin/chefs", "/admin/ingredients/new", "/admin/ingredients/1/edit", "/admin/chefs/new", "/admin/chefs/42/edit"])
    {
      await page.goto(base + route);
      await page.locator(".spa-loading").waitFor({ state: "hidden" });
      await assertLayout(page);
      if (route === "/admin/dishes")
      {
        await page.locator("#filter-status").click();
        await page.getByRole("option", { name: "Tạm hết món", exact: true }).click();
        await page.locator("#filter-sort").click();
        await page.getByRole("option", { name: "Cao đến Thấp", exact: true }).click();
        await page.getByRole("button", { name: "Lọc Dữ Liệu" }).click();
        await page.waitForURL(/status=unavailable/);
        assert.match(page.url(), /sort=price_desc/);
        await page.getByRole("button", { name: "Xóa Lọc", exact: true }).click();
        await page.waitForURL(base + route);
        assert.equal(await page.locator('input[name="status"]').inputValue(), "");
      }
      if (route.includes("ingredients/") && !route.endsWith("ingredients"))
      {
        await page.locator("#category").click();
        await page.getByRole("option", { name: "Hải sản", exact: true }).click();
        assert.equal(await page.locator('input[name="category"]').inputValue(), "Hải sản");
        assert.match(await page.locator("#ingredient-category-help").innerText(), /Tôm, cua/);
      }
    }
    await page.goto(`${base}/admin/dishes/8/edit`);
    await page.locator(".ingredient-qty-input").waitFor();
    await page.getByRole("button", { name: "Lưu Thay Đổi", exact: true }).click();
    await page.waitForURL(base + "/admin/dishes");
    assert.equal(writes[0].method, "PATCH");
    assert.equal(writes[0].data.chefId, 42);
    await context.close();
    results.push(`select popups, filters, all forms and successful edit: ${width}px`);
    console.log(results.at(-1));
  }
  console.log(`Chrome ${browser.version()} — API MOCK ONLY\n${results.join("\n")}`);
}
finally
{
  await browser.close();
}
