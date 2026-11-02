const path = require("node:path");
require("dotenv").config();
require("dotenv").config({ path: path.resolve(__dirname, "../../.env") });
const test = require("node:test");
const assert = require("node:assert/strict");
const prisma = require("../src/prisma");
const { closeSessionPool } = require("../src/services/session");
const { createAuthenticatedAgent } = require("./helpers/authenticatedAgent");
const { Prisma } = require("@prisma/client");
const { fuzzyScoreSql, dishFuzzyScoreSql, FUZZY_SIMILARITY_THRESHOLD } = require("../src/search");

let agent;

test.before(async () => {
  agent = await createAuthenticatedAgent();
});

test.after(async () =>
{
  await Promise.all([prisma.$disconnect(), closeSessionPool()]);
});

test("Vietnamese fuzzy search ignores accents, case, decomposed marks and đ in short queries", async () =>
{
  for (const [name, query] of [
    ["Thịt thăn bò Úc", "thit"],
    ["Thịt thăn bò Úc", "THỊT"],
    ["Thịt thăn bò Úc".normalize("NFD"), "thit"],
    ["Thịt thăn bò Úc", "thịt".normalize("NFD")],
    ["Đường trắng", "duong"],
    ["Thịt thăn bò Úc", "thitt"],
  ])
  {
    const rows = await prisma.$queryRaw(Prisma.sql`SELECT ${fuzzyScoreSql(name, query)} AS score`);
    assert.ok(rows[0].score >= 0.3, `${query} should match ${name}`);
  }
  const unrelated = await prisma.$queryRaw(Prisma.sql`SELECT ${fuzzyScoreSql("Muối", "thit")} AS score`);
  assert.ok(unrelated[0].score < 0.3);
});

test("Single-edit matching accepts all four edit types and rejects noise from short words", async () =>
{
  assert.equal(FUZZY_SIMILARITY_THRESHOLD, 0.3);
  const cases = [
    ["quay", "quay", 1],
    ["quay", "qauy", 0.75],
    ["quay", "quayy", 0.75],
    ["duong", "dung", 0.75],
    ["quay", "quai", 0.75],
    ["ba", "banh", 0],
    ["hoi", "hoe", 0],
    ["heo", "hoe", 0],
    ["ga", "ca", 0],
    ["bo", "bo", 1],
    ["quay", "qay", 0],
    ["Úc", "ucx", 0],
    ["quay", "qaayx", 0],
    ["Thịt ba chỉ heo", "banh heo", 0],
    ["Bánh hỏi heo quay", "banh qauy", 0.875],
    ["Bánh hỏi heo quay", "banh heo", 1],
    ["Bánh hỏi heo quay", "quay BANH", 1],
    ["Thịt thăn bò Úc", "thit than bo uc", 1],
    ["Bánh hỏi heo quay", "banh-missing", 0],
    ["Bánh hỏi heo quay", "!!!", 0],
  ];
  const queries = cases.map(([name, query], index) => Prisma.sql`SELECT ${index}::int AS index, ${fuzzyScoreSql(name, query)} AS score`);
  const results = await prisma.$queryRaw(Prisma.join(queries, " UNION ALL "));
  for (const result of results)
  {
    const [name, query, expected] = cases[result.index];
    assert.equal(result.score, expected, `${query} -> ${name}`);
  }
});

test("Multi-word fuzzy queries require every term and reject unrelated or partial matches", async () =>
{
  for (const query of ["Banh quay", "QUAY BÁNH", "  banh   quay  ", "banhh quay", "banh qauy"])
  {
    const rows = await prisma.$queryRaw(Prisma.sql`
      SELECT candidate.name, ${fuzzyScoreSql(Prisma.sql`candidate.name`, query)} AS score
      FROM (VALUES ('Bánh hỏi heo quay'), ('Mì Quảng tôm thịt'), ('Bánh hỏi'), ('Heo quay'), ('Bánh canh')) AS candidate(name)
    `);
    const matches = rows.filter((row) => row.score >= 0.3).map((row) => row.name);
    assert.deepEqual(matches, ["Bánh hỏi heo quay"], query);
  }
});

