const test = require("node:test");
const assert = require("node:assert/strict");
const crypto = require("node:crypto");
const { authPolicy } = require("../src/config/authPolicy");
const { normalizeEmail, validEmail, validPassword } = require("../src/services/authValidation");
const { generateOtp, hashOtp, hashResetToken, safeEqualText } = require("../src/services/otp");

test("email normalization trims and lowercases the entire address", () => {
  assert.equal(normalizeEmail("  User.Name+tag@Example.COM  "), "user.name+tag@example.com");
  assert.equal(validEmail(normalizeEmail("user@example.com")), true);
  assert.equal(validEmail(normalizeEmail("not-an-email")), false);
});

test("password policy enforces length, letters, and digits", () => {
  assert.equal(validPassword("abc12345"), true);
  assert.equal(validPassword("mậtkhẩu123"), true);
  assert.equal(validPassword("abcdefgh"), false);
  assert.equal(validPassword("12345678"), false);
  assert.equal(validPassword("a1".repeat(64)), true);
  assert.equal(validPassword(`a1${"x".repeat(127)}`), false);
});

test("activation OTP is six digits and is stored as a keyed digest", () => {
  process.env.OTP_PEPPER = "test-only-pepper-value";
  const otp = generateOtp();
  assert.match(otp, /^\d{6}$/);
  const digest = hashOtp("user-id", otp);
  assert.match(digest, /^[a-f0-9]{64}$/);
  assert.notEqual(digest, otp);
  assert.equal(safeEqualText(digest, hashOtp("user-id", otp)), true);
  assert.equal(safeEqualText(digest, hashOtp("other-user", otp)), false);
});

test("reset tokens use a SHA-256 digest and safe comparison rejects unequal lengths", () => {
  const token = crypto.randomBytes(32).toString("base64url");
  assert.equal(hashResetToken(token), crypto.createHash("sha256").update(token).digest("hex"));
  assert.equal(safeEqualText("same", "same"), true);
  assert.equal(safeEqualText("short", "longer"), false);
});

test("authentication policy contains the required session and challenge limits", () => {
  assert.equal(authPolicy.activation.otpTtlMs, 10 * 60 * 1000);
  assert.equal(authPolicy.activation.maxAttempts, 5);
  assert.equal(authPolicy.captcha.ttlMs, 5 * 60 * 1000);
  assert.equal(authPolicy.login.captchaAfter, 3);
  assert.equal(authPolicy.login.maxFailures, 10);
  assert.equal(authPolicy.session.idleMs, 30 * 60 * 1000);
  assert.equal(authPolicy.session.absoluteMs, 8 * 60 * 60 * 1000);
});
