ALTER TYPE "public"."question_type" ADD VALUE 'listening';--> statement-breakpoint
ALTER TABLE "question" ADD COLUMN "audio_url" text;--> statement-breakpoint
ALTER TABLE "question" ADD COLUMN "audio_transcript" text;