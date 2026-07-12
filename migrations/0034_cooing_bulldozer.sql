CREATE TABLE IF NOT EXISTS "adaptive_event" (
	"id" serial PRIMARY KEY NOT NULL,
	"practice_id" integer NOT NULL,
	"student_key" text NOT NULL,
	"display_name" text NOT NULL,
	"event_type" text NOT NULL,
	"knowledge_id" text,
	"detail" text,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "adaptive_practice" (
	"id" serial PRIMARY KEY NOT NULL,
	"owner_id" text NOT NULL,
	"subject_id" text NOT NULL,
	"title" text NOT NULL,
	"access_code" text NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "adaptive_practice_access_code_unique" UNIQUE("access_code")
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "adaptive_student_state" (
	"id" serial PRIMARY KEY NOT NULL,
	"practice_id" integer NOT NULL,
	"student_key" text NOT NULL,
	"display_name" text NOT NULL,
	"knowledge" jsonb NOT NULL,
	"answered_item_ids" jsonb NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "adaptive_event" ADD CONSTRAINT "adaptive_event_practice_id_adaptive_practice_id_fk" FOREIGN KEY ("practice_id") REFERENCES "public"."adaptive_practice"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "adaptive_student_state" ADD CONSTRAINT "adaptive_student_state_practice_id_adaptive_practice_id_fk" FOREIGN KEY ("practice_id") REFERENCES "public"."adaptive_practice"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "adaptive_event_practice_created_idx" ON "adaptive_event" USING btree ("practice_id","created_at");--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "adaptive_state_practice_student_idx" ON "adaptive_student_state" USING btree ("practice_id","student_key");