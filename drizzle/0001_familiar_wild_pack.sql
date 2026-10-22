CREATE TYPE "public"."history_kind" AS ENUM('CREATED', 'UPDATED', 'DELETED', 'UNDONE', 'REDONE', 'HOMEOWNER_ADDED', 'HOMEOWNER_REMOVED');--> statement-breakpoint
CREATE TABLE "job_history" (
	"id" uuid PRIMARY KEY NOT NULL,
	"job_id" uuid NOT NULL,
	"seq" integer NOT NULL,
	"kind" "history_kind" NOT NULL,
	"changes" jsonb NOT NULL,
	"target_seq" integer,
	"superseded_at" timestamp with time zone,
	"actor_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "job_history_seq_positive" CHECK ("job_history"."seq" >= 1),
	CONSTRAINT "job_history_target_seq_matches_kind" CHECK (("job_history"."kind" in ('UNDONE', 'REDONE')) = ("job_history"."target_seq" is not null)),
	CONSTRAINT "job_history_superseded_only_undoable" CHECK ("job_history"."superseded_at" is null or "job_history"."kind" in ('UPDATED', 'DELETED'))
);
--> statement-breakpoint
ALTER TABLE "jobs" ADD COLUMN "history_cursor" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "job_history" ADD CONSTRAINT "job_history_job_id_jobs_id_fk" FOREIGN KEY ("job_id") REFERENCES "public"."jobs"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "job_history" ADD CONSTRAINT "job_history_actor_id_users_id_fk" FOREIGN KEY ("actor_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "job_history_job_id_seq_unique" ON "job_history" USING btree ("job_id","seq");--> statement-breakpoint
ALTER TABLE "jobs" ADD CONSTRAINT "jobs_history_cursor_non_negative" CHECK ("jobs"."history_cursor" >= 0);