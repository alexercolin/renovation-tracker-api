CREATE TYPE "public"."job_status" AS ENUM('PLANNING', 'IN_PROGRESS', 'COMPLETED', 'CANCELED');--> statement-breakpoint
CREATE TYPE "public"."report_status" AS ENUM('PENDING', 'PROCESSING', 'COMPLETED', 'FAILED');--> statement-breakpoint
CREATE TYPE "public"."user_role" AS ENUM('CONTRACTOR', 'HOMEOWNER');--> statement-breakpoint
CREATE TABLE "users" (
	"id" uuid PRIMARY KEY NOT NULL,
	"email" text NOT NULL,
	"password_hash" text NOT NULL,
	"name" text NOT NULL,
	"role" "user_role" NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "jobs" (
	"id" uuid PRIMARY KEY NOT NULL,
	"contractor_id" uuid NOT NULL,
	"description" text NOT NULL,
	"address_line1" text NOT NULL,
	"address_line2" text,
	"city" text NOT NULL,
	"state" text NOT NULL,
	"postal_code" text NOT NULL,
	"country" text DEFAULT 'US' NOT NULL,
	"status" "job_status" DEFAULT 'PLANNING' NOT NULL,
	"cost_cents" integer DEFAULT 0 NOT NULL,
	"version" integer DEFAULT 1 NOT NULL,
	"deleted_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "jobs_cost_cents_non_negative" CHECK ("jobs"."cost_cents" >= 0),
	CONSTRAINT "jobs_version_positive" CHECK ("jobs"."version" >= 1)
);
--> statement-breakpoint
CREATE TABLE "job_homeowners" (
	"job_id" uuid NOT NULL,
	"homeowner_id" uuid NOT NULL,
	"added_by" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "job_homeowners_job_id_homeowner_id_pk" PRIMARY KEY("job_id","homeowner_id")
);
--> statement-breakpoint
CREATE TABLE "messages" (
	"id" uuid PRIMARY KEY NOT NULL,
	"job_id" uuid NOT NULL,
	"sender_id" uuid NOT NULL,
	"body" text NOT NULL,
	"client_message_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "messages_body_not_blank" CHECK (length(trim("messages"."body")) > 0)
);
--> statement-breakpoint
CREATE TABLE "reports" (
	"id" uuid PRIMARY KEY NOT NULL,
	"job_id" uuid NOT NULL,
	"requested_by" uuid NOT NULL,
	"status" "report_status" DEFAULT 'PENDING' NOT NULL,
	"s3_key" text,
	"error" text,
	"attempts" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"started_at" timestamp with time zone,
	"completed_at" timestamp with time zone
);
--> statement-breakpoint
ALTER TABLE "jobs" ADD CONSTRAINT "jobs_contractor_id_users_id_fk" FOREIGN KEY ("contractor_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "job_homeowners" ADD CONSTRAINT "job_homeowners_job_id_jobs_id_fk" FOREIGN KEY ("job_id") REFERENCES "public"."jobs"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "job_homeowners" ADD CONSTRAINT "job_homeowners_homeowner_id_users_id_fk" FOREIGN KEY ("homeowner_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "job_homeowners" ADD CONSTRAINT "job_homeowners_added_by_users_id_fk" FOREIGN KEY ("added_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "messages" ADD CONSTRAINT "messages_job_id_jobs_id_fk" FOREIGN KEY ("job_id") REFERENCES "public"."jobs"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "messages" ADD CONSTRAINT "messages_sender_id_users_id_fk" FOREIGN KEY ("sender_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "reports" ADD CONSTRAINT "reports_job_id_jobs_id_fk" FOREIGN KEY ("job_id") REFERENCES "public"."jobs"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "reports" ADD CONSTRAINT "reports_requested_by_users_id_fk" FOREIGN KEY ("requested_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "users_email_unique" ON "users" USING btree ("email");--> statement-breakpoint
CREATE INDEX "jobs_contractor_id_idx" ON "jobs" USING btree ("contractor_id");--> statement-breakpoint
CREATE INDEX "job_homeowners_homeowner_id_idx" ON "job_homeowners" USING btree ("homeowner_id");--> statement-breakpoint
CREATE INDEX "messages_job_id_created_at_idx" ON "messages" USING btree ("job_id","created_at","id");--> statement-breakpoint
CREATE UNIQUE INDEX "messages_sender_client_message_unique" ON "messages" USING btree ("sender_id","client_message_id") WHERE "messages"."client_message_id" is not null;--> statement-breakpoint
CREATE INDEX "reports_job_id_created_at_idx" ON "reports" USING btree ("job_id","created_at");