CREATE TABLE "bot_readers" (
  "botId" TEXT NOT NULL REFERENCES "bots"("id") ON DELETE CASCADE,
  "userId" TEXT NOT NULL REFERENCES "user"("id") ON DELETE CASCADE,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY ("botId", "userId")
);
CREATE INDEX "bot_readers_userId_idx" ON "bot_readers"("userId");