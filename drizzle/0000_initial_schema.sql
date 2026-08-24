CREATE TYPE "public"."acquisition_channel" AS ENUM('organic', 'paid_search', 'referral', 'outbound', 'partner');--> statement-breakpoint
CREATE TYPE "public"."movement_kind" AS ENUM('new', 'expansion', 'contraction', 'churn', 'reactivation');--> statement-breakpoint
CREATE TYPE "public"."subscription_status" AS ENUM('active', 'cancelled', 'paused');--> statement-breakpoint
CREATE TABLE "customer" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" text NOT NULL,
	"slug" text NOT NULL,
	"country" text NOT NULL,
	"signed_up_at" timestamp with time zone NOT NULL,
	"churned_at" timestamp with time zone,
	"acquisition_channel" "acquisition_channel" NOT NULL
);
--> statement-breakpoint
CREATE TABLE "daily_rollup" (
	"day" date PRIMARY KEY NOT NULL,
	"mrr_pence" integer NOT NULL,
	"active_customers" integer NOT NULL,
	"new_count" integer NOT NULL,
	"churn_count" integer NOT NULL
);
--> statement-breakpoint
CREATE TABLE "event" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"customer_id" uuid NOT NULL,
	"occurred_at" timestamp with time zone NOT NULL,
	"kind" text NOT NULL,
	"metadata" jsonb DEFAULT '{}'::jsonb NOT NULL
);
--> statement-breakpoint
CREATE TABLE "mrr_movement" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"customer_id" uuid NOT NULL,
	"occurred_on" date NOT NULL,
	"kind" "movement_kind" NOT NULL,
	"amount_pence" integer NOT NULL
);
--> statement-breakpoint
CREATE TABLE "plan" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" text NOT NULL,
	"slug" text NOT NULL,
	"monthly_price_pence" integer NOT NULL,
	"active" boolean DEFAULT true NOT NULL
);
--> statement-breakpoint
CREATE TABLE "subscription" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"customer_id" uuid NOT NULL,
	"plan_id" uuid NOT NULL,
	"started_at" timestamp with time zone NOT NULL,
	"ended_at" timestamp with time zone,
	"seats" integer NOT NULL,
	"status" "subscription_status" NOT NULL
);
--> statement-breakpoint
ALTER TABLE "event" ADD CONSTRAINT "event_customer_id_customer_id_fk" FOREIGN KEY ("customer_id") REFERENCES "public"."customer"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "mrr_movement" ADD CONSTRAINT "mrr_movement_customer_id_customer_id_fk" FOREIGN KEY ("customer_id") REFERENCES "public"."customer"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "subscription" ADD CONSTRAINT "subscription_customer_id_customer_id_fk" FOREIGN KEY ("customer_id") REFERENCES "public"."customer"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "subscription" ADD CONSTRAINT "subscription_plan_id_plan_id_fk" FOREIGN KEY ("plan_id") REFERENCES "public"."plan"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "customer_slug_key" ON "customer" USING btree ("slug");--> statement-breakpoint
CREATE UNIQUE INDEX "daily_rollup_day_key" ON "daily_rollup" USING btree ("day");--> statement-breakpoint
CREATE UNIQUE INDEX "plan_slug_key" ON "plan" USING btree ("slug");