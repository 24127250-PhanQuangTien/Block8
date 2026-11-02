const crypto = require("node:crypto");
const express = require("express");
const argon2 = require("argon2");
const prisma = require("../prisma");
const { authPolicy, getAppBaseUrl } = require("../config/authPolicy");
const { consume, status, recordLoginFailure, clear } = require("../services/rateLimit");
const { generateOtp, hashOtp, hashResetToken, safeEqualText } = require("../services/otp");
const { issueCaptcha, consumeCaptcha } = require("../services/captcha");
const { sendMailInBackground } = require("../services/mail");
const { normalizeEmail, validEmail, validPassword } = require("../services/authValidation");

const router = express.Router();
const dummyHashPromise = argon2.hash(crypto.randomBytes(32).toString("base64url"));

function asyncRoute(handler) {
  return (req, res, next) => Promise.resolve(handler(req, res, next)).catch(next);
}

function renderForm(res, name, locals = {}, statusCode = 200) {
  res.set("Cache-Control", "no-store");
  return res.status(statusCode).render(`auth/${name}`, locals);
}

async function renderCaptchaForm(req, res, name, locals = {}) {
  try {
    const captcha = await issueCaptcha({
      anonId: req.session.anonId,
      purpose: name === "register" ? "register" : "login",
      ip: req.ip,
    });
    return renderForm(res, name, { ...locals, captcha, showCaptcha: true });
  } catch (error) {
    if (error.code === "RATE_LIMITED") return rateLimitPage(res);
    throw error;
  }
}

function baseLocals(req, values = {}) {
  return {
    csrfToken: req.session.csrfToken,
    errorCode: "",
    message: "",
    email: "",
    showActivationLink: false,
    showCaptcha: false,
    ...values,
  };
}

function rateLimitPage(res) {
  return renderForm(res, "error", {
    title: "Thử lại sau",
    message: "Bạn đã thực hiện quá nhiều yêu cầu. Vui lòng thử lại sau.",
    errorCode: "RATE_LIMITED",
  }, 429);
}

function saveSession(req) {
  return new Promise((resolve, reject) => {
    req.session.save((error) => (error ? reject(error) : resolve()));
  });
}

function regenerateSession(req) {
  return new Promise((resolve, reject) => {
    req.session.regenerate((error) => (error ? reject(error) : resolve()));
  });
}

function sendActivationEmail(email, otp) {
  sendMailInBackground({
    to: email,
    subject: "Mã kích hoạt tài khoản Restaurant App",
    text: `Mã kích hoạt của bạn là ${otp}. Mã có hiệu lực trong 10 phút.`,
    html: `<p>Mã kích hoạt của bạn:</p><strong>${otp}</strong><p>Mã có hiệu lực trong 10 phút.</p>`,
  });
}

async function issueActivationOtp(userId, email) {
  const otp = generateOtp();
  const now = new Date();
  await prisma.activationChallenge.create({
    data: {
      userId,
      purpose: "activation",
      otpHash: hashOtp(userId, otp),
      expiresAt: new Date(now.getTime() + authPolicy.activation.otpTtlMs),
      attempts: 0,
      lastSentAt: now,
      sendCount: 1,
      sendWindowStart: now,
    },
  });
  sendActivationEmail(email, otp);
}

