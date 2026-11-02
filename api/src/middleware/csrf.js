const crypto = require("node:crypto");
const { getAppOrigin } = require("../config/authPolicy");

function csrfTokenMiddleware(req, res, next) {
  if (!req.session.csrfToken) {
    req.session.csrfToken = crypto.randomBytes(32).toString("base64url");
  }
  if (!req.session.anonId) {
    req.session.anonId = crypto.randomUUID();
  }

  const safeMethods = new Set(["GET", "HEAD", "OPTIONS"]);
  if (safeMethods.has(req.method)) return next();

  const origin = req.get("Origin");
  if (origin && origin !== getAppOrigin()) {
    return res.status(403).render("auth/error", {
      title: "Yêu cầu không hợp lệ",
      message: "Không thể xác minh nguồn gửi yêu cầu.",
      errorCode: "CSRF_FAILED",
      csrfToken: req.session.csrfToken,
    });
  }

  const supplied = req.get("X-CSRF-Token") || req.body?._csrf;
  const expectedBuffer = Buffer.from(req.session.csrfToken);
  const suppliedBuffer = Buffer.from(typeof supplied === "string" ? supplied : "");
  const valid = expectedBuffer.length === suppliedBuffer.length
    && crypto.timingSafeEqual(expectedBuffer, suppliedBuffer);
  if (!valid) {
    console.warn("CSRF validation failed.", {
      method: req.method,
      path: req.path,
      originMatches: !origin || origin === getAppOrigin(),
      sessionIdPresent: Boolean(req.sessionID),
      sessionTokenPresent: Boolean(req.session.csrfToken),
      suppliedTokenPresent: typeof supplied === "string" && supplied.length > 0,
      expectedTokenLength: expectedBuffer.length,
      suppliedTokenLength: suppliedBuffer.length,
      sessionCookiePresent: Boolean(req.get("Cookie")?.split(";").some((cookie) => cookie.trim().startsWith("sid="))),
    });
    res.set("Cache-Control", "no-store");
    return res.status(403).render("auth/error", {
      title: "Yêu cầu không hợp lệ",
      message: "Phiên gửi biểu mẫu đã hết hạn. Hãy tải lại trang và thử lại.",
      errorCode: "CSRF_FAILED",
      csrfToken: req.session.csrfToken,
    });
  }
  next();
}

module.exports = { csrfTokenMiddleware };
