const fs = require("node:fs");
const path = require("node:path");
require("dotenv").config();
require("dotenv").config({ path: path.resolve(__dirname, "../../.env") });
const { Prisma } = require("@prisma/client");
const prisma = require("../src/prisma");

async function main() {
  const migrationPath = path.join(__dirname, "migrations", "20261102000000_block8_auth", "migration.sql");
  const statements = fs
    .readFileSync(migrationPath, "utf8")
    .split(";")
    .map((statement) => statement.trim())
    .filter(Boolean);

  for (const statement of statements) {
    await prisma.$executeRaw(Prisma.raw(statement));
  }
  console.log(`Block 8 auth migration applied (${statements.length} idempotent statements).`);
}

main()
  .catch((error) => {
    console.error("Block 8 auth migration failed.", {
      type: error.name,
      code: /^P\d{4}$/.test(error.code) ? error.code : undefined,
    });
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