test("Misspelled roast queries work while banh heo excludes dishes linked only to pork belly", async () =>
{
  for (const q of ["banh qauy", "banh heo"])
  {
    const result = await agent.get("/api/dishes").query({ mode: "advanced", match: "fuzzy", q, pageSize: "100" });
    assert.equal(result.body.ok, true);
    assert.ok(result.body.data.items.some((dish) => dish.name === "Bánh hỏi heo quay"));
    assert.ok(result.body.data.items.every((dish) => dish.name !== "B7 Seed 0039 - Lẩu Nấm Thanh Vị"));
    assert.equal(new Set(result.body.data.items.map((dish) => dish.id)).size, result.body.data.items.length);
  }
  const exact = await agent.get("/api/dishes").query({ mode: "advanced", match: "fuzzy", q: "banh quay", pageSize: "100" });
  assert.equal(exact.body.ok, true);
  assert.ok(exact.body.data.items.every((item) => item.searchScore >= FUZZY_SIMILARITY_THRESHOLD));
  assert.ok(exact.body.data.items.every((item, index, items) => !index || items[index - 1].searchScore >= item.searchScore));
});

test("Dish search for Banh quay excludes unrelated dishes and counts the same filtered set", async () =>
{
  const query = { mode: "advanced", match: "fuzzy", q: "Banh quay", pageSize: "100" };
  const result = await agent.get("/api/dishes").query(query);
  assert.equal(result.body.ok, true);
  assert.ok(result.body.data.items.every((dish) => dish.name !== "Mì Quảng Tôm Thịt"));
  const expected = await prisma.$queryRaw(Prisma.sql`
    SELECT count(*)::int AS total FROM dishes d WHERE ${dishFuzzyScoreSql("Banh quay")} >= 0.3
  `);
  assert.equal(result.body.data.total, expected[0].total);
  const outside = await agent.get("/api/dishes").query({ ...query, page: "99999" });
  assert.equal(outside.body.data.total, result.body.data.total);
  assert.deepEqual(outside.body.data.items, []);
});

for (const match of ["fuzzy", "fulltext"])
{
  test(`${match} finds dishes through linked ingredients without accents, duplicates or broken filters`, async () =>
  {
    const ingredient = await prisma.ingredient.findFirst({ where: { name: { equals: "Thịt thăn bò Úc", mode: "insensitive" } } });
    assert.ok(ingredient, "Requires the ingredient from the restaurant data");
    const query = { mode: "advanced", match, q: "Thit than bo Uc", pageSize: "100" };
    const plain = await agent.get("/api/dishes").query(query);
    const accented = await agent.get("/api/dishes").query({ ...query, q: ingredient.name });
    assert.equal(plain.body.ok, true);
    assert.equal(accented.body.ok, true);
    const items = plain.body.data.items;
    assert.ok(items.some((dish) => dish.name === "Phở Bò Tái Nạm" && dish.ingredients.some((item) => item.id === ingredient.id)));
    assert.equal(new Set(items.map((dish) => dish.id)).size, items.length);
    assert.equal(plain.body.data.total, accented.body.data.total);
    assert.deepEqual(items.map((dish) => dish.id), accented.body.data.items.map((dish) => dish.id));
    const filtered = await agent.get("/api/dishes").query({ ...query, category: "Món Nước", available: "false", minPrice: "0", maxPrice: "100000" });
    assert.equal(filtered.body.ok, true);
    assert.ok(filtered.body.data.items.every((dish) => dish.category === "Món Nước" && !dish.available && dish.price <= 100000));
    const next = await agent.get("/api/dishes").query({ ...query, page: "2" });
    assert.equal(next.body.data.total, plain.body.data.total);
    assert.ok(next.body.data.items.every((dish) => !items.some((previous) => previous.id === dish.id)));
  });
}

test("Ingredient endpoints return the same ordered results for thit and thịt with advanced filters", async () =>
{
  const query = { mode: "advanced", match: "fuzzy", category: "Thịt" };
  const plain = await agent.get("/api/ingredients").query({ ...query, q: "thit" });
  const accented = await agent.get("/api/ingredients").query({ ...query, q: "thịt" });
  assert.equal(plain.body.ok, true);
  assert.equal(accented.body.ok, true);
  assert.ok(plain.body.data.some((item) => item.name.toLowerCase().includes("thịt")));
  assert.deepEqual(plain.body.data.map((item) => item.id), accented.body.data.map((item) => item.id));
  assert.ok(plain.body.data.every((item) => item.category === "Thịt"));
});

