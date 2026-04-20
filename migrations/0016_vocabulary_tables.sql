CREATE TABLE IF NOT EXISTS "vocabulary_set" (
	"id" serial PRIMARY KEY NOT NULL,
	"owner_id" text NOT NULL,
	"title" text NOT NULL,
	"access_code" text,
	"status" text DEFAULT 'draft' NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "vocabulary_set_access_code_unique" UNIQUE("access_code")
);--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "vocabulary_card" (
	"id" serial PRIMARY KEY NOT NULL,
	"set_id" integer NOT NULL REFERENCES "vocabulary_set"("id") ON DELETE CASCADE,
	"front" text NOT NULL,
	"back" text NOT NULL,
	"phonetic" text,
	"example" text,
	"position" integer NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL
);
