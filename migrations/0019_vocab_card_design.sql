ALTER TABLE "vocabulary_card" ADD COLUMN IF NOT EXISTS "phonetic_pinyin" text;--> statement-breakpoint
ALTER TABLE "vocabulary_card" ADD COLUMN IF NOT EXISTS "image_url" text;
