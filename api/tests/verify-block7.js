const path = require("node:path");
require("dotenv").config();
require("dotenv").config({ path: path.resolve(__dirname, "../../.env") });
const assert = require("node:assert/strict");
const { Prisma } = require("@prisma/client");
const prisma = require("../src/prisma");
const { closeSessionPool } = require("../src/services/session");
const { createAuthenticatedAgent } = require("./helpers/authenticatedAgent");

const failures = [];
let agent;

async function get(params = {}) {
  const response = await agent.get("/api/dishes").query(params);
  return { status: response.status, body: response.body };
}

function check(name, callback) {
  try {
    callback();
    console.log(`PASS ${name}`);
  } catch (error) {
    failures.push({ name, message: error.message });
    console.error(`FAIL ${name}: ${error.message}`);
  }
}

async function getAll(params = {}, pageSize = 100) {
  const first = await get({ ...params, page: 1, pageSize });
  assert.equal(first.status, 200);
  assert.equal(first.body.ok, true);
  const data = first.body.data;
  const pages = [data];
  const pageCount = Math.ceil(data.total / pageSize);
  for (let page = 2; page <= pageCount; page += 1) {
    const result = await get({ ...params, page, pageSize });
    assert.equal(result.status, 200);
    assert.equal(result.body.ok, true);
    assert.equal(result.body.data.total, data.total);
    pages.push(result.body.data);
  }
  return { total: data.total, pages, items: pages.flatMap((page) => page.items) };
}

