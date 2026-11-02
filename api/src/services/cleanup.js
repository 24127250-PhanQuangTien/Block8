const prisma = require("../prisma");

async function cleanupExpiredAuthData() {
  const now = new Date();
  await Promise.all([
    prisma.session.deleteMany({ where: { expire: { lt: now } } }),
    prisma.captchaChallenge.deleteMany({ where: { expiresAt: { lt: now } } }),
    prisma.passwordReset.deleteMany({
      where: {
        OR: [
          { expiresAt: { lt: now } },
          { usedAt: { lt: new Date(now.getTime() - 24 * 60 * 60 * 1000) } },
        ],
      },
    }),
    prisma.activationChallenge.deleteMany({
      where: { expiresAt: { lt: new Date(now.getTime() - 24 * 60 * 60 * 1000) } },
    }),
    prisma.rateLimit.deleteMany({
      where: {
        windowStart: { lt: new Date(now.getTime() - 48 * 60 * 60 * 1000) },
        OR: [{ lockedUntil: null }, { lockedUntil: { lt: now } }],
      },
    }),
  ]);
}

module.exports = { cleanupExpiredAuthData };
