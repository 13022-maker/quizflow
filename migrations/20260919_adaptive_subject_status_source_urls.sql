ALTER TABLE "adaptive_subject" ADD COLUMN "status" text DEFAULT 'published' NOT NULL;--> statement-breakpoint
ALTER TABLE "adaptive_subject" ADD COLUMN "source_urls" jsonb;--> statement-breakpoint
ALTER TABLE "adaptive_subject" ADD CONSTRAINT "adaptive_subject_status_check" CHECK ("adaptive_subject"."status" IN ('draft', 'published'));