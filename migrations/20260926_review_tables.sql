CREATE TYPE "public"."review_game_status" AS ENUM('lobby', 'team_forming', 'reviewing', 'creating', 'voting', 'results', 'ended');--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "review_game" (
	"id" serial PRIMARY KEY NOT NULL,
	"review_set_id" integer NOT NULL,
	"host_user_id" text NOT NULL,
	"game_pin" text NOT NULL,
	"status" "review_game_status" DEFAULT 'lobby' NOT NULL,
	"phase_started_at" timestamp,
	"phase_duration_sec" integer,
	"reviewing_started_at" timestamp,
	"reviewing_ended_at" timestamp,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"ended_at" timestamp,
	CONSTRAINT "review_game_game_pin_unique" UNIQUE("game_pin")
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "review_player" (
	"id" serial PRIMARY KEY NOT NULL,
	"game_id" integer NOT NULL,
	"team_id" integer,
	"nickname" text NOT NULL,
	"player_token" text NOT NULL,
	"last_seen_at" timestamp DEFAULT now() NOT NULL,
	"joined_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "review_sample" (
	"id" serial PRIMARY KEY NOT NULL,
	"review_set_id" integer NOT NULL,
	"content" text NOT NULL,
	"order_index" integer NOT NULL,
	"ref_correctness" integer NOT NULL,
	"ref_completeness" integer NOT NULL,
	"ref_clarity" integer NOT NULL,
	"ref_creativity" integer NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "review_score" (
	"id" serial PRIMARY KEY NOT NULL,
	"team_id" integer NOT NULL,
	"player_id" integer NOT NULL,
	"sample_id" integer NOT NULL,
	"correctness" integer NOT NULL,
	"completeness" integer NOT NULL,
	"clarity" integer NOT NULL,
	"creativity" integer NOT NULL,
	"comment" text,
	"submitted_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "review_set" (
	"id" serial PRIMARY KEY NOT NULL,
	"owner_id" text NOT NULL,
	"title" text NOT NULL,
	"topic_prompt" text NOT NULL,
	"team_size" integer DEFAULT 4 NOT NULL,
	"review_duration_sec" integer DEFAULT 600 NOT NULL,
	"create_duration_sec" integer DEFAULT 300 NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "review_submission" (
	"id" serial PRIMARY KEY NOT NULL,
	"team_id" integer NOT NULL,
	"content" text DEFAULT '' NOT NULL,
	"last_edited_by_player_id" integer,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "review_submission_team_id_unique" UNIQUE("team_id")
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "review_team" (
	"id" serial PRIMARY KEY NOT NULL,
	"game_id" integer NOT NULL,
	"team_name" text NOT NULL,
	"accuracy_score" integer DEFAULT 0 NOT NULL,
	"speed_bonus" integer DEFAULT 0 NOT NULL,
	"vote_bonus" integer DEFAULT 0 NOT NULL,
	"score" integer DEFAULT 0 NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "review_vote" (
	"id" serial PRIMARY KEY NOT NULL,
	"game_id" integer NOT NULL,
	"voter_team_id" integer NOT NULL,
	"voted_for_team_id" integer NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "review_game" ADD CONSTRAINT "review_game_review_set_id_review_set_id_fk" FOREIGN KEY ("review_set_id") REFERENCES "public"."review_set"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "review_player" ADD CONSTRAINT "review_player_game_id_review_game_id_fk" FOREIGN KEY ("game_id") REFERENCES "public"."review_game"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "review_player" ADD CONSTRAINT "review_player_team_id_review_team_id_fk" FOREIGN KEY ("team_id") REFERENCES "public"."review_team"("id") ON DELETE set null ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "review_sample" ADD CONSTRAINT "review_sample_review_set_id_review_set_id_fk" FOREIGN KEY ("review_set_id") REFERENCES "public"."review_set"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "review_score" ADD CONSTRAINT "review_score_team_id_review_team_id_fk" FOREIGN KEY ("team_id") REFERENCES "public"."review_team"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "review_score" ADD CONSTRAINT "review_score_player_id_review_player_id_fk" FOREIGN KEY ("player_id") REFERENCES "public"."review_player"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "review_score" ADD CONSTRAINT "review_score_sample_id_review_sample_id_fk" FOREIGN KEY ("sample_id") REFERENCES "public"."review_sample"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "review_submission" ADD CONSTRAINT "review_submission_team_id_review_team_id_fk" FOREIGN KEY ("team_id") REFERENCES "public"."review_team"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "review_submission" ADD CONSTRAINT "review_submission_last_edited_by_player_id_review_player_id_fk" FOREIGN KEY ("last_edited_by_player_id") REFERENCES "public"."review_player"("id") ON DELETE set null ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "review_team" ADD CONSTRAINT "review_team_game_id_review_game_id_fk" FOREIGN KEY ("game_id") REFERENCES "public"."review_game"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "review_vote" ADD CONSTRAINT "review_vote_game_id_review_game_id_fk" FOREIGN KEY ("game_id") REFERENCES "public"."review_game"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "review_vote" ADD CONSTRAINT "review_vote_voter_team_id_review_team_id_fk" FOREIGN KEY ("voter_team_id") REFERENCES "public"."review_team"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "review_vote" ADD CONSTRAINT "review_vote_voted_for_team_id_review_team_id_fk" FOREIGN KEY ("voted_for_team_id") REFERENCES "public"."review_team"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "review_player_game_nickname_idx" ON "review_player" USING btree ("game_id","nickname");--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "review_player_token_idx" ON "review_player" USING btree ("player_token");--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "review_score_player_sample_idx" ON "review_score" USING btree ("player_id","sample_id");--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "review_vote_game_voter_idx" ON "review_vote" USING btree ("game_id","voter_team_id");