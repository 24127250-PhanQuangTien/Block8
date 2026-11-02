require("dotenv").config();
require("dotenv").config({ path: require("node:path").resolve(__dirname, "../../.env") });
const path = require("node:path");
const express = require("express");
const dishesRouter = require("./routes/dishes");
const chefsRouter = require("./routes/chefs");
const ingredientsRouter = require("./routes/ingredients");
const authRouter = require("./routes/auth");
const { createSessionMiddleware } = require("./services/session");
const { csrfTokenMiddleware } = require("./middleware/csrf");
const { requireLogin } = require("./middleware/requireLogin");
const { getTrustProxy } = require("./config/authPolicy");

const app = express();
const webDist = path.resolve(__dirname, "../../web/dist");
const publicDirectory = path.resolve(__dirname, "../public");

app.disable("x-powered-by");
app.set("trust proxy", getTrustProxy());
app.set("view engine", "ejs");
app.set("views", path.resolve(__dirname, "../views"));

app.use(createSessionMiddleware());
app.use("/api", requireLogin);
app.post("/logout", requireLogin);
app.use(express.urlencoded({ extended: false, limit: "16kb" }));
app.use(express.json({ limit: "100kb" }));
app.use(csrfTokenMiddleware);

app.use(express.static(publicDirectory));
app.use(authRouter);

app.use("/api/dishes", dishesRouter);
app.use("/api/chefs", chefsRouter);
app.use("/api/ingredients", ingredientsRouter);
app.use("/api", (req, res) => {
  res.status(404).json({
    statusCode: 404,
    error: "Not Found",
    message: "Đường dẫn API không tồn tại.",
  });
});

app.use(requireLogin, express.static(webDist, { index: false }));
app.get("*", requireLogin, (req, res, next) => {
  res.sendFile(path.join(webDist, "index.html"), (error) => {
    if (error) next(error);
  });
});

app.use((req, res) => {
  res.status(404).render("auth/error", {
    title: "Không tìm thấy trang",
    message: "Đường dẫn không tồn tại.",
    errorCode: "NOT_FOUND",
    csrfToken: req.session?.csrfToken || "",
  });
});

app.use((error, req, res, next) => {
  console.error("Request failed.", {
    name: error?.name,
    code: /^P\d{4}$/.test(error?.code) ? error.code : undefined,
    method: req.method,
    path: req.path,
  });
  if (res.headersSent) return next(error);
  if (req.path.startsWith("/api/")) {
    return res.status(500).json({
      statusCode: 500,
      error: "Internal Server Error",
      message: "Đã xảy ra sự cố kỹ thuật.",
    });
  }
  res.status(500).render("auth/error", {
    title: "Lỗi máy chủ",
    message: "Đã xảy ra sự cố kỹ thuật. Vui lòng thử lại sau.",
    errorCode: "INTERNAL_ERROR",
    csrfToken: req.session?.csrfToken || "",
  });
});

module.exports = app;
