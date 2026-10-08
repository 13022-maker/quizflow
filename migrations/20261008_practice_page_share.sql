CREATE TABLE IF NOT EXISTS "practice_page_share" (
	"id" serial PRIMARY KEY NOT NULL,
	"quiz_id" integer NOT NULL,
	"owner_id" text NOT NULL,
	"url" text NOT NULL,
	"question_range" text NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "practice_page_share" ADD CONSTRAINT "practice_page_share_quiz_id_quiz_id_fk" FOREIGN KEY ("quiz_id") REFERENCES "public"."quiz"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "practice_page_share_quiz_id_idx" ON "practice_page_share" USING btree ("quiz_id");