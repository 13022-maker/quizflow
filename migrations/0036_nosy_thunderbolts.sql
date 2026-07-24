ALTER TABLE "adaptive_subject" ADD COLUMN "archived_at" timestamp;--> statement-breakpoint
ALTER TABLE "adaptive_subject" ADD COLUMN "pinned" boolean DEFAULT false NOT NULL;