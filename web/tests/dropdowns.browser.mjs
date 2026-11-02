// Run with Vite, Chrome and PLAYWRIGHT_MODULE as documented in README.md.
// API responses are mocked. Every selection below opens and uses the visible popup.
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { mkdir, writeFile } from "node:fs/promises";
import { loginSeedUser } from "./auth-helper.mjs";

const require = createRequire(import.meta.url);
const { chromium } = require(process.env.PLAYWRIGHT_MODULE || "playwright");
const base = process.env.WEB_TEST_URL || "http://localhost:5173";
const artifacts = new URL("../../.temp/dropdown-checks/", import.meta.url);
await mkdir(artifacts, { recursive: true });
const browser = await chromium.launch({ channel: "chrome", headless: true });
const evidence = [];
const ingredient = { id: 1, name: "Nước mắm cá cơm", quantity: 10, unit: "ml", category: "Gia vị" };
const dishes = [
  { id: 1, name: "Món A", price: 50000, available: true },
  { id: 2, name: "Món B", price: 30000, available: false },
  { id: 3, name: "Món C", price: 90000, available: true },
  { id: 4, name: "Món D", price: 70000, available: false },
].map((dish) => ({ ...dish, category: "Món Nước", ingredients: [] }));

async function waitForDishNames(page, names)
{
  await page.waitForFunction((expected) =>
  {
    const actual = [...document.querySelectorAll(".dish-name-cell")].map((el) => el.textContent);
    return JSON.stringify(actual) === JSON.stringify(expected);
  }, names);
}

async function checkOpen(page, file)
{
  const popup = page.getByRole("listbox");
  await popup.waitFor({ state: "visible" });
  const bounds = await popup.evaluate((el) =>
  {
    const r = el.getBoundingClientRect();
    const nav = document.querySelector(".navbar").getBoundingClientRect();
    return { left: r.left, right: r.right, top: r.top, bottom: r.bottom, width: innerWidth, height: innerHeight, navbarBottom: nav.bottom, scrollWidth: el.scrollWidth, clientWidth: el.clientWidth };
  });
  assert.ok(bounds.left >= 7 && bounds.right <= bounds.width - 7, JSON.stringify(bounds));
  assert.ok(bounds.top >= bounds.navbarBottom + 7 && bounds.bottom <= bounds.height - 7, JSON.stringify(bounds));
  assert.ok(bounds.scrollWidth <= bounds.clientWidth + 1, JSON.stringify(bounds));
  assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true);
  if (file)
  {
    await page.evaluate(() =>
    {
      const frame = document.createElement("div");
      frame.id = "test-viewport-frame";
      frame.style.cssText = "position:fixed;inset:0;outline:2px solid #2563eb;outline-offset:-2px;pointer-events:none;z-index:2147483647";
      document.body.append(frame);
    });
    await page.screenshot({ path: new URL(file, artifacts).pathname.replace(/^\/(\w:)/, "$1") });
    await page.locator("#test-viewport-frame").evaluate((el) => el.remove());
    evidence.push({ file, ...bounds });
  }
}

