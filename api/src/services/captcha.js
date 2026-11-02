const crypto = require("node:crypto");
const svgCaptcha = require("svg-captcha");
const prisma = require("../prisma");
const { authPolicy } = require("../config/authPolicy");
const { consume } = require("./rateLimit");

async function issueCaptcha({ anonId, purpose, ip }) {
  if (!["register", "login"].includes(purpose)) {
    const error = new Error("Unsupported CAPTCHA purpose.");
    error.code = "INVALID_PURPOSE";
    throw error;
  }
  const limit = await consume(`captcha:ip:${ip}`, {
    limit: authPolicy.captcha.ipLimit,
    windowMs: authPolicy.captcha.ipWindowMs,
    lockMs: authPolicy.captcha.ipWindowMs,
  });
  if (!limit.allowed) {
    const error = new Error("CAPTCHA rate limit reached.");
    error.code = "RATE_LIMITED";
    throw error;
  }

  const generated = svgCaptcha.create({
    size: 6,
    noise: 2,
    color: true,
    ignoreChars: "0o1i",
    background: "#f4f4f4",
  });
  const challengeId = crypto.randomUUID();
  const expiresAt = new Date(Date.now() + authPolicy.captcha.ttlMs);
  await prisma.$transaction(async (tx) => {
    await tx.$queryRaw`SELECT pg_advisory_xact_lock(hashtext(${anonId}), hashtext(${purpose}))::text AS "locked"`;
    await tx.captchaChallenge.updateMany({
      where: { anonId, purpose, usedAt: null },
      data: { usedAt: new Date() },
    });
    await tx.captchaChallenge.create({
      data: {
        id: challengeId,
        anonId,
        purpose,
        answer: generated.text,
        expiresAt,
      },
    });
  });
  return { challengeId, svg: generated.data };
}

async function consumeCaptcha({ challengeId, anonId, purpose, answer }) {
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(challengeId || "")
    || !answer) return false;
  const rows = await prisma.$queryRaw`
    UPDATE "CaptchaChallenge"
    SET "usedAt" = ${new Date()}
    WHERE "id" = ${challengeId}::uuid
      AND "anonId" = ${anonId}
      AND "purpose" = ${purpose}
      AND "usedAt" IS NULL
      AND "expiresAt" > ${new Date()}
    RETURNING "answer"
  `;
  if (!rows.length) return false;
  return String(rows[0].answer).toLowerCase() === String(answer).trim().toLowerCase();
}

module.exports = { issueCaptcha, consumeCaptcha };
