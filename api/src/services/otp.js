const crypto = require("node:crypto");

function generateOtp() {
  return crypto.randomInt(0, 1_000_000).toString().padStart(6, "0");
}

function hashOtp(userId, otp) {
  return crypto
    .createHmac("sha256", process.env.OTP_PEPPER)
    .update(`${userId}:${otp}`)
    .digest("hex");
}

function hashResetToken(token) {
  return crypto.createHash("sha256").update(token).digest("hex");
}

function safeEqualText(left, right) {
  const leftBuffer = Buffer.from(String(left));
  const rightBuffer = Buffer.from(String(right));
  return leftBuffer.length === rightBuffer.length && crypto.timingSafeEqual(leftBuffer, rightBuffer);
}

module.exports = { generateOtp, hashOtp, hashResetToken, safeEqualText };
