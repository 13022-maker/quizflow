ALTER TABLE "quiz" RENAME COLUMN "original_quiz_id" TO "forked_from_id";--> statement-breakpoint
ALTER TABLE "quiz" DROP CONSTRAINT "quiz_original_quiz_id_quiz_id_fk";
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "quiz" ADD CONSTRAINT "quiz_forked_from_id_quiz_id_fk" FOREIGN KEY ("forked_from_id") REFERENCES "public"."quiz"("id") ON DELETE set null ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
