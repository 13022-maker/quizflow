CREATE TABLE IF NOT EXISTS "review_draft" (
	"id" serial PRIMARY KEY NOT NULL,
	"team_id" integer NOT NULL,
	"player_id" integer NOT NULL,
	"content" text DEFAULT '' NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "review_leader_vote" (
	"id" serial PRIMARY KEY NOT NULL,
	"team_id" integer NOT NULL,
	"voter_player_id" integer NOT NULL,
	"voted_for_player_id" integer NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "review_submission" ADD COLUMN "submitted_at" timestamp;--> statement-breakpoint
ALTER TABLE "review_submission" ADD COLUMN "auto_submitted" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "review_team" ADD COLUMN "leader_id" integer;--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "review_draft" ADD CONSTRAINT "review_draft_team_id_review_team_id_fk" FOREIGN KEY ("team_id") REFERENCES "public"."review_team"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "review_draft" ADD CONSTRAINT "review_draft_player_id_review_player_id_fk" FOREIGN KEY ("player_id") REFERENCES "public"."review_player"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "review_leader_vote" ADD CONSTRAINT "review_leader_vote_team_id_review_team_id_fk" FOREIGN KEY ("team_id") REFERENCES "public"."review_team"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "review_leader_vote" ADD CONSTRAINT "review_leader_vote_voter_player_id_review_player_id_fk" FOREIGN KEY ("voter_player_id") REFERENCES "public"."review_player"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "review_leader_vote" ADD CONSTRAINT "review_leader_vote_voted_for_player_id_review_player_id_fk" FOREIGN KEY ("voted_for_player_id") REFERENCES "public"."review_player"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "review_draft_team_player_idx" ON "review_draft" USING btree ("team_id","player_id");--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "review_leader_vote_team_voter_idx" ON "review_leader_vote" USING btree ("team_id","voter_player_id");--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "review_team" ADD CONSTRAINT "review_team_leader_id_review_player_id_fk" FOREIGN KEY ("leader_id") REFERENCES "public"."review_player"("id") ON DELETE set null ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
