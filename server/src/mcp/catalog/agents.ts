import { z } from "zod";
import { aiRuntimeConnectionBindingSchema, updateAgentSchema } from "@paperclipai/shared";
import { mcpAgentModelConfig } from "../../services/public-mcp/agent-config.js";
import { object, pathId, pick, tool } from "./util.js";

const AGENT_FIELDS = ["id", "name", "role", "title", "icon", "status", "reportsTo", "capabilities", "desiredSkills", "budgetMonthlyCents", "adapterType"] as const;

/** An agent's identity and non-secret operating settings: no credentials, environment or permission policies. */
export function agentConfiguration(value: unknown) {
  const agent = object(value);
  return {
    ...pick(agent, AGENT_FIELDS),
    adapterConfig: mcpAgentModelConfig(String(agent.adapterType), object(agent.adapterConfig)),
    runtimeConfig: pick(agent.runtimeConfig, ["aiConnection"]),
  };
}

const filePath = z.string().min(1).max(512)
  .refine(value => !value.startsWith("/") && !value.includes("\\") && value.split("/").every(part => part !== ".." && part !== "." && part !== ""), "Use a relative path")
  .describe("Instruction file, default AGENTS.md");

const agentChanges = updateAgentSchema.pick({
  name: true, role: true, title: true, icon: true, reportsTo: true, capabilities: true, desiredSkills: true, budgetMonthlyCents: true,
}).extend({
  adapterConfig: z.object({
    model: z.string().trim().min(1).max(256).optional(),
    reasoningEffort: z.enum(["minimal", "low", "medium", "high", "xhigh", "max", "ultra"]).optional(),
  }).strict().optional(),
  runtimeConfig: z.object({ aiConnection: aiRuntimeConnectionBindingSchema }).strict().optional(),
}).strict().refine(changes => Object.keys(changes).length > 0, "Supply at least one change");

/** Configuring other agents: their settings and instruction files (carried over from the public MCP). */
export const AGENT_TOOLS = [
  tool({
    name: "paperclip_configure_agent",
    description: "Read or change an agent's settings (name, role, reporting line, skills, model, budget) or its instruction files. Give one of read, changes or instructions.",
    action: "agents:configure",
    // Hidden below admin rather than listed as requestable: its schema is the largest in the catalog,
    // and configuring other agents is rarely something to ask for mid-task.
    requestable: false,
    input: z.object({
      agentId: z.uuid(),
      read: z.enum(["settings", "instructions", "instruction_history"]).optional(),
      path: filePath.optional(),
      cursor: z.uuid().optional().describe("instruction_history: the next page"),
      changes: agentChanges.optional(),
      instructions: z.object({
        content: z.string().max(1024 * 1024),
        baseRevisionId: z.uuid().nullable().optional(),
        baseHash: z.string().regex(/^[a-f0-9]{64}$/).nullable().optional(),
      }).strict().refine(file => file.baseRevisionId !== undefined || file.baseHash !== undefined, "Read the file first and pass its revision or hash (null for a new file)")
        .optional().describe("Replace the file at path"),
    }).strict().refine(args => [args.read, args.changes, args.instructions].filter(Boolean).length === 1, "Give exactly one of read, changes or instructions"),
    run: async (_caller, args, api) => {
      const base = `/agents/${pathId(args.agentId)}`;
      const path = args.path ?? "AGENTS.md";
      if (args.changes) return { agent: agentConfiguration(await api("PATCH", base, args.changes)) };
      if (args.instructions) return { instructions: await api("PUT", `${base}/instructions-bundle/file`, { path, ...args.instructions }) };
      if (args.read === "instructions") return { instructions: await api("GET", `${base}/instructions-bundle/file?path=${pathId(path)}`) };
      if (args.read === "instruction_history") {
        const query = new URLSearchParams();
        if (args.path) query.set("path", args.path);
        if (args.cursor) query.set("cursor", args.cursor);
        return { revisions: await api("GET", `${base}/instructions-bundle/history?${query}`) };
      }
      return { agent: agentConfiguration(await api("GET", `${base}/configuration`)) };
    },
  }),
];
