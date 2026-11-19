import { z } from "zod";
import { createProjectSchema, updateProjectSchema } from "@paperclipai/shared";
import { agentConfiguration } from "./agents.js";
import { object, pathId, pick, rows, tool } from "./util.js";

const AGENT_FIELDS = ["id", "name", "role", "title", "status", "reportsTo"] as const;
const PROJECT_FIELDS = ["id", "name", "description", "status", "leadAgentId", "goalIds", "targetDate"] as const;
// Color and icon stay in the UI: the icon list alone would cost every run ~1k characters of context.
const projectFields = { name: true, description: true, status: true, leadAgentId: true, goalIds: true, targetDate: true } as const;

/** A project with its repositories as safe references: no credentials, query strings or local paths. */
function projectWithRepositories(value: unknown) {
  const project = object(value);
  return {
    ...pick(project, PROJECT_FIELDS),
    repositories: rows(project.workspaces).flatMap(raw => {
      const workspace = object(raw);
      if (typeof workspace.repoUrl !== "string") return [];
      let url: string | null = null;
      try {
        const parsed = new URL(workspace.repoUrl);
        if (["https:", "http:", "ssh:"].includes(parsed.protocol)) {
          parsed.username = ""; parsed.password = ""; parsed.search = ""; parsed.hash = "";
          url = parsed.toString();
        }
      } catch { /* An opaque remote or a local path isn't disclosed. */ }
      return [{ id: object(workspace.metadata).githubRepositoryId ?? null, name: workspace.name, url }];
    }),
  };
}

/** Agents, projects, and the project tools that replace `/api/mcp/project-tools`. */
export const DIRECTORY_TOOLS = [
  tool({
    name: "paperclip_list_agents",
    description: "List your company's agents, to find who to assign or hand work to; with agentId, one agent's settings.",
    action: "tasks:read",
    input: z.object({ agentId: z.uuid().optional() }).strict(),
    run: async (caller, args, api) => args.agentId
      ? { agent: agentConfiguration(await api("GET", `/agents/${pathId(args.agentId)}/configuration`)) }
      : { agents: rows(await api("GET", `/companies/${pathId(caller.companyId)}/agents`)).map(row => pick(row, AGENT_FIELDS)) },
  }),
  tool({
    name: "paperclip_list_projects",
    description: "List your company's projects, 50 at a time (pass nextCursor back as cursor); with projectId, one project and its repositories.",
    action: "tasks:read",
    input: z.object({ cursor: z.uuid().optional(), projectId: z.uuid().optional() }).strict(),
    run: async (caller, args, api) => {
      if (args.projectId) return { project: projectWithRepositories(await api("GET", `/projects/${pathId(args.projectId)}`)) };
      const query = new URLSearchParams({ view: "summary", limit: "50" });
      if (args.cursor) query.set("cursor", args.cursor);
      const page = object(await api("GET", `/companies/${pathId(caller.companyId)}/projects?${query}`));
      return { projects: rows(page.projects).map(row => pick(row, PROJECT_FIELDS)), nextCursor: page.nextCursor ?? null };
    },
  }),
  tool({
    name: "paperclip_list_project_repositories",
    description: "List the repositories a new project can use (their ids go in paperclip_create_project's repositoryIds).",
    action: "tasks:read",
    input: z.object({}).strict(),
    run: async (caller, _args, api) => ({
      repositories: await api("GET", `/companies/${pathId(caller.companyId)}/project-repositories`),
    }),
  }),
  tool({
    name: "paperclip_create_project",
    description: "Create a project, optionally with repositories from paperclip_list_project_repositories (repositoryIds) or GitHub HTTPS URLs not listed there (repositoryUrls).",
    action: "projects:manage",
    input: createProjectSchema.pick({ ...projectFields, repositoryIds: true, repositoryUrls: true }).strict(),
    run: async (caller, args, api) => ({
      project: pick(await api("POST", `/companies/${pathId(caller.companyId)}/projects`, args), PROJECT_FIELDS),
    }),
  }),
  tool({
    name: "paperclip_update_project",
    description: "Change a project's name, description, status, lead, goals or target date, or replace its repositories (ids from paperclip_list_project_repositories).",
    action: "projects:manage",
    input: z.object({
      projectId: z.uuid(),
      changes: updateProjectSchema.pick(projectFields).strict().optional(),
      repositoryIds: z.array(z.string().regex(/^\d+$/)).max(100).optional(),
    }).strict()
      .refine(args => Object.keys(args.changes ?? {}).length > 0 || args.repositoryIds !== undefined, "Supply at least one change"),
    run: async (_caller, args, api) => {
      let project: unknown = null;
      if (args.changes && Object.keys(args.changes).length > 0) project = await api("PATCH", `/projects/${pathId(args.projectId)}`, args.changes);
      if (args.repositoryIds) project = await api("PUT", `/projects/${pathId(args.projectId)}/repositories`, { repositoryIds: args.repositoryIds });
      return { project: projectWithRepositories(project) };
    },
  }),
];
