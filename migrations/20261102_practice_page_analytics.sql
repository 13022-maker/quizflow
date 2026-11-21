CREATE TABLE IF NOT EXISTS "practice_page_event" (
	"id" serial PRIMARY KEY NOT NULL,
	"share_id" integer NOT NULL,
	"quiz_id" integer NOT NULL,
	"session_id" text NOT NULL,
	"type" text NOT NULL,
	"question_index" integer,
	"question_id" integer,
	"payload" jsonb NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "practice_page_event_type_check" CHECK ("practice_page_event"."type" IN ('session_start', 'answer', 'complete', 'profile'))
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "practice_page_lead" (
	"id" serial PRIMARY KEY NOT NULL,
	"share_id" integer NOT NULL,
	"session_id" text NOT NULL,
	"email" text NOT NULL,
	"consent_at" timestamp NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "practice_page_event" ADD CONSTRAINT "practice_page_event_share_id_practice_page_share_id_fk" FOREIGN KEY ("share_id") REFERENCES "public"."practice_page_share"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "practice_page_event" ADD CONSTRAINT "practice_page_event_quiz_id_quiz_id_fk" FOREIGN KEY ("quiz_id") REFERENCES "public"."quiz"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "practice_page_lead" ADD CONSTRAINT "practice_page_lead_share_id_practice_page_share_id_fk" FOREIGN KEY ("share_id") REFERENCES "public"."practice_page_share"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "practice_page_event_share_created_idx" ON "practice_page_event" USING btree ("share_id","created_at");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "practice_page_event_share_session_idx" ON "practice_page_event" USING btree ("share_id","session_id");--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "practice_page_lead_share_email_idx" ON "practice_page_lead" USING btree ("share_id","email");