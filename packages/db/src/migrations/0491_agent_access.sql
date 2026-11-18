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
ALTER TABLE "mcp_oauth_grants" ADD CONSTRAINT "mcp_oauth_grants_act_as_agent_id_agents_id_fk" FOREIGN KEY ("act_as_agent_id") REFERENCES "public"."agents"("id") ON DELETE set null ON UPDATE no action NOT VALID;