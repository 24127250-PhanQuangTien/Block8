import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

const authApiTarget = process.env.AUTH_API_TARGET || "http://localhost:3000";
const publicAuthPath = /^\/(?:register|activate|login|forgot|reset|logout|csrf-token|captcha(?:\/.*)?|auth\.(?:css|js))(?:\/|$)/;

function authGatePlugin() {
  return {
    name: "restaurant-auth-gate",
    configureServer(server) {
      server.middlewares.use(async (req, res, next) => {
        const pathname = new URL(req.url || "/", "http://vite.local").pathname;
        if (pathname.startsWith("/api") || publicAuthPath.test(pathname)) return next();

        try {
          const response = await fetch(new URL("/api/me", authApiTarget), {
            headers: req.headers.cookie ? { cookie: req.headers.cookie } : {},
            redirect: "manual",
          });
          const refreshedCookie = response.headers.get("set-cookie");
          if (refreshedCookie) res.setHeader("Set-Cookie", refreshedCookie);
          if (response.status === 303 || response.status === 401 || response.status === 403) {
            res.statusCode = 303;
            res.setHeader("Location", "/login");
            res.end();
            return;
          }
          if (!response.ok) {
            res.statusCode = 502;
            res.setHeader("Content-Type", "text/plain; charset=utf-8");
            res.end("Authentication service is unavailable.");
            return;
          }
          next();
        } catch (error) {
          next(error);
        }
      });
    },
  };
}

export default defineConfig({
  plugins: [authGatePlugin(), react()],
  server: {
    port: 5173,
    host: true,
    proxy: Object.fromEntries(
      ["/api", "/register", "/activate", "/login", "/forgot", "/reset", "/logout", "/csrf-token", "/captcha", "/auth.css", "/auth.js"]
        .map((route) => [route, { target: authApiTarget, changeOrigin: true }]),
    ),
  },
  appType: "spa",
});
