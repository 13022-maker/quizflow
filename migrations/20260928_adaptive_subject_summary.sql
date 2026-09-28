CREATE TABLE IF NOT EXISTS "adaptive_subject_summary" (
	"subject_id" text PRIMARY KEY NOT NULL,
	"markdown" text NOT NULL,
	"generated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