async function resendActivationOtp(user) {
  let challenge = await prisma.activationChallenge.findUnique({ where: { userId: user.id } });
  if (!challenge) {
    await issueActivationOtp(user.id, user.email);
    return "sent";
  }

  const now = new Date();
  const sendWindowExpired = now.getTime() - challenge.sendWindowStart.getTime() >= 60 * 60 * 1000;
  if (!sendWindowExpired && challenge.sendCount >= authPolicy.activation.maxSendsPerHour) return "limited";
  if (now.getTime() - challenge.lastSentAt.getTime() < authPolicy.activation.resendCooldownMs) return "cooldown";

  const otp = generateOtp();
  const rows = await prisma.$queryRaw`
    UPDATE "ActivationChallenge"
    SET "otpHash" = ${hashOtp(user.id, otp)},
        "expiresAt" = ${new Date(now.getTime() + authPolicy.activation.otpTtlMs)},
        "lastSentAt" = ${now},
        "sendCount" = CASE
          WHEN "sendWindowStart" <= ${new Date(now.getTime() - 60 * 60 * 1000)} THEN 1
          ELSE "sendCount" + 1
        END,
        "sendWindowStart" = CASE
          WHEN "sendWindowStart" <= ${new Date(now.getTime() - 60 * 60 * 1000)} THEN ${now}
          ELSE "sendWindowStart"
        END
    WHERE "userId" = ${user.id}::uuid
      AND "purpose" = 'activation'
      AND "usedAt" IS NULL
      AND ("lastSentAt" <= ${new Date(now.getTime() - authPolicy.activation.resendCooldownMs)})
      AND ("sendWindowStart" <= ${new Date(now.getTime() - 60 * 60 * 1000)}
        OR "sendCount" < ${authPolicy.activation.maxSendsPerHour})
    RETURNING "id"
  `;
  if (!rows.length) {
    challenge = await prisma.activationChallenge.findUnique({ where: { userId: user.id } });
    if (challenge && challenge.sendCount >= authPolicy.activation.maxSendsPerHour
      && now.getTime() - challenge.sendWindowStart.getTime() < 60 * 60 * 1000) return "limited";
    return "cooldown";
  }
  sendActivationEmail(user.email, otp);
  return "sent";
}

async function verifyCaptcha(req, purpose) {
  return consumeCaptcha({
    challengeId: req.body.captchaChallengeId,
    anonId: req.session.anonId,
    purpose,
    answer: req.body.captchaAnswer,
  });
}

router.get("/register", asyncRoute(async (req, res) =>
  renderCaptchaForm(req, res, "register", baseLocals(req))));

router.post("/register", asyncRoute(async (req, res) => {
  const ipLimit = await consume(`register:ip:${req.ip}`, authPolicy.limits.register);
  if (!ipLimit.allowed) return rateLimitPage(res);

  const emailRaw = typeof req.body.email === "string" ? req.body.email : "";
  const email = normalizeEmail(emailRaw);
  if (!await verifyCaptcha(req, "register")) {
    return renderCaptchaForm(req, res, "register", baseLocals(req, {
      email: emailRaw.trim(),
      errorCode: "CAPTCHA_FAILED",
      message: "Mã xác minh không đúng hoặc đã hết hạn. Hãy nhập mã mới.",
    }));
  }
  if (!validEmail(email) || !validPassword(req.body.password)) {
    return renderCaptchaForm(req, res, "register", baseLocals(req, {
      email: emailRaw.trim(),
      errorCode: "VALIDATION_FAILED",
      message: "Email hoặc mật khẩu chưa đúng định dạng. Mật khẩu cần 8–128 ký tự, có chữ và số.",
    }));
  }

  const activationBudget = await consume(`activate:send:${email}`, {
    limit: authPolicy.activation.maxSendsPerHour,
    windowMs: 60 * 60 * 1000,
    lockMs: 60 * 60 * 1000,
  });
  const startedAt = Date.now();
  const passwordHash = await argon2.hash(req.body.password, { type: argon2.argon2id });
  const existing = activationBudget.allowed
    ? await prisma.user.findUnique({ where: { email } })
    : null;
  if (!existing && activationBudget.allowed) {
    try {
      const user = await prisma.user.create({
        data: { emailRaw, email, passwordHash, role: "viewer", status: "pending" },
      });
      await issueActivationOtp(user.id, email);
    } catch (error) {
      if (error.code !== "P2002") throw error;
    }
  } else if (existing?.status === "pending") {
    await resendActivationOtp(existing);
  }

  req.session.activationEmail = email;
  await saveSession(req);
  await new Promise((resolve) => setTimeout(resolve, Math.max(0, 250 - (Date.now() - startedAt))));
  return res.redirect(303, "/activate");
}));

