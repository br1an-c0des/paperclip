import { z } from "zod";
import { companySkillCreateSchema, companySkillUpdateSchema } from "@paperclipai/shared";
import { pathId, pick, rows, tool } from "./util.js";

const SKILL_FIELDS = [
  "id", "name", "slug", "key", "description", "versionId", "currentVersionId", "latestVersionId", "categories", "tagline", "sharingScope", "updatedAt",
] as const;
const filePath = z.string().min(1).max(512)
  .refine(value => !value.startsWith("/") && !value.includes("\\") && value.split("/").every(part => part !== ".." && part !== "." && part !== ""), "Use a relative path");

/** Company skills (carried over from the public MCP): reading is open, changing them is configuring agents. */
export const SKILL_TOOLS = [
  tool({
    name: "paperclip_skills",
    description: "Company skills: list them (no arguments), read one (skillId) or one of its files (skillId, path), or create, update or write a file.",
    action: "agents:configure",
    writes: args => Boolean(args.create || args.update || args.writeFile),
    input: z.object({
      skillId: z.uuid().optional(),
      path: filePath.optional().describe("A file to read, e.g. SKILL.md"),
      create: companySkillCreateSchema.pick({ name: true, slug: true, description: true, markdown: true, folderId: true, categories: true }).strict().optional(),
      update: companySkillUpdateSchema.unwrap().pick({ description: true, iconUrl: true, color: true, tagline: true, authorName: true, homepageUrl: true, categories: true })
        .strict().refine(changes => Object.keys(changes).length > 0, "Supply at least one change").optional().describe("Metadata; use writeFile for SKILL.md"),
      writeFile: z.object({
        path: filePath,
        content: z.string().max(524288),
        encoding: z.enum(["utf8", "base64"]).optional(),
        expectedVersionId: z.uuid().nullable().describe("The skill's current version from a read; null for a new one"),
      }).strict().optional(),
    }).strict().refine(args => [args.create, args.update, args.writeFile].filter(Boolean).length <= 1, "Give at most one change")
      .refine(args => !(args.update || args.writeFile || args.path) || args.skillId, "skillId is required"),
    run: async (caller, args, api) => {
      const base = `/companies/${pathId(caller.companyId)}/skills`;
      const skill = args.skillId ? `${base}/${pathId(args.skillId)}` : null;
      if (args.create) return { skill: pick(await api("POST", base, args.create), [...SKILL_FIELDS, "markdown"]) };
      if (args.update) return { skill: pick(await api("PATCH", skill!, args.update), SKILL_FIELDS) };
      if (args.writeFile) return { file: await api("PATCH", `${skill}/files`, args.writeFile) };
      if (skill && args.path) return { file: await api("GET", `${skill}/files?path=${pathId(args.path)}`) };
      if (skill) return { skill: pick(await api("GET", skill), [...SKILL_FIELDS, "markdown"]) };
      return { skills: rows(await api("GET", base)).map(row => pick(row, SKILL_FIELDS)) };
    },
  }),
];
