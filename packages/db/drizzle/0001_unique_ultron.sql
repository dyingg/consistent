CREATE TYPE "public"."block_status" AS ENUM('planned', 'confirmed', 'completed', 'missed', 'moved');--> statement-breakpoint
CREATE TYPE "public"."dependency_type" AS ENUM('finish_to_start', 'start_to_start', 'finish_to_finish', 'start_to_finish');--> statement-breakpoint
CREATE TYPE "public"."goal_status" AS ENUM('active', 'completed', 'paused', 'abandoned');--> statement-breakpoint
CREATE TYPE "public"."scheduled_by" AS ENUM('llm', 'user', 'recurring');--> statement-breakpoint
CREATE TYPE "public"."task_status" AS ENUM('pending', 'ready', 'scheduled', 'in_progress', 'completed', 'blocked', 'cancelled');--> statement-breakpoint
CREATE TABLE "goals" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"user_id" text NOT NULL,
	"title" text NOT NULL,
	"description" text,
	"description_context" text,
	"color" text,
	"status" "goal_status" DEFAULT 'active' NOT NULL,
	"target_date" date,
	"priority" smallint DEFAULT 3 NOT NULL,
	"total_tasks" integer DEFAULT 0 NOT NULL,
	"completed_tasks" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"completed_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "schedule_runs" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"user_id" text NOT NULL,
	"triggered_by" text,
	"model" text,
	"input_snapshot" jsonb,
	"output" jsonb,
	"rationale" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "scheduled_blocks" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"task_id" bigint NOT NULL,
	"user_id" text NOT NULL,
	"start_time" timestamp with time zone NOT NULL,
	"end_time" timestamp with time zone NOT NULL,
	"status" "block_status" DEFAULT 'planned' NOT NULL,
	"scheduled_by" "scheduled_by" DEFAULT 'llm' NOT NULL,
	"schedule_run_id" bigint,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "task_dependencies" (
	"task_id" bigint NOT NULL,
	"depends_on_id" bigint NOT NULL,
	"dependency_type" "dependency_type" DEFAULT 'finish_to_start' NOT NULL,
	"lag_minutes" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "task_dependencies_task_id_depends_on_id_pk" PRIMARY KEY("task_id","depends_on_id")
);
--> statement-breakpoint
CREATE TABLE "tasks" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"goal_id" bigint NOT NULL,
	"user_id" text NOT NULL,
	"title" text NOT NULL,
	"description" text,
	"description_context" text,
	"status" "task_status" DEFAULT 'pending' NOT NULL,
	"estimated_minutes" integer,
	"actual_minutes" integer,
	"earliest_start" timestamp with time zone,
	"deadline" timestamp with time zone,
	"priority" smallint DEFAULT 3 NOT NULL,
	"sprint_points" smallint,
	"context_tags" text[],
	"blocker_count" integer DEFAULT 0 NOT NULL,
	"completed_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "user" ADD COLUMN "timezone" text DEFAULT 'UTC' NOT NULL;--> statement-breakpoint
ALTER TABLE "user" ADD COLUMN "preferences" jsonb;--> statement-breakpoint
ALTER TABLE "goals" ADD CONSTRAINT "goals_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "schedule_runs" ADD CONSTRAINT "schedule_runs_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "scheduled_blocks" ADD CONSTRAINT "scheduled_blocks_task_id_tasks_id_fk" FOREIGN KEY ("task_id") REFERENCES "public"."tasks"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "scheduled_blocks" ADD CONSTRAINT "scheduled_blocks_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "scheduled_blocks" ADD CONSTRAINT "scheduled_blocks_schedule_run_id_schedule_runs_id_fk" FOREIGN KEY ("schedule_run_id") REFERENCES "public"."schedule_runs"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "task_dependencies" ADD CONSTRAINT "task_dependencies_task_id_tasks_id_fk" FOREIGN KEY ("task_id") REFERENCES "public"."tasks"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "task_dependencies" ADD CONSTRAINT "task_dependencies_depends_on_id_tasks_id_fk" FOREIGN KEY ("depends_on_id") REFERENCES "public"."tasks"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tasks" ADD CONSTRAINT "tasks_goal_id_goals_id_fk" FOREIGN KEY ("goal_id") REFERENCES "public"."goals"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tasks" ADD CONSTRAINT "tasks_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "idx_goals_user_status" ON "goals" USING btree ("user_id","status");--> statement-breakpoint
CREATE INDEX "idx_scheduled_blocks_user_time" ON "scheduled_blocks" USING btree ("user_id","start_time","end_time");--> statement-breakpoint
CREATE INDEX "idx_scheduled_blocks_task" ON "scheduled_blocks" USING btree ("task_id");--> statement-breakpoint
CREATE INDEX "idx_task_deps_depends_on" ON "task_dependencies" USING btree ("depends_on_id");--> statement-breakpoint
CREATE INDEX "idx_tasks_goal" ON "tasks" USING btree ("goal_id");--> statement-breakpoint
CREATE INDEX "idx_tasks_user_status" ON "tasks" USING btree ("user_id","status");--> statement-breakpoint
CREATE INDEX "idx_tasks_deadline" ON "tasks" USING btree ("deadline");