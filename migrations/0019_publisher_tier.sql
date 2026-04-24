-- Phase 2: 書商專區 schema 基礎
-- 1) 新增 publisher 表：一個 Clerk org = 一筆 publisher，verifiedStatus 由管理員人工審核
-- 2) 在 quiz 表追加 4 個 nullable 欄位：publisher_id / isbn / chapter / book_title
-- 注意：**手寫** migration 以繞過 Drizzle migration snapshot 脫鉤（CLAUDE.md 有記載），
-- 不使用 db:generate 避免把既有 marketplace / vocab / quiz_mode / live_mode 欄位重複塞入

CREATE TABLE IF NOT EXISTS "publisher" (
	"id" serial PRIMARY KEY NOT NULL,
	"org_id" text NOT NULL,
	"display_name" text NOT NULL,
	"slug" text NOT NULL,
	"logo_url" text,
	"bio" text,
	"website_url" text,
	"verified_status" text DEFAULT 'pending' NOT NULL,
	"verified_at" timestamp,
	"contact_email" text,
	"tax_id" text,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "publisher_org_id_unique" UNIQUE("org_id"),
	CONSTRAINT "publisher_slug_unique" UNIQUE("slug")
);
--> statement-breakpoint
ALTER TABLE "quiz" ADD COLUMN IF NOT EXISTS "publisher_id" integer;--> statement-breakpoint
ALTER TABLE "quiz" ADD COLUMN IF NOT EXISTS "isbn" text;--> statement-breakpoint
ALTER TABLE "quiz" ADD COLUMN IF NOT EXISTS "chapter" text;--> statement-breakpoint
ALTER TABLE "quiz" ADD COLUMN IF NOT EXISTS "book_title" text;--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "quiz" ADD CONSTRAINT "quiz_publisher_id_publisher_id_fk" FOREIGN KEY ("publisher_id") REFERENCES "public"."publisher"("id") ON DELETE set null ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
