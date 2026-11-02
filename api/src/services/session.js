const session = require("express-session");
const { Pool } = require("pg");
const connectPgSimple = require("connect-pg-simple");
const { authPolicy } = require("../config/authPolicy");

let pool;

function createSessionMiddleware() {
  const connectionString = process.env.SESSION_DATABASE_URL || process.env.DATABASE_URL;
  if (!connectionString) {
    throw new Error("DATABASE_URL is required for the PostgreSQL session store.");
  }

  pool = new Pool({
    connectionString,
    max: 5,
    idleTimeoutMillis: 30_000,
    connectionTimeoutMillis: 10_000,
  });
  pool.on("error", (error) => {
    console.error("Session database pool error.", { name: error.name, code: error.code });
  });

  const PgStore = connectPgSimple(session);
  const store = new PgStore({
    pool,
    tableName: "session",
    createTableIfMissing: false,
    pruneSessionInterval: 15 * 60,
  });

  return session({
    name: "sid",
    secret: process.env.SESSION_SECRET,
    store,
    resave: false,
    saveUninitialized: false,
    rolling: true,
    cookie: {
      httpOnly: true,
      sameSite: "lax",
      secure: process.env.NODE_ENV === "production",
      path: "/",
      maxAge: authPolicy.session.idleMs,
    },
  });
}

async function closeSessionPool() {
  if (pool) await pool.end();
}

module.exports = { createSessionMiddleware, closeSessionPool };
