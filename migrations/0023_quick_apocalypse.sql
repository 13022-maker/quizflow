ALTER TABLE "quiz" ADD COLUMN "visibility" text DEFAULT 'private' NOT NULL;--> statement-breakpoint
ALTER TABLE "quiz" ADD COLUMN "slug" text;--> statement-breakpoint
ALTER TABLE "quiz" ADD COLUMN "published_at" timestamp;--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "quiz" ADD CONSTRAINT "quiz_original_quiz_id_quiz_id_fk" FOREIGN KEY ("original_quiz_id") REFERENCES "public"."quiz"("id") ON DELETE set null ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "quiz_slug_unique_idx" ON "quiz" USING btree ("slug") WHERE "quiz"."slug" IS NOT NULL;--> statement-breakpoint
ALTER TABLE "quiz" ADD CONSTRAINT "quiz_visibility_check" CHECK ("quiz"."visibility" IN ('private', 'unlisted', 'public'));