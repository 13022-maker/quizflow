CREATE TABLE IF NOT EXISTS "adaptive_subject" (
	"id" serial PRIMARY KEY NOT NULL,
	"owner_id" text NOT NULL,
	"name" text NOT NULL,
	"source_topic" text NOT NULL,
	"graph" jsonb NOT NULL,
	"item_bank" jsonb NOT NULL,
	"tutor" jsonb NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL
);
