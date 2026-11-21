CREATE TABLE IF NOT EXISTS "sim_practice" (
	"id" serial PRIMARY KEY NOT NULL,
	"owner_id" text NOT NULL,
	"sim_kind" text DEFAULT 'hdfix3' NOT NULL,
	"mode" text NOT NULL,
	"title" text NOT NULL,
	"access_code" text NOT NULL,
	"spec" jsonb,
	"time_limit_min" integer,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "sim_practice_access_code_unique" UNIQUE("access_code"),
	CONSTRAINT "sim_practice_sim_kind_check" CHECK ("sim_practice"."sim_kind" IN ('hdfix3')),
	CONSTRAINT "sim_practice_mode_check" CHECK ("sim_practice"."mode" IN ('practice', 'exam'))
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "sim_submission" (
	"id" serial PRIMARY KEY NOT NULL,
	"practice_id" integer NOT NULL,
	"student_key" text NOT NULL,
	"display_name" text NOT NULL,
	"seat" text NOT NULL,
	"attempt_no" integer NOT NULL,
	"is_final" boolean NOT NULL,
	"started_at" timestamp NOT NULL,
	"submitted_at" timestamp NOT NULL,
	"duration_sec" integer NOT NULL,
	"score" integer NOT NULL,
	"items" jsonb NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "sim_submission" ADD CONSTRAINT "sim_submission_practice_id_sim_practice_id_fk" FOREIGN KEY ("practice_id") REFERENCES "public"."sim_practice"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "sim_practice_owner_idx" ON "sim_practice" USING btree ("owner_id");--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "sim_submission_practice_student_attempt_idx" ON "sim_submission" USING btree ("practice_id","student_key","attempt_no");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "sim_submission_practice_submitted_idx" ON "sim_submission" USING btree ("practice_id","submitted_at");