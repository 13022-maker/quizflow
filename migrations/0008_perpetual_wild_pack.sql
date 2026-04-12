ALTER TABLE "quiz" ADD COLUMN "room_code" text;--> statement-breakpoint
ALTER TABLE "quiz" ADD COLUMN "expires_at" timestamp;--> statement-breakpoint
ALTER TABLE "quiz" ADD CONSTRAINT "quiz_room_code_unique" UNIQUE("room_code");