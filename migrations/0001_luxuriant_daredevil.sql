CREATE TYPE "public"."question_type" AS ENUM('single_choice', 'multiple_choice', 'true_false', 'short_answer');--> statement-breakpoint
CREATE TYPE "public"."quiz_status" AS ENUM('draft', 'published', 'closed');--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "quiz" (
	"id" serial PRIMARY KEY NOT NULL,
	"owner_id" text NOT NULL,
	"title" text NOT NULL,
	"description" text,
	"status" "quiz_status" DEFAULT 'draft' NOT NULL,
	"shuffle_questions" boolean DEFAULT false NOT NULL,
	"shuffle_options" boolean DEFAULT false NOT NULL,
	"time_limit_seconds" integer,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "question" (
	"id" serial PRIMARY KEY NOT NULL,
	"quiz_id" integer NOT NULL,
	"type" "question_type" NOT NULL,
	"body" text NOT NULL,
	"options" jsonb,
	"correct_answers" jsonb,
	"points" integer DEFAULT 1 NOT NULL,
	"position" integer NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "response" (
	"id" serial PRIMARY KEY NOT NULL,
	"quiz_id" integer NOT NULL,
	"student_name" text,
	"student_email" text,
	"score" integer,
	"total_points" integer,
	"submitted_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "answer" (
	"id" serial PRIMARY KEY NOT NULL,
	"response_id" integer NOT NULL,
	"question_id" integer NOT NULL,
	"answer" jsonb NOT NULL,
	"is_correct" boolean
);
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "question" ADD CONSTRAINT "question_quiz_id_quiz_id_fk" FOREIGN KEY ("quiz_id") REFERENCES "public"."quiz"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "response" ADD CONSTRAINT "response_quiz_id_quiz_id_fk" FOREIGN KEY ("quiz_id") REFERENCES "public"."quiz"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "answer" ADD CONSTRAINT "answer_response_id_response_id_fk" FOREIGN KEY ("response_id") REFERENCES "public"."response"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "answer" ADD CONSTRAINT "answer_question_id_question_id_fk" FOREIGN KEY ("question_id") REFERENCES "public"."question"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
