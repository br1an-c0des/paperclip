import { z } from "zod";
import { createProjectSchema, updateProjectSchema } from "@paperclipai/shared";
import { object, pathId, pick, rows, tool } from "./util.js";

const AGENT_FIELDS = ["id", "name", "role", "title", "status", "reportsTo"] as const;
const PROJECT_FIELDS = ["id", "name", "description", "status", "leadAgentId", "goalIds", "targetDate"] as const;
const projectFields = { name: true, description: true, status: true, leadAgentId: true, goalIds: true, targetDate: true, color: true, icon: true } as const;

/** Agents, projects, and the project tools that replace `/api/mcp/project-tools`. */
export const DIRECTORY_TOOLS = [
  tool({
    name: "paperclip_list_agents",
    description: "List your company's agents, to find who to assign or hand work to.",
    action: "tasks:read",
    input: z.object({}).strict(),
    run: async (caller, _args, api) => ({
      agents: rows(await api("GET", `/companies/${pathId(caller.companyId)}/agents`)).map(row => pick(row, AGENT_FIELDS)),
    }),
  }),
  tool({
    name: "paperclip_list_projects",
    description: "List your company's projects, 50 at a time; pass nextCursor back as cursor for more.",
    action: "tasks:read",
    input: z.object({ cursor: z.uuid().optional() }).strict(),
    run: async (caller, args, api) => {
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
    description: "Create a project, optionally with repositories from paperclip_list_project_repositories.",
    action: "projects:manage",
    input: createProjectSchema.pick({ ...projectFields, repositoryIds: true }).strict(),
    run: async (caller, args, api) => ({
      project: pick(await api("POST", `/companies/${pathId(caller.companyId)}/projects`, args), PROJECT_FIELDS),
    }),
  }),
  tool({
    name: "paperclip_update_project",
    description: "Change a project's name, description, status, lead, goals, target date, color or icon.",
    action: "projects:manage",
    input: z.object({ projectId: z.uuid(), changes: updateProjectSchema.pick(projectFields).strict() }).strict()
      .refine(args => Object.keys(args.changes).length > 0, "Supply at least one change"),
    run: async (_caller, args, api) => ({
      project: pick(await api("PATCH", `/projects/${pathId(args.projectId)}`, args.changes), PROJECT_FIELDS),
    }),
  }),
];
