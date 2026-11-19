-- paperclip:migration-compat online_compatible: agents and mcp_oauth_grants hold tens of rows, so the backfill is brief; the previous release ignores permissions.access, the new nullable grant columns and the new table.
CREATE TABLE "temporary_access_grants" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"company_id" uuid NOT NULL,
	"principal_type" text NOT NULL,
	"principal_id" text NOT NULL,
	"action" text NOT NULL,
	"resource" jsonb NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"reason" text NOT NULL,
	"uses_left" integer,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "mcp_oauth_grants" ADD COLUMN "act_as_agent_id" uuid;--> statement-breakpoint
ALTER TABLE "mcp_oauth_grants" ADD COLUMN "access_level" text;--> statement-breakpoint
ALTER TABLE "mcp_oauth_grants" ADD COLUMN "access_overrides" jsonb;--> statement-breakpoint
ALTER TABLE "temporary_access_grants" ADD CONSTRAINT "temporary_access_grants_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "temporary_access_grants_principal_action_idx" ON "temporary_access_grants" USING btree ("company_id","principal_type","principal_id","action");--> statement-breakpoint
ALTER TABLE "mcp_oauth_grants" ADD CONSTRAINT "mcp_oauth_grants_act_as_agent_id_agents_id_fk" FOREIGN KEY ("act_as_agent_id") REFERENCES "public"."agents"("id") ON DELETE set null ON UPDATE no action NOT VALID;--> statement-breakpoint
-- Carry over today's access (step 4a): every existing agent starts at manager, with overrides for
-- what it could do beyond that (hiring, configuring others, explicit assignment grants) and for the
-- actor-side interaction switches turned off. Only agents without `access` are touched, so this is
-- safe to run again; agents created later without `access` resolve to worker.
UPDATE "agents" AS a
SET "permissions" = coalesce(a."permissions", '{}'::jsonb) || jsonb_build_object('access', jsonb_build_object(
  'level', 'manager',
  'overrides', jsonb_strip_nulls(jsonb_build_object(
    'agents:create', CASE
      WHEN a."permissions"->'canCreateAgents' = 'true'::jsonb THEN 'true'::jsonb
      WHEN EXISTS (
        SELECT 1 FROM "principal_permission_grants" g
        WHERE g."company_id" = a."company_id" AND g."principal_type" = 'agent'
          AND g."principal_id" = a."id"::text AND g."permission_key" = 'agents:create'
      ) THEN 'true'::jsonb
      WHEN a."role" = 'ceo'
        AND NOT coalesce(
          a."permissions"->>'trustPreset' = 'low_trust_review'
          OR a."permissions"#>>'{authorizationPolicy,trustPreset}' = 'low_trust_review'
          OR a."permissions"#>>'{reviewPreset,id}' = 'low_trust_review'
          OR a."permissions"#>>'{authorizationPolicy,reviewPreset,id}' = 'low_trust_review'
          OR jsonb_typeof(a."permissions"#>'{authorizationPolicy,trustBoundary}') = 'object',
          false
        )
        AND NOT coalesce(
          a."permissions"->'canCreateAgents' = 'false'::jsonb
          AND jsonb_typeof(a."permissions"->'ceoHiringDeniedBy') = 'object',
          false
        )
        THEN 'true'::jsonb
    END,
    'agents:configure', CASE
      WHEN a."permissions"#>'{interactions,canConfigureOtherAgents}' = 'false'::jsonb THEN 'false'::jsonb
      ELSE (
        SELECT CASE WHEN g."scope" IS NULL OR g."scope" = '{}'::jsonb THEN 'true'::jsonb
          ELSE jsonb_build_object('scope', g."scope") END
        FROM "principal_permission_grants" g
        WHERE g."company_id" = a."company_id" AND g."principal_type" = 'agent'
          AND g."principal_id" = a."id"::text AND g."permission_key" = 'agents:configure'
        LIMIT 1
      )
    END,
    'tasks:update_any', CASE
      WHEN a."permissions"#>'{interactions,canEditOtherTasks}' = 'false'::jsonb THEN 'false'::jsonb
    END,
    'tasks:assign', CASE
      WHEN a."permissions"#>'{interactions,canAssignTasksToAgents}' = 'false'::jsonb
        OR a."permissions"#>'{interactions,canAssignTasksToHumans}' = 'false'::jsonb THEN 'false'::jsonb
      ELSE coalesce(
        (
          SELECT CASE WHEN g."scope" IS NULL OR g."scope" = '{}'::jsonb THEN 'true'::jsonb
            ELSE jsonb_build_object('scope', g."scope") END
          FROM "principal_permission_grants" g
          WHERE g."company_id" = a."company_id" AND g."principal_type" = 'agent'
            AND g."principal_id" = a."id"::text AND g."permission_key" = 'tasks:assign'
          LIMIT 1
        ),
        (
          SELECT jsonb_build_object('scope', g."scope")
          FROM "principal_permission_grants" g
          WHERE g."company_id" = a."company_id" AND g."principal_type" = 'agent'
            AND g."principal_id" = a."id"::text AND g."permission_key" = 'tasks:assign_scope'
            AND g."scope" IS NOT NULL AND g."scope" <> '{}'::jsonb
          LIMIT 1
        )
      )
    END
  ))
))
WHERE NOT (coalesce(a."permissions", '{}'::jsonb) ? 'access');
--> statement-breakpoint
-- Outside connections start at the level matching their consent.
UPDATE "mcp_oauth_grants"
SET "access_level" = CASE
  WHEN "scopes" ? 'paperclip:configure' THEN 'admin'
  WHEN "scopes" ? 'paperclip:write' THEN 'manager'
  ELSE 'read_only'
END
WHERE "access_level" IS NULL;
