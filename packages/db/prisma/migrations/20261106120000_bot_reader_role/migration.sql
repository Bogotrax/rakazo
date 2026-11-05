-- Readers keep reading; "participant" additionally allows sending conversation text.
ALTER TABLE "bot_readers" ADD COLUMN "role" TEXT NOT NULL DEFAULT 'reader';