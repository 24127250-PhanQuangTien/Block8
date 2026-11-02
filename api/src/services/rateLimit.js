const prisma = require("../prisma");
const { authPolicy } = require("../config/authPolicy");

async function consume(key, { limit, windowMs, lockMs = windowMs, lockAtLimit = false }) {
  const now = new Date();
  const cutoff = new Date(now.getTime() - windowMs);
  const lockUntil = new Date(now.getTime() + lockMs);
  const lockThreshold = limit + (lockAtLimit ? 0 : 1);
  const rows = await prisma.$queryRaw`
    INSERT INTO "RateLimit" ("key", "count", "windowStart", "lockedUntil")
    VALUES (${key}, 1, ${now}, NULL)
    ON CONFLICT ("key") DO UPDATE SET
      "count" = CASE
        WHEN "RateLimit"."windowStart" <= ${cutoff} THEN 1
        ELSE "RateLimit"."count" + 1
      END,
      "windowStart" = CASE
        WHEN "RateLimit"."windowStart" <= ${cutoff} THEN ${now}
        ELSE "RateLimit"."windowStart"
      END,
      "lockedUntil" = CASE
        WHEN "RateLimit"."lockedUntil" > ${now} THEN "RateLimit"."lockedUntil"
        WHEN "RateLimit"."windowStart" <= ${cutoff} THEN NULL
        WHEN "RateLimit"."count" + 1 >= ${lockThreshold} THEN ${lockUntil}
        ELSE NULL
      END
    RETURNING "count", "windowStart", "lockedUntil"
  `;
  const row = rows[0];
  return {
    allowed: !row.lockedUntil || row.lockedUntil <= now,
    count: row.windowStart <= cutoff ? 1 : row.count,
    lockedUntil: row.lockedUntil,
  };
}

async function status(key, windowMs) {
  const row = await prisma.rateLimit.findUnique({ where: { key } });
  if (!row) return { count: 0, locked: false, lockedUntil: null };
  const now = Date.now();
  const count = now - row.windowStart.getTime() >= windowMs ? 0 : row.count;
  return {
    count,
    locked: Boolean(row.lockedUntil && row.lockedUntil.getTime() > now),
    lockedUntil: row.lockedUntil,
  };
}

async function recordLoginFailure(email) {
  return consume(`login:email:${email}`, {
    limit: authPolicy.login.maxFailures,
    windowMs: authPolicy.login.windowMs,
    lockMs: authPolicy.login.lockMs,
    lockAtLimit: true,
  });
}

async function clear(key) {
  await prisma.rateLimit.deleteMany({ where: { key } });
}

module.exports = { consume, status, recordLoginFailure, clear };
