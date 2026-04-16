CREATE TABLE IF NOT EXISTS "quiz_attempt" (
	"id" serial PRIMARY KEY NOT NULL,
	"quiz_id" integer NOT NULL,
	"student_email" text NOT NULL,
	"attempt_number" integer NOT NULL,
	"raw_score" real NOT NULL,
	"weighted_score" real NOT NULL,
	"time_spent_secs" integer,
	"response_id" integer,
	"submitted_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "quiz_final_score" (
	"id" serial PRIMARY KEY NOT NULL,
	"quiz_id" integer NOT NULL,
	"student_email" text NOT NULL,
	"final_score" real NOT NULL,
	"total_attempts" integer DEFAULT 1 NOT NULL,
	"winning_attempt_id" integer,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "quiz" ADD COLUMN "scoring_mode" text DEFAULT 'highest' NOT NULL;--> statement-breakpoint
ALTER TABLE "quiz" ADD COLUMN "attempt_decay_rate" real DEFAULT 0.9 NOT NULL;--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "quiz_attempt" ADD CONSTRAINT "quiz_attempt_quiz_id_quiz_id_fk" FOREIGN KEY ("quiz_id") REFERENCES "public"."quiz"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "quiz_attempt" ADD CONSTRAINT "quiz_attempt_response_id_response_id_fk" FOREIGN KEY ("response_id") REFERENCES "public"."response"("id") ON DELETE set null ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "quiz_final_score" ADD CONSTRAINT "quiz_final_score_quiz_id_quiz_id_fk" FOREIGN KEY ("quiz_id") REFERENCES "public"."quiz"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "quiz_final_score" ADD CONSTRAINT "quiz_final_score_winning_attempt_id_quiz_attempt_id_fk" FOREIGN KEY ("winning_attempt_id") REFERENCES "public"."quiz_attempt"("id") ON DELETE set null ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
