DO $$ BEGIN
 CREATE TYPE "public"."live_game_status" AS ENUM('waiting', 'playing', 'showing_result', 'finished');
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "live_game" (
	"id" serial PRIMARY KEY NOT NULL,
	"quiz_id" integer NOT NULL,
	"host_org_id" text NOT NULL,
	"host_user_id" text NOT NULL,
	"title" text NOT NULL,
	"game_pin" text NOT NULL,
	"status" "live_game_status" DEFAULT 'waiting' NOT NULL,
	"current_question_index" integer DEFAULT -1 NOT NULL,
	"question_started_at" timestamp,
	"question_duration" integer DEFAULT 20 NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"ended_at" timestamp,
	CONSTRAINT "live_game_game_pin_unique" UNIQUE("game_pin")
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "live_player" (
	"id" serial PRIMARY KEY NOT NULL,
	"game_id" integer NOT NULL,
	"nickname" text NOT NULL,
	"player_token" text NOT NULL,
	"score" integer DEFAULT 0 NOT NULL,
	"correct_count" integer DEFAULT 0 NOT NULL,
	"joined_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "live_answer" (
	"id" serial PRIMARY KEY NOT NULL,
	"game_id" integer NOT NULL,
	"player_id" integer NOT NULL,
	"question_id" integer NOT NULL,
	"selected_option_id" jsonb,
	"is_correct" boolean DEFAULT false NOT NULL,
	"response_time_ms" integer DEFAULT 0 NOT NULL,
	"score" integer DEFAULT 0 NOT NULL,
	"answered_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "live_game" ADD CONSTRAINT "live_game_quiz_id_quiz_id_fk" FOREIGN KEY ("quiz_id") REFERENCES "public"."quiz"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "live_player" ADD CONSTRAINT "live_player_game_id_live_game_id_fk" FOREIGN KEY ("game_id") REFERENCES "public"."live_game"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "live_answer" ADD CONSTRAINT "live_answer_game_id_live_game_id_fk" FOREIGN KEY ("game_id") REFERENCES "public"."live_game"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "live_answer" ADD CONSTRAINT "live_answer_player_id_live_player_id_fk" FOREIGN KEY ("player_id") REFERENCES "public"."live_player"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "live_answer" ADD CONSTRAINT "live_answer_question_id_question_id_fk" FOREIGN KEY ("question_id") REFERENCES "public"."question"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "live_player_game_nickname_idx" ON "live_player" USING btree ("game_id","nickname");--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "live_player_token_idx" ON "live_player" USING btree ("player_token");--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "live_answer_player_question_idx" ON "live_answer" USING btree ("player_id","question_id");
