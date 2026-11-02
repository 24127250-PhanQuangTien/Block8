CREATE TABLE IF NOT EXISTS "User" (
  "id" UUID NOT NULL,
  "emailRaw" TEXT NOT NULL,
  "email" TEXT NOT NULL,
  "passwordHash" TEXT NOT NULL,
  "role" TEXT NOT NULL DEFAULT 'viewer',
  "status" TEXT NOT NULL DEFAULT 'pending',
  "emailVerifiedAt" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "User_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "User_status_check" CHECK ("status" IN ('pending', 'active'))
);

CREATE UNIQUE INDEX IF NOT EXISTS "User_email_key" ON "User"("email");

CREATE TABLE IF NOT EXISTS "ActivationChallenge" (
  "id" UUID NOT NULL,
  "userId" UUID NOT NULL,
  "purpose" TEXT NOT NULL DEFAULT 'activation',
  "otpHash" TEXT NOT NULL,
  "expiresAt" TIMESTAMP(3) NOT NULL,
  "attempts" INTEGER NOT NULL DEFAULT 0,
  "lockedUntil" TIMESTAMP(3),
  "lastSentAt" TIMESTAMP(3) NOT NULL,
  "sendCount" INTEGER NOT NULL DEFAULT 1,
  "sendWindowStart" TIMESTAMP(3) NOT NULL,
  "usedAt" TIMESTAMP(3),
  CONSTRAINT "ActivationChallenge_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "ActivationChallenge_userId_fkey"
    FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE
);

CREATE UNIQUE INDEX IF NOT EXISTS "ActivationChallenge_userId_key"
  ON "ActivationChallenge"("userId");
CREATE INDEX IF NOT EXISTS "ActivationChallenge_expiresAt_idx"
  ON "ActivationChallenge"("expiresAt");

CREATE TABLE IF NOT EXISTS "PasswordReset" (
  "id" UUID NOT NULL,
  "userId" UUID NOT NULL,
  "tokenHash" TEXT NOT NULL,
  "expiresAt" TIMESTAMP(3) NOT NULL,
  "usedAt" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "PasswordReset_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "PasswordReset_userId_fkey"
    FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE
);

CREATE UNIQUE INDEX IF NOT EXISTS "PasswordReset_tokenHash_key"
  ON "PasswordReset"("tokenHash");
CREATE INDEX IF NOT EXISTS "PasswordReset_userId_idx"
  ON "PasswordReset"("userId");
CREATE INDEX IF NOT EXISTS "PasswordReset_expiresAt_idx"
  ON "PasswordReset"("expiresAt");
CREATE UNIQUE INDEX IF NOT EXISTS "PasswordReset_one_unused_per_user_key"
  ON "PasswordReset"("userId") WHERE "usedAt" IS NULL;

CREATE TABLE IF NOT EXISTS "CaptchaChallenge" (
  "id" UUID NOT NULL,
  "anonId" TEXT NOT NULL,
  "purpose" TEXT NOT NULL,
  "answer" TEXT NOT NULL,
  "expiresAt" TIMESTAMP(3) NOT NULL,
  "usedAt" TIMESTAMP(3),
  CONSTRAINT "CaptchaChallenge_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "CaptchaChallenge_purpose_check" CHECK ("purpose" IN ('register', 'login'))
);

CREATE INDEX IF NOT EXISTS "CaptchaChallenge_expiresAt_idx"
  ON "CaptchaChallenge"("expiresAt");
CREATE INDEX IF NOT EXISTS "CaptchaChallenge_anonId_purpose_idx"
  ON "CaptchaChallenge"("anonId", "purpose");

CREATE TABLE IF NOT EXISTS "RateLimit" (
  "key" TEXT NOT NULL,
  "count" INTEGER NOT NULL DEFAULT 0,
  "windowStart" TIMESTAMP(3) NOT NULL,
  "lockedUntil" TIMESTAMP(3),
  CONSTRAINT "RateLimit_pkey" PRIMARY KEY ("key")
);

CREATE INDEX IF NOT EXISTS "RateLimit_windowStart_idx" ON "RateLimit"("windowStart");
CREATE INDEX IF NOT EXISTS "RateLimit_lockedUntil_idx" ON "RateLimit"("lockedUntil");

CREATE TABLE IF NOT EXISTS "session" (
  "sid" VARCHAR(255) NOT NULL,
  "sess" JSON NOT NULL,
  "expire" TIMESTAMP(6) NOT NULL,
  CONSTRAINT "session_pkey" PRIMARY KEY ("sid")
);

CREATE INDEX IF NOT EXISTS "session_expire_idx" ON "session"("expire");
