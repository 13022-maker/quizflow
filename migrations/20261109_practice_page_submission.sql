CREATE TABLE IF NOT EXISTS "practice_page_submission" (
	"id" serial PRIMARY KEY NOT NULL,
	"share_id" integer NOT NULL,
	"session_id" text NOT NULL,
	"class_name" text NOT NULL,
	"student_name" text NOT NULL,
	"score" integer NOT NULL,
	"max_score" integer NOT NULL,
	"detail" jsonb NOT NULL,
	"result_token" text NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "practice_page_share" ADD COLUMN "answer_key" jsonb;--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "practice_page_submission" ADD CONSTRAINT "practice_page_submission_share_id_practice_page_share_id_fk" FOREIGN KEY ("share_id") REFERENCES "public"."practice_page_share"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "practice_page_submission_share_session_idx" ON "practice_page_submission" USING btree ("share_id","session_id");--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "practice_page_submission_result_token_idx" ON "practice_page_submission" USING btree ("result_token");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "practice_page_submission_share_created_idx" ON "practice_page_submission" USING btree ("share_id","created_at");