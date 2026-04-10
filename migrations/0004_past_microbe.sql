CREATE TABLE IF NOT EXISTS "ai_usage" (
	"id" serial PRIMARY KEY NOT NULL,
	"owner_id" text NOT NULL,
	"year_month" text NOT NULL,
	"count" integer DEFAULT 0 NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