async function main() {
  agent = await createAuthenticatedAgent();
  const all = await getAll({}, 37);
  check("at least 1,000 dishes are seeded", () => assert.ok(all.total >= 1000));
  check("all pages cover each dish once", () => {
    const ids = all.items.map((dish) => dish.id);
    assert.equal(ids.length, all.total);
    assert.equal(new Set(ids).size, all.total);
  });

  const beyond = await get({ page: Math.ceil(all.total / 10) + 3, pageSize: 10 });
  check("out-of-range page returns an empty page and true total", () => {
    assert.equal(beyond.body.ok, true);
    assert.equal(beyond.body.data.items.length, 0);
    assert.equal(beyond.body.data.total, all.total);
  });

  const invalidInputs = [
    ["page=0", { page: "0" }],
    ["pageSize=999", { pageSize: "999" }],
    ["available=maybe", { mode: "advanced", available: "maybe" }],
    ["minPrice=-1", { mode: "advanced", minPrice: "-1" }],
    ["minPrice>maxPrice", { mode: "advanced", minPrice: "20", maxPrice: "10" }],
    ["mode=abc", { mode: "abc" }],
    ["unsupported category", { mode: "advanced", category: "Not a category" }],
    ["unsupported sort", { sort: "newest" }],
    ["unsupported match", { mode: "advanced", match: "unknown" }],
    ["empty full-text query", { mode: "fulltext", q: "" }],
    ["empty fuzzy query", { mode: "fuzzy", q: "" }],
    ["invalid legacy status", { status: "unknown" }],
  ];
  for (const [label, params] of invalidInputs) {
    const result = await get(params);
    check(`rejects ${label}`, () => {
      assert.equal(result.status, 200);
      assert.equal(result.body.ok, false);
      assert.equal(result.body.error.code, "VALIDATION_FAILED");
    });
  }

  const literalPercent = await getAll({ q: "100%" });
  const literalUnderscore = await getAll({ q: "_" });
  const literalBang = await getAll({ q: "!" });
  const noMatch = await get({ q: "no-such-dish-block7" });
  check("basic search treats wildcard characters literally", () => {
    assert.deepEqual(literalPercent.items.map((dish) => dish.name), ["100% Beef Burger"]);
    assert.deepEqual(literalUnderscore.items.map((dish) => dish.name), ["Pho_Special"]);
    assert.deepEqual(literalBang.items.map((dish) => dish.name), ["Bun!Bo Hue"]);
    assert.equal(noMatch.body.data.total, 0);
    assert.deepEqual(noMatch.body.data.items, []);
  });

  const unavailable = await getAll({ mode: "advanced", available: "false" });
  const emptyAvailable = await getAll({ mode: "advanced", available: "" });
  const zeroPrice = await getAll({ mode: "advanced", minPrice: "0", maxPrice: "0" });
  const andFilters = await getAll({
    mode: "advanced",
    category: "Món Nước",
    minPrice: "0",
    maxPrice: "100000",
    available: "false",
  });
  const basicByName = await getAll({ q: "Pho" });
  const advancedByName = await getAll({ mode: "advanced", q: "Pho" });
  const legacyUnavailable = await getAll({ status: "unavailable" });
  const legacyCategory = await getAll({ category: "Món Nước" });
  check("advanced filters preserve false, zero, and AND semantics", () => {
    assert.equal(emptyAvailable.total, all.total);
    assert.ok(unavailable.items.length > 0);
    assert.ok(unavailable.items.every((dish) => dish.available === false));
    assert.ok(zeroPrice.items.length > 0);
    assert.ok(zeroPrice.items.every((dish) => dish.price === 0));
    assert.ok(andFilters.items.every((dish) =>
      dish.category === "Món Nước" && dish.price >= 0 && dish.price <= 100000 && !dish.available
    ));
    assert.deepEqual(
      advancedByName.items.map((dish) => dish.id),
      basicByName.items.map((dish) => dish.id)
    );
  });
  check("legacy status and category query filters remain compatible", () => {
    assert.ok(legacyUnavailable.items.length > 0);
    assert.ok(legacyUnavailable.items.every((dish) => dish.available === false));
    assert.ok(legacyCategory.items.length > 0);
    assert.ok(legacyCategory.items.every((dish) => dish.category === "Món Nước"));
  });

  for (const sort of ["price_asc", "price_desc", "name_asc", "name_desc"]) {
    const ordered = await getAll({ sort });
    const independentQuery = {
      price_asc: Prisma.sql`SELECT id FROM dishes ORDER BY price ASC, id ASC`,
      price_desc: Prisma.sql`SELECT id FROM dishes ORDER BY price DESC, id ASC`,
      name_asc: Prisma.sql`SELECT id FROM dishes ORDER BY name ASC, id ASC`,
      name_desc: Prisma.sql`SELECT id FROM dishes ORDER BY name DESC, id ASC`,
    }[sort];
    const expected = await prisma.$queryRaw(independentQuery);
    check(`${sort} is stable across the complete result set`, () => {
      assert.deepEqual(ordered.items.map((dish) => dish.id), expected.map((dish) => dish.id));
    });
  }

  const fulltext = await getAll({ mode: "fulltext", q: "smoky basil" });
  const fulltextNull = await getAll({ mode: "fulltext", q: "seed" });
  check("full-text finds non-adjacent terms and handles NULL descriptions", () => {
    assert.ok(fulltext.items.some((dish) => dish.name === "Garden Bowl Fixture"));
    assert.ok(fulltextNull.items.some((dish) => dish.description === null));
    for (let index = 1; index < fulltext.items.length; index += 1) {
      const previous = fulltext.items[index - 1];
      const current = fulltext.items[index];
      assert.ok(previous.searchScore > current.searchScore ||
        (previous.searchScore === current.searchScore && previous.id < current.id));
    }
  });

  const fuzzy = await getAll({ mode: "fuzzy", q: "Pho Bo Huee" });
  check("fuzzy results require exact short words and at most one edit in longer words", () => {
    assert.equal(fuzzy.items[0].name, "Pho Bo Hue");
    assert.ok(fuzzy.items.every((dish) => dish.searchScore >= 0.3));
    for (let index = 1; index < fuzzy.items.length; index += 1) {
      const previous = fuzzy.items[index - 1];
      const current = fuzzy.items[index];
      assert.ok(previous.searchScore > current.searchScore ||
        (previous.searchScore === current.searchScore && previous.id < current.id));
    }
  });

  const lastPage = await get({ page: Math.ceil(all.total / 37), pageSize: 37 });
  check("total is identical on first and final page", () => {
    assert.equal(lastPage.body.data.total, all.total);
  });

  if (failures.length) {
    console.error(`\n${failures.length} Block 7 verification check(s) failed.`);
    process.exitCode = 1;
  } else {
    console.log("\nAll Block 7 API checks passed.");
  }
}

main()
  .catch((error) => {
    console.error("Block 7 verification could not complete.", { type: error.name, message: error.message });
    process.exitCode = 1;
  })
  .finally(async () => {
    await Promise.all([prisma.$disconnect(), closeSessionPool()]);
  });
