CREATE TABLE IF NOT EXISTS "user_trial" (
	"id" serial PRIMARY KEY NOT NULL,
	"clerk_user_id" text NOT NULL,
	"started_at" timestamp DEFAULT now() NOT NULL,
	"ends_at" timestamp NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "user_trial_clerk_user_id_unique" UNIQUE("clerk_user_id")
);