test("Dish fuzzy results and totals agree for pho and phở", async () =>
{
  const query = { mode: "advanced", match: "fuzzy", pageSize: "100" };
  const plain = await agent.get("/api/dishes").query({ ...query, q: "pho" });
  const accented = await agent.get("/api/dishes").query({ ...query, q: "phở" });
  assert.equal(plain.body.ok, true);
  assert.equal(accented.body.ok, true);
  assert.ok(plain.body.data.total > 0);
  assert.equal(plain.body.data.total, accented.body.data.total);
  assert.deepEqual(plain.body.data.items.map((item) => item.id), accented.body.data.items.map((item) => item.id));
});

for (const match of ["fuzzy", "fulltext"])
{
  test(`${match} combines with advanced filters before counting and paging`, async () =>
  {
    const dish = await prisma.dish.findFirst({ where: { category: { not: null } }, orderBy: { id: "asc" } });
    assert.ok(dish, "Requires a database containing dishes");
    const query = {
      mode: "advanced", match, q: dish.name, category: dish.category,
      minPrice: String(dish.price), maxPrice: String(dish.price), available: String(dish.available), pageSize: "100",
    };
    const result = await agent.get("/api/dishes").query(query);
    assert.equal(result.status, 200);
    assert.equal(result.body.ok, true);
    assert.ok(result.body.data.items.some((item) => item.id === dish.id));
    assert.ok(result.body.data.items.every((item) => item.category === dish.category && item.price === dish.price && item.available === dish.available));
    const scores = result.body.data.items.map((item) => item.searchScore);
    assert.ok(scores.every((score, index) => Number.isFinite(score) && (!index || scores[index - 1] >= score)));
    const outside = await agent.get("/api/dishes").query({ ...query, page: "99999" });
    assert.equal(outside.body.data.total, result.body.data.total);
    assert.deepEqual(outside.body.data.items, []);
    const opposite = await agent.get("/api/dishes").query({ ...query, available: String(!dish.available) });
    assert.ok(opposite.body.data.items.every((item) => item.available !== dish.available));
  });
}

test("Empty text and boolean filters still allow browsing with zero price", async () =>
{
  const result = await agent.get("/api/dishes").query({ mode: "advanced", match: "fuzzy", q: " ", available: "", minPrice: "0", maxPrice: "0" });
  assert.equal(result.body.ok, true);
  assert.ok(result.body.data.items.every((item) => item.price === 0));
});

test("Ingredient fuzzy search tolerates a typo and intersects category and unit", async () =>
{
  const ingredients = await prisma.ingredient.findMany({ where: { category: { not: null } }, orderBy: { id: "asc" } });
  const ingredient = ingredients.find((item) => item.name.split(/\s+/u).some((word) => Array.from(word).length >= 4));
  assert.ok(ingredient);
  const word = ingredient.name.split(/\s+/u).find((item) => Array.from(item).length >= 4);
  const query = { mode: "advanced", match: "fuzzy", q: ingredient.name.replace(word, word + "x"), category: ingredient.category, unit: ingredient.unit };
  const result = await agent.get("/api/ingredients").query(query);
  assert.equal(result.status, 200);
  assert.equal(result.body.ok, true);
  assert.ok(result.body.data.some((item) => item.id === ingredient.id));
  assert.ok(result.body.data.every((item) => item.category === ingredient.category && item.unit === ingredient.unit));
  const noMatch = await agent.get("/api/ingredients").query({ ...query, unit: "no-such-unit" });
  assert.deepEqual(noMatch.body.data, []);
});

test("Chef basic search matches names only and treats wildcards literally", async () =>
{
  const chef = await prisma.chef.findFirst({ orderBy: { id: "asc" } });
  assert.ok(chef);
  const result = await agent.get("/api/chefs").query({ q: chef.name.toUpperCase() });
  assert.equal(result.body.ok, true);
  assert.ok(result.body.data.some((item) => item.id === chef.id));
  const wildcard = await agent.get("/api/chefs").query({ q: "%" });
  assert.ok(wildcard.body.data.every((item) => item.name.includes("%")));
  const specialty = await agent.get("/api/chefs").query({ q: chef.specialty });
  assert.ok(specialty.body.data.every((item) => item.name.toLowerCase().includes(chef.specialty.toLowerCase())));
});

test("Unsupported text rules return validation errors", async () =>
{
  for (const route of ["/api/dishes", "/api/ingredients"])
  {
    const result = await agent.get(route).query({ mode: "advanced", match: "unknown" });
    assert.equal(result.status, 200);
    assert.equal(result.body.ok, false);
    assert.equal(result.body.error.code, "VALIDATION_FAILED");
  }
});
