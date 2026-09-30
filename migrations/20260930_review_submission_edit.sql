CREATE TABLE IF NOT EXISTS "review_submission_edit" (
	"id" serial PRIMARY KEY NOT NULL,
	"team_id" integer NOT NULL,
	"player_id" integer NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "review_submission_edit" ADD CONSTRAINT "review_submission_edit_team_id_review_team_id_fk" FOREIGN KEY ("team_id") REFERENCES "public"."review_team"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "review_submission_edit" ADD CONSTRAINT "review_submission_edit_player_id_review_player_id_fk" FOREIGN KEY ("player_id") REFERENCES "public"."review_player"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
