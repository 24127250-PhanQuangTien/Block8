const minute = 60 * 1000;
const hour = 60 * minute;

const authPolicy = Object.freeze({
  password: Object.freeze({ minLength: 8, maxLength: 128 }),
  activation: Object.freeze({
    otpDigits: 6,
    otpTtlMs: 10 * minute,
    maxAttempts: 5,
    lockMs: 15 * minute,
    resendCooldownMs: minute,
    maxSendsPerHour: 5,
  }),
  captcha: Object.freeze({ ttlMs: 5 * minute, ipLimit: 60, ipWindowMs: 15 * minute }),
  login: Object.freeze({
    windowMs: 15 * minute,
    captchaAfter: 3,
    maxFailures: 10,
    lockMs: 5 * minute,
    ipLimit: 30,
  }),
  limits: Object.freeze({
    register: Object.freeze({ limit: 10, windowMs: hour, lockMs: hour }),
    activationIp: Object.freeze({ limit: 20, windowMs: 15 * minute, lockMs: 15 * minute }),
    activationEmail: Object.freeze({ limit: 5, windowMs: 15 * minute, lockMs: 15 * minute }),
    forgotIp: Object.freeze({ limit: 20, windowMs: hour, lockMs: hour }),
    forgotEmail: Object.freeze({ limit: 5, windowMs: hour, lockMs: hour }),
  }),
  resetTokenTtlMs: 15 * minute,
  session: Object.freeze({ idleMs: 30 * minute, absoluteMs: 8 * hour }),
});

function assertAuthSecrets() {
  const missing = ["SESSION_SECRET", "OTP_PEPPER"].filter((name) => !process.env[name]);
  if (missing.length) {
    throw new Error(`Missing required authentication environment variable(s): ${missing.join(", ")}`);
  }
}

function getAppOrigin() {
  const configured = process.env.APP_ORIGIN || process.env.APP_BASE_URL || "http://localhost:3000";
  return new URL(configured).origin;
}

function getAppBaseUrl() {
  return (process.env.APP_BASE_URL || getAppOrigin()).replace(/\/+$/, "");
}

function getTrustProxy() {
  const value = process.env.TRUST_PROXY;
  if (!value || value === "0" || value.toLowerCase() === "false") return false;
  if (value === "true") return 1;
  const hops = Number(value);
  if (!Number.isInteger(hops) || hops < 1) {
    throw new Error("TRUST_PROXY must be 0, true, or a positive integer hop count.");
  }
  return hops;
}

module.exports = { authPolicy, assertAuthSecrets, getAppOrigin, getAppBaseUrl, getTrustProxy };