try
{
  for (const width of [440, 375, 1440])
  {
    const context = await browser.newContext({ viewport: { width, height: 956 }, isMobile: width < 768, hasTouch: width < 768 });
    const page = await context.newPage();
    page.setDefaultTimeout(10000);
    const requests = [];
    const writes = [];
    let invalid = true;
    await page.route("https://**", (route) => route.abort());
    await page.route("**/api/**", async (route) =>
    {
      const request = route.request();
      const url = new URL(request.url());
      requests.push(url);
      if (url.pathname === "/api/me") {
        await route.fulfill({ json: { email: "browser-test@example.test" } });
        return;
      }
      if (url.pathname === "/api/csrf") {
        await route.fulfill({ json: { token: "browser-test-csrf" } });
        return;
      }
      if (request.method() !== "GET")
      {
        writes.push({ method: request.method(), body: request.postDataJSON() });
        await route.fulfill({ json: invalid ? { ok: false, error: { code: "VALIDATION_FAILED", message: "Kiểm tra dữ liệu", fields: { name: "Tên cần kiểm tra" } } } : { ok: true, data: ingredient } });
        return;
      }
      let data = [];
      if (url.pathname === "/api/dishes")
      {
        const available = url.searchParams.get("available");
        const sort = url.searchParams.get("sort");
        data = dishes.filter((dish) => available === null || dish.available === (available === "true"));
        if (sort === "price_asc") data.sort((a, b) => a.price - b.price || a.id - b.id);
        if (sort === "price_desc") data.sort((a, b) => b.price - a.price || a.id - b.id);
        if (sort === "name_asc") data.sort((a, b) => a.name.localeCompare(b.name) || a.id - b.id);
        if (sort === "name_desc") data.sort((a, b) => b.name.localeCompare(a.name) || a.id - b.id);
        const page = Number(url.searchParams.get("page") || 1);
        const pageSize = Number(url.searchParams.get("pageSize") || 10);
        const total = data.length;
        data = { items: data.slice((page - 1) * pageSize, page * pageSize), total, page, pageSize };
      }
      if (url.pathname.startsWith("/api/ingredients"))
      {
        data = url.pathname.endsWith("/1") ? ingredient : [ingredient];
      }
      if (url.pathname === "/api/chefs")
      {
        data = [{ id: 42, name: "Đặng Văn Đạt", specialty: "Hải sản" }];
      }
      await route.fulfill({ json: { ok: true, data } });
    });
    const errors = [];
    page.on("pageerror", (error) => errors.push(error.message));
    await loginSeedUser(page, base);
    await page.goto(`${base}/admin/dishes`);
    await page.locator(".spa-loading").waitFor({ state: "hidden" });
    const status = page.getByRole("combobox", { name: "Trạng thái bếp", exact: true });
    const sort = page.getByRole("combobox", { name: "Sắp xếp theo giá", exact: true });
    assert.match(await status.innerText(), /Tất cả/);
    const initialRequests = requests.length;
    await status.click();
    await checkOpen(page, `status-open-${width}.png`);
    if (width === 440)
    {
      await page.evaluate(() => document.fonts.ready);
      const cdp = await context.newCDPSession(page);
      await cdp.send("DOM.enable");
      await cdp.send("CSS.enable");
      const { root } = await cdp.send("DOM.getDocument");
      const { nodeId } = await cdp.send("DOM.querySelector", { nodeId: root.nodeId, selector: ".select-popup-option" });
      const { fonts } = await cdp.send("CSS.getPlatformFontsForNode", { nodeId });
      assert.ok(fonts.length && fonts.every((font) => font.familyName === "Noto Sans" && font.isCustomFont));
    }
    assert.equal(await page.getByRole("option", { selected: true }).innerText(), "Tất cả");
    await page.getByRole("option", { name: "Tạm hết món", exact: true }).click();
    assert.equal(await status.getAttribute("aria-expanded"), "false");
    assert.equal(await page.locator('input[name="status"]').inputValue(), "unavailable");
    assert.equal(page.url(), `${base}/admin/dishes`);
    assert.equal(requests.length, initialRequests, "Choosing an option must not submit filters");
    await sort.click();
    await checkOpen(page, `sort-open-${width}.png`);
    await sort.press("End");
    await sort.press("Enter");
    assert.match(await sort.innerText(), /Cao đến Thấp/);
    assert.equal(await sort.evaluate((el) => el === document.activeElement), true);
    await page.getByRole("button", { name: "Lọc Dữ Liệu", exact: true }).click();
    await page.waitForURL(/status=unavailable.*sort=price_desc/);
    await page.locator(".spa-loading").waitFor({ state: "hidden" });
    assert.ok(requests.some((url) => url.searchParams.get("available") === "false" && url.searchParams.get("sort") === "price_desc"));
    await waitForDishNames(page, ["Món D", "Món B"]);
    assert.deepEqual(await page.locator(".dish-name-cell").allTextContents(), ["Món D", "Món B"]);
    await page.reload();
    assert.match(await status.innerText(), /Tạm hết món/);
    assert.match(await sort.innerText(), /Cao đến Thấp/);
    await status.click();
    await status.press("ArrowUp");
    await status.press("Escape");
    assert.equal(await page.locator('input[name="status"]').inputValue(), "unavailable");
    await status.click();
    await page.locator("#filter-q").click();
    assert.equal(await status.getAttribute("aria-expanded"), "false");
    await status.click();
    await status.press("Tab");
    assert.equal(await status.getAttribute("aria-expanded"), "false");
    assert.equal(await sort.evaluate((el) => el === document.activeElement), true);
    await page.getByRole("button", { name: "Xóa Lọc", exact: true }).click();
    await page.waitForURL(`${base}/admin/dishes`);
    await page.locator(".spa-loading").waitFor({ state: "hidden" });
    await page.waitForFunction(() => document.querySelectorAll(".dish-name-cell").length === 4);
    assert.equal(await page.locator(".dish-name-cell").count(), 4);
    assert.match(await status.innerText(), /Tất cả/);
    assert.match(await sort.innerText(), /Tất cả/);

    if (width < 768)
    {
      await status.tap();
      await page.getByRole("option", { name: "Đang phục vụ", exact: true }).tap();
      await sort.tap();
      await page.getByRole("option", { name: "Thấp đến Cao", exact: true }).tap();
      assert.equal(await page.locator('input[name="status"]').inputValue(), "available");
      assert.equal(await page.locator('input[name="sort"]').inputValue(), "price_asc");
      await page.getByRole("button", { name: "Lọc Dữ Liệu", exact: true }).tap();
      await page.waitForURL(/status=available.*sort=price_asc/);
      await page.locator(".spa-loading").waitFor({ state: "hidden" });
      await waitForDishNames(page, ["Món A", "Món C"]);
      assert.deepEqual(await page.locator(".dish-name-cell").allTextContents(), ["Món A", "Món C"]);
    }

    for (const route of ["/admin/ingredients/new", "/admin/ingredients/1/edit"])
    {
      await page.goto(base + route);
      const category = page.getByRole("combobox", { name: "Phân Loại (Tag Nhóm Nguyên Liệu):", exact: true });
      await category.waitFor();
      await page.locator("#name").fill("Nước mắm cá cơm");
      await page.locator("#quantity").fill("10");
      await page.locator("#unit").fill("ml");
      await category.click();
      await checkOpen(page, `category-${route.endsWith("new") ? "new" : "edit"}-open-${width}.png`);
      await category.press("ArrowDown");
      await category.press("Enter");
      assert.equal(writes.length, route.endsWith("new") ? 0 : 1, "Enter must select without submitting the form");
      await category.click();
      await page.getByRole("option", { name: "Hải sản", exact: true }).click();
      assert.match(await page.locator("#ingredient-category-help").innerText(), /Tôm, cua/);
      await page.getByRole("button", { name: "Lưu Nguyên Liệu", exact: true }).click();
      await page.getByText("Tên cần kiểm tra", { exact: true }).waitFor();
      assert.equal(writes.at(-1).body.category, "Hải sản");
      assert.equal(await page.locator("#name").inputValue(), "Nước mắm cá cơm");
      assert.match(await category.innerText(), /Hải sản/);
      // Avoid a second validation write in the next route's count assertion.
      if (route.endsWith("/edit"))
      {
        invalid = false;
        await page.getByRole("button", { name: "Lưu Nguyên Liệu", exact: true }).click();
        await page.waitForURL(`${base}/admin/ingredients`);
        assert.equal(writes.at(-1).method, "PATCH");
        assert.equal(writes.at(-1).body.category, "Hải sản");
      }
    }

    if (width < 768)
    {
      await page.goto(`${base}/admin/ingredients/new`);
      await page.setViewportSize({ width, height: 360 });
      const category = page.locator("#category");
      await category.tap();
      await checkOpen(page, `category-small-height-open-${width}.png`);
      const popup = page.getByRole("listbox");
      assert.ok(await popup.evaluate((el) => el.scrollHeight > el.clientHeight));
      const box = await popup.boundingBox();
      const cdp = await context.newCDPSession(page);
      const x = box.x + box.width / 2;
      const y = box.y + box.height - 12;
      await cdp.send("Input.dispatchTouchEvent", { type: "touchStart", touchPoints: [{ x, y }] });
      for (let i = 1; i <= 6; i++)
      {
        await cdp.send("Input.dispatchTouchEvent", { type: "touchMove", touchPoints: [{ x, y: y - i * 10 }] });
        await new Promise((resolve) => setTimeout(resolve, 20));
      }
      await cdp.send("Input.dispatchTouchEvent", { type: "touchEnd", touchPoints: [] });
      await page.waitForFunction(() => document.querySelector(".select-popup")?.scrollTop > 0);
      await page.getByRole("option", { name: "Khác", exact: true }).tap();
      assert.equal(await page.locator('input[name="category"]').inputValue(), "Khác");
      await page.setViewportSize({ width, height: 956 });
    }

    await page.goto(`${base}/admin/dishes/new`);
    const chef = page.locator("#chefId");
    await chef.fill("dang");
    await page.getByRole("option", { name: /Đặng Văn Đạt/ }).click();
    assert.equal(await page.locator('input[name="chefId"]').inputValue(), "42");
    assert.deepEqual(errors, []);
    console.log(`Open popup, selection, URL/reset, form validation and input checks passed: ${width} × 956`);
    await context.close();
  }
  await writeFile(new URL("popup-bounds.json", artifacts), JSON.stringify({ browser: browser.version(), evidence }, null, 2));
  console.log(`Chrome ${browser.version()}: mouse, keyboard and simulated touch passed; API mock only.`);
}
finally
{
  await browser.close();
}
