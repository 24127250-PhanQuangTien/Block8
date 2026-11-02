require("dotenv").config();
const path = require("node:path");
require("dotenv").config({ path: path.resolve(__dirname, "../../.env") });
const argon2 = require("argon2");
const prisma = require("../src/prisma");
const { normalizeEmail, validEmail, validPassword } = require("../src/services/authValidation");

async function main() {
  const emailRaw = process.env.SEED_USER_EMAIL || "";
  const password = process.env.SEED_USER_PASSWORD || "";
  const email = normalizeEmail(emailRaw);
  if (!validEmail(email)) throw new Error("SEED_USER_EMAIL must be a valid email address.");
  if (!validPassword(password)) {
    throw new Error("SEED_USER_PASSWORD must be 8–128 characters and contain a letter and a number.");
  }

  const passwordHash = await argon2.hash(password, { type: argon2.argon2id });
  await prisma.user.upsert({
    where: { email },
    create: {
      emailRaw,
      email,
      passwordHash,
      role: "viewer",
      status: "active",
      emailVerifiedAt: new Date(),
    },
    update: {
      emailRaw,
      passwordHash,
      role: "viewer",
      status: "active",
      emailVerifiedAt: new Date(),
    },
  });
  console.log("Auth seed account is ready.");
}

main()
  .catch((error) => {
    console.error("Auth seed failed.", {
      name: error.name,
      code: /^P\d{4}$/.test(error.code) ? error.code : undefined,
      message: /^(SEED_USER_EMAIL|SEED_USER_PASSWORD|DATABASE_URL is required)/.test(error.message)
        ? error.message
        : undefined,
    });
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
