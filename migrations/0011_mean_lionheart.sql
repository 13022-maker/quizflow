CREATE TABLE IF NOT EXISTS "user_streak" (
	"id" serial PRIMARY KEY NOT NULL,
	"clerk_user_id" text NOT NULL,
	"current_streak" integer DEFAULT 0 NOT NULL,
	"longest_streak" integer DEFAULT 0 NOT NULL,
	"last_activity_at" timestamp,
	"freezes_left" integer DEFAULT 0 NOT NULL,
	"frozen_until" timestamp,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "user_streak_clerk_user_id_unique" UNIQUE("clerk_user_id")
);
