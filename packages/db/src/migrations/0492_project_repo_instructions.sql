-- paperclip:migration-compat online_compatible: adds two defaulted booleans to projects; the previous release ignores them.
ALTER TABLE "projects" ADD COLUMN "agents_read_claude_md" boolean DEFAULT true NOT NULL;--> statement-breakpoint
ALTER TABLE "projects" ADD COLUMN "agents_use_repo_skills" boolean DEFAULT true NOT NULL;