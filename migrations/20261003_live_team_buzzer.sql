CREATE TYPE "public"."live_buzz_result" AS ENUM('queued', 'answering', 'correct', 'wrong', 'timeout');--> statement-breakpoint
CREATE TYPE "public"."live_game_mode" AS ENUM('classic', 'team_buzzer');--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "live_buzz" (
	"id" serial PRIMARY KEY NOT NULL,
	"game_id" integer NOT NULL,
	"question_id" integer NOT NULL,
	"team_id" integer NOT NULL,
	"player_id" integer NOT NULL,
	"buzzed_at" timestamp DEFAULT now() NOT NULL,
	"result" "live_buzz_result" DEFAULT 'queued' NOT NULL,
	"answer_granted_at" timestamp,
	"selected_option_id" jsonb,
	"answered_at" timestamp
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "live_team" (
	"id" serial PRIMARY KEY NOT NULL,
	"game_id" integer NOT NULL,
	"name" text NOT NULL,
	"order_index" integer NOT NULL,
	"score" integer DEFAULT 0 NOT NULL
);
--> statement-breakpoint
ALTER TABLE "live_game" ADD COLUMN "game_mode" "live_game_mode" DEFAULT 'classic' NOT NULL;--> statement-breakpoint
ALTER TABLE "live_game" ADD COLUMN "team_count" integer;--> statement-breakpoint
ALTER TABLE "live_player" ADD COLUMN "team_id" integer;--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "live_buzz" ADD CONSTRAINT "live_buzz_game_id_live_game_id_fk" FOREIGN KEY ("game_id") REFERENCES "public"."live_game"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "live_buzz" ADD CONSTRAINT "live_buzz_question_id_question_id_fk" FOREIGN KEY ("question_id") REFERENCES "public"."question"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "live_buzz" ADD CONSTRAINT "live_buzz_team_id_live_team_id_fk" FOREIGN KEY ("team_id") REFERENCES "public"."live_team"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "live_buzz" ADD CONSTRAINT "live_buzz_player_id_live_player_id_fk" FOREIGN KEY ("player_id") REFERENCES "public"."live_player"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "live_team" ADD CONSTRAINT "live_team_game_id_live_game_id_fk" FOREIGN KEY ("game_id") REFERENCES "public"."live_game"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "live_buzz_game_question_team_idx" ON "live_buzz" USING btree ("game_id","question_id","team_id");--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "live_buzz_single_answering_idx" ON "live_buzz" USING btree ("game_id","question_id") WHERE "live_buzz"."result" = 'answering';--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "live_player" ADD CONSTRAINT "live_player_team_id_live_team_id_fk" FOREIGN KEY ("team_id") REFERENCES "public"."live_team"("id") ON DELETE set null ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
