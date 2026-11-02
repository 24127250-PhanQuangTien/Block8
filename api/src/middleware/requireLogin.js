const prisma = require("../prisma");
const { authPolicy } = require("../config/authPolicy");

function destroySession(req) {
  return new Promise((resolve, reject) => {
    if (!req.session) return resolve();
    req.session.destroy((error) => (error ? reject(error) : resolve()));
  });
}

async function authorize(req, res, next) {
  const createdAt = Number(req.session?.createdAt);
  const expiredAbsolute = !Number.isFinite(createdAt)
    || Date.now() - createdAt >= authPolicy.session.absoluteMs;
  if (!req.session?.userId || expiredAbsolute) {
    await destroySession(req);
    return res.redirect(303, "/login");
  }

  const user = await prisma.user.findUnique({
    where: { id: req.session.userId },
    select: { id: true, email: true, status: true },
  });
  if (!user || user.status !== "active") {
    await destroySession(req);
    return res.redirect(303, "/login");
  }

  req.authUser = user;
  next();
}

function requireLogin(req, res, next) {
  authorize(req, res, next).catch(next);
}

module.exports = { requireLogin };
