require("dotenv").config();
require("dotenv").config({ path: require("node:path").resolve(__dirname, "../../.env") });
const { assertAuthSecrets } = require("./config/authPolicy");

async function startServer() {
  assertAuthSecrets();
  if (!process.env.DATABASE_URL) {
    throw new Error("DATABASE_URL is required to start the application.");
  }

  const app = require("./app");
  const prisma = require("./prisma");
  const { closeSessionPool } = require("./services/session");
  const { cleanupExpiredAuthData } = require("./services/cleanup");
  await cleanupExpiredAuthData();

  const cleanupTimer = setInterval(() => {
    cleanupExpiredAuthData().catch((error) => {
      console.error("Authentication cleanup failed.", { name: error.name, code: error.code });
    });
  }, 60 * 60 * 1000);
  cleanupTimer.unref();

  const port = Number(process.env.PORT || 3000);
  const server = app.listen(port, () => {
    console.log(`Restaurant API and auth server listening on port ${port}.`);
  });

  let shuttingDown = false;
  async function shutdown(signal) {
    if (shuttingDown) return;
    shuttingDown = true;
    clearInterval(cleanupTimer);
    console.log(`Received ${signal}; shutting down.`);
    server.close(async (error) => {
      if (error) {
        console.error("HTTP server shutdown failed.", { name: error.name, code: error.code });
        process.exitCode = 1;
      }
      await Promise.all([closeSessionPool(), prisma.$disconnect()]);
    });
  }

  process.on("SIGINT", () => void shutdown("SIGINT"));
  process.on("SIGTERM", () => void shutdown("SIGTERM"));
  return server;
}

startServer().catch((error) => {
  console.error("Application startup failed.", {
    name: error.name,
    code: /^P\d{4}$/.test(error.code) ? error.code : undefined,
    message: /^(Missing required authentication environment variable|DATABASE_URL is required|TRUST_PROXY must)/.test(error.message)
      ? error.message
      : undefined,
  });
  process.exitCode = 1;
});
