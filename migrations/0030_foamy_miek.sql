UPDATE "quiz" SET "tags" = '{}'::text[] WHERE "tags" IS NULL;--> statement-breakpoint
ALTER TABLE "quiz" ALTER COLUMN "tags" SET DEFAULT '{}'::text[];--> statement-breakpoint
ALTER TABLE "quiz" ALTER COLUMN "tags" SET NOT NULL;--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "quiz_public_recent_idx" ON "quiz" USING btree ("published_at" DESC NULLS LAST) WHERE "quiz"."visibility" = 'public';--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "quiz_forked_from_idx" ON "quiz" USING btree ("forked_from_id") WHERE "quiz"."forked_from_id" IS NOT NULL;