router.get("/activate", (req, res) => {
  renderForm(res, "activate", baseLocals(req, {
    email: req.session.activationEmail || "",
    message: "Nếu email hợp lệ, chúng tôi đã gửi mã kích hoạt.",
  }));
});

router.post("/activate", asyncRoute(async (req, res) => {
  const ipLimit = await consume(`activate:ip:${req.ip}`, authPolicy.limits.activationIp);
  if (!ipLimit.allowed) return rateLimitPage(res);

  const email = normalizeEmail(req.body.email || req.session.activationEmail);
  const emailLimit = await consume(`activate:email:${email || "invalid"}`, authPolicy.limits.activationEmail);
  if (!emailLimit.allowed) return rateLimitPage(res);
  const otp = typeof req.body.otp === "string" ? req.body.otp : "";
  const user = validEmail(email)
    ? await prisma.user.findUnique({
      where: { email },
      include: { activation: true },
    })
    : null;
  let challenge = user?.activation;
  const now = new Date();
  if (challenge?.lockedUntil && challenge.lockedUntil > new Date()) return rateLimitPage(res);
  if (challenge?.attempts >= authPolicy.activation.maxAttempts && challenge.lockedUntil
    && challenge.lockedUntil <= now) {
    const reset = await prisma.activationChallenge.updateMany({
      where: { id: challenge.id, attempts: { gte: authPolicy.activation.maxAttempts }, lockedUntil: { lte: now } },
      data: { attempts: 0, lockedUntil: null },
    });
    if (reset.count === 1) challenge = { ...challenge, attempts: 0, lockedUntil: null };
  }

  const eligible = user?.status === "pending"
    && challenge?.purpose === "activation"
    && !challenge.usedAt
    && challenge.expiresAt > now
    && challenge.attempts < authPolicy.activation.maxAttempts
    && (!challenge.lockedUntil || challenge.lockedUntil <= now)
    && /^\d{6}$/.test(otp);
  const actualHash = eligible ? hashOtp(user.id, otp) : "";
  const matches = eligible && safeEqualText(actualHash, challenge.otpHash);

  if (!matches) {
    if (challenge && !challenge.usedAt) {
      await prisma.$executeRaw`
        UPDATE "ActivationChallenge"
        SET "attempts" = "attempts" + 1,
            "lockedUntil" = CASE
              WHEN "attempts" + 1 >= ${authPolicy.activation.maxAttempts}
                THEN ${new Date(now.getTime() + authPolicy.activation.lockMs)}
              ELSE "lockedUntil"
            END
        WHERE "id" = ${challenge.id}::uuid
          AND "usedAt" IS NULL
          AND ("lockedUntil" IS NULL OR "lockedUntil" <= ${now})
      `;
    }
    return renderForm(res, "activate", baseLocals(req, {
      email: req.body.email || req.session.activationEmail || "",
      errorCode: "INVALID_OTP",
      message: "Mã kích hoạt không hợp lệ hoặc đã hết hạn.",
    }));
  }

  try {
    await prisma.$transaction(async (tx) => {
      const claimed = await tx.$queryRaw`
        UPDATE "ActivationChallenge"
        SET "usedAt" = ${now}
        WHERE "id" = ${challenge.id}::uuid
          AND "userId" = ${user.id}::uuid
          AND "purpose" = 'activation'
          AND "otpHash" = ${actualHash}
          AND "usedAt" IS NULL
          AND "expiresAt" > ${now}
          AND "attempts" < ${authPolicy.activation.maxAttempts}
          AND ("lockedUntil" IS NULL OR "lockedUntil" <= ${now})
        RETURNING "userId"
      `;
      if (!claimed.length) {
        const race = new Error("Activation challenge was already consumed.");
        race.code = "ACTIVATION_RACE";
        throw race;
      }
      const activated = await tx.user.updateMany({
        where: { id: user.id, status: "pending" },
        data: { status: "active", emailVerifiedAt: now },
      });
      if (activated.count !== 1) {
        const race = new Error("Account was already activated.");
        race.code = "ACTIVATION_RACE";
        throw race;
      }
    });
  } catch (error) {
    if (error.code === "ACTIVATION_RACE") {
      return renderForm(res, "activate", baseLocals(req, {
        email,
        errorCode: "INVALID_OTP",
        message: "Mã kích hoạt không hợp lệ hoặc đã hết hạn.",
      }));
    }
    throw error;
  }
  delete req.session.activationEmail;
  await saveSession(req);
  return res.redirect(303, "/login?activated=1");
}));

router.post("/activate/resend", asyncRoute(async (req, res) => {
  const ipLimit = await consume(`activate:ip:${req.ip}`, authPolicy.limits.activationIp);
  if (!ipLimit.allowed) return rateLimitPage(res);

  const email = normalizeEmail(req.body.email || req.session.activationEmail);
  const resendLimit = await consume(`activate:send:${email || "invalid"}`, {
    limit: authPolicy.activation.maxSendsPerHour,
    windowMs: 60 * 60 * 1000,
    lockMs: 60 * 60 * 1000,
  });
  if (!resendLimit.allowed) return rateLimitPage(res);
  if (validEmail(email)) {
    const user = await prisma.user.findUnique({ where: { email } });
    if (user?.status === "pending") {
      const result = await resendActivationOtp(user);
      if (result === "limited") return rateLimitPage(res);
    }
  }
  req.session.activationEmail = email;
  await saveSession(req);
  return renderForm(res, "activate", baseLocals(req, {
    email,
    message: "Nếu email hợp lệ, chúng tôi đã gửi mã kích hoạt.",
  }));
}));

router.get("/login", (req, res) => {
  const activated = req.query.activated === "1";
  renderForm(res, "login", baseLocals(req, {
    message: activated ? "Tài khoản đã được kích hoạt. Hãy đăng nhập." : "",
  }));
});

router.post("/login", asyncRoute(async (req, res) => {
  const email = normalizeEmail(req.body.email);
  const ipResult = await consume(`login:ip:${req.ip}`, {
    limit: authPolicy.login.ipLimit,
    windowMs: authPolicy.login.windowMs,
    lockMs: authPolicy.login.windowMs,
  });
  if (!ipResult.allowed) return rateLimitPage(res);

  const accountKey = `login:email:${email}`;
  const accountStatus = await status(accountKey, authPolicy.login.windowMs);
  if (accountStatus.locked) return rateLimitPage(res);

  const needsCaptcha = accountStatus.count >= authPolicy.login.captchaAfter;
  if (needsCaptcha && !await verifyCaptcha(req, "login")) {
    return renderCaptchaForm(req, res, "login", baseLocals(req, {
      email: typeof req.body.email === "string" ? req.body.email.trim() : "",
      errorCode: "CAPTCHA_FAILED",
      message: "Mã xác minh không đúng hoặc đã hết hạn. Hãy nhập mã mới.",
      showCaptcha: true,
    }));
  }

  const user = validEmail(email) ? await prisma.user.findUnique({ where: { email } }) : null;
  const hash = user?.passwordHash || await dummyHashPromise;
  let passwordMatches = false;
  passwordMatches = await argon2.verify(hash, typeof req.body.password === "string" ? req.body.password : "");

  if (!user || !passwordMatches) {
    await recordLoginFailure(email);
    const locals = baseLocals(req, {
      email: typeof req.body.email === "string" ? req.body.email.trim() : "",
      errorCode: "",
      message: "Email hoặc mật khẩu không đúng.",
      showCaptcha: needsCaptcha,
    });
    return needsCaptcha ? renderCaptchaForm(req, res, "login", locals) : renderForm(res, "login", locals);
  }
  if (user.status !== "active") {
    return renderForm(res, "login", baseLocals(req, {
      email: user.email,
      message: "Tài khoản cần được kích hoạt trước khi đăng nhập.",
      showActivationLink: true,
    }));
  }

  await regenerateSession(req);
  req.session.userId = user.id;
  req.session.createdAt = Date.now();
  req.session.csrfToken = crypto.randomBytes(32).toString("base64url");
  req.session.anonId = crypto.randomUUID();
  await saveSession(req);
  await clear(accountKey);
  return res.redirect(303, "/");
}));

router.get("/forgot", (req, res) => {
  renderForm(res, "forgot", baseLocals(req));
});

router.post("/forgot", asyncRoute(async (req, res) => {
  const startedAt = Date.now();
  const email = normalizeEmail(req.body.email);
  const ipLimit = await consume(`forgot:ip:${req.ip}`, authPolicy.limits.forgotIp);
  if (!ipLimit.allowed) return rateLimitPage(res);
  const emailLimit = await consume(`forgot:email:${email || "invalid"}`, authPolicy.limits.forgotEmail);
  if (!emailLimit.allowed) return rateLimitPage(res);

  if (validEmail(email)) {
    const user = await prisma.user.findUnique({ where: { email } });
    if (user) {
      const token = crypto.randomBytes(32).toString("base64url");
      const now = new Date();
      await prisma.$transaction(async (tx) => {
        await tx.$queryRaw`SELECT "id" FROM "User" WHERE "id" = ${user.id}::uuid FOR UPDATE`;
        await tx.passwordReset.updateMany({
          where: { userId: user.id, usedAt: null },
          data: { usedAt: now },
        });
        await tx.passwordReset.create({
          data: {
            userId: user.id,
            tokenHash: hashResetToken(token),
            expiresAt: new Date(now.getTime() + authPolicy.resetTokenTtlMs),
          },
        });
      });
      const resetUrl = new URL("/reset", `${getAppBaseUrl()}/`);
      resetUrl.searchParams.set("token", token);
      sendMailInBackground({
        to: user.email,
        subject: "Đặt lại mật khẩu Restaurant App",
        text: `Mở liên kết sau để đặt lại mật khẩu trong 15 phút: ${resetUrl.toString()}`,
        html: `<p><a href="${resetUrl.toString()}">Đặt lại mật khẩu</a> (liên kết có hiệu lực trong 15 phút).</p>`,
      });
    }
  }
  await new Promise((resolve) => setTimeout(resolve, Math.max(0, 250 - (Date.now() - startedAt))));
  return renderForm(res, "forgot", baseLocals(req, {
    email: typeof req.body.email === "string" ? req.body.email.trim() : "",
    message: "Nếu email đã đăng ký, hướng dẫn đã được gửi.",
  }));
}));

router.get("/reset", asyncRoute(async (req, res) => {
  res.set("Referrer-Policy", "no-referrer");
  const token = typeof req.query.token === "string" ? req.query.token : "";
  const reset = token
    ? await prisma.passwordReset.findFirst({
      where: {
        tokenHash: hashResetToken(token),
        usedAt: null,
        expiresAt: { gt: new Date() },
      },
    })
    : null;
  renderForm(res, "reset", baseLocals(req, {
    token: reset ? token : "",
    errorCode: reset ? "" : "INVALID_RESET",
    message: reset ? "" : "Liên kết đặt lại mật khẩu không dùng được.",
    linkValid: Boolean(reset),
  }));
}));

router.post("/reset", asyncRoute(async (req, res) => {
  const token = typeof req.body.token === "string" ? req.body.token : "";
  const tokenHash = hashResetToken(token);
  const reset = token
    ? await prisma.passwordReset.findFirst({
      where: { tokenHash, usedAt: null, expiresAt: { gt: new Date() } },
    })
    : null;
  if (!reset) {
    res.set("Referrer-Policy", "no-referrer");
    return renderForm(res, "reset", baseLocals(req, {
      errorCode: "INVALID_RESET",
      message: "Liên kết đặt lại mật khẩu không dùng được.",
      linkValid: false,
    }));
  }
  if (!validPassword(req.body.password)) {
    res.set("Referrer-Policy", "no-referrer");
    return renderForm(res, "reset", baseLocals(req, {
      token,
      linkValid: true,
      errorCode: "VALIDATION_FAILED",
      message: "Mật khẩu cần 8–128 ký tự, có ít nhất một chữ cái và một chữ số.",
    }));
  }
  const now = new Date();
  const passwordHash = await argon2.hash(req.body.password, { type: argon2.argon2id });
  const resetUser = await prisma.$transaction(async (tx) => {
    await tx.$queryRaw`SELECT "id" FROM "User" WHERE "id" = ${reset.userId}::uuid FOR UPDATE`;
    const claimed = await tx.$queryRaw`
      UPDATE "PasswordReset"
      SET "usedAt" = ${now}
      WHERE "tokenHash" = ${tokenHash}
        AND "usedAt" IS NULL
        AND "expiresAt" > ${now}
      RETURNING "userId"
    `;
    if (!claimed.length) return null;
    const userId = claimed[0].userId;
    await tx.user.update({
      where: { id: userId },
      data: { passwordHash },
    });
    await tx.passwordReset.updateMany({
      where: { userId, usedAt: null },
      data: { usedAt: now },
    });
    await tx.$executeRaw`
      DELETE FROM "session"
      WHERE "sess"->>'userId' = ${userId}
    `;
    return tx.user.findUnique({ where: { id: userId }, select: { email: true } });
  });
  if (!resetUser) {
    res.set("Referrer-Policy", "no-referrer");
    return renderForm(res, "reset", baseLocals(req, {
      errorCode: "INVALID_RESET",
      message: "Liên kết đặt lại mật khẩu không dùng được.",
      linkValid: false,
    }));
  }

  sendMailInBackground({
    to: resetUser.email,
    subject: "Mật khẩu Restaurant App đã được thay đổi",
    text: "Mật khẩu tài khoản của bạn vừa được thay đổi. Nếu không phải bạn thực hiện, hãy liên hệ bộ phận hỗ trợ.",
    html: "<p>Mật khẩu tài khoản của bạn vừa được thay đổi.</p><p>Nếu không phải bạn thực hiện, hãy liên hệ bộ phận hỗ trợ.</p>",
  });
  return res.redirect(303, "/login?reset=1");
}));

router.get("/captcha/new", asyncRoute(async (req, res) => {
  try {
    const captcha = await issueCaptcha({
      anonId: req.session.anonId,
      purpose: req.query.purpose,
      ip: req.ip,
    });
    res.json(captcha);
  } catch (error) {
    if (error.code === "RATE_LIMITED") return res.status(429).json({ error: "RATE_LIMITED" });
    if (error.code === "INVALID_PURPOSE") return res.status(400).json({ error: "INVALID_PURPOSE" });
    throw error;
  }
}));

router.get("/csrf-token", (req, res) => {
  res.set("Cache-Control", "no-store");
  res.json({ token: req.session.csrfToken });
});

router.get("/api/me", (req, res) => {
  res.json({ email: req.authUser.email });
});

router.get("/api/csrf", (req, res) => {
  res.json({ token: req.session.csrfToken });
});

router.post("/logout", asyncRoute(async (req, res) => {
  await new Promise((resolve, reject) => {
    req.session.destroy((error) => (error ? reject(error) : resolve()));
  });
  res.clearCookie("sid", {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: "/",
  });
  res.redirect(303, "/login");
}));

module.exports = router;
