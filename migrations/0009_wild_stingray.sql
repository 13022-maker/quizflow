CREATE TABLE IF NOT EXISTS "paddle_customer" (
	"id" serial PRIMARY KEY NOT NULL,
	"clerk_user_id" text NOT NULL,
	"paddle_customer_id" text NOT NULL,
	"email" text NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "paddle_customer_clerk_user_id_unique" UNIQUE("clerk_user_id"),
	CONSTRAINT "paddle_customer_paddle_customer_id_unique" UNIQUE("paddle_customer_id")
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "subscription" (
	"id" serial PRIMARY KEY NOT NULL,
	"clerk_user_id" text NOT NULL,
	"paddle_subscription_id" text,
	"paddle_customer_id" text NOT NULL,
	"plan" text DEFAULT 'free' NOT NULL,
	"billing_cycle" text,
	"status" text DEFAULT 'inactive' NOT NULL,
	"current_period_start" timestamp,
	"current_period_end" timestamp,
	"cancel_at_period_end" boolean DEFAULT false NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "subscription_paddle_subscription_id_unique" UNIQUE("paddle_subscription_id")
);
