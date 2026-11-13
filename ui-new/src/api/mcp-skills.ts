import type { ApproveCompanyMcpSkillRequest, CompanyMcpSkill } from "@paperclipai/shared";
import { api } from "./client";

/*
 * Skills that connected apps publish over MCP (U137, upstream #21219; ui/src/api/mcpSkills.ts). A
 * connected app can offer skills next to its tools; each waits for the board's review before agents
 * that use the app get it. Approving names the manifest digest the board reviewed (the server
 * refuses any other version) and, optionally, also honors the skill's `allowed-tools`. Declining an
 * approved skill turns it off. The content is the skill's SKILL.md, verified against that digest.
 */

const base = (companyId: string) => `/companies/${encodeURIComponent(companyId)}/mcp-skills`;
const one = (companyId: string, skillId: string) => `${base(companyId)}/${encodeURIComponent(skillId)}`;

export const mcpSkillsApi = {
  list: (companyId: string, signal?: AbortSignal) => api.get<{ skills: CompanyMcpSkill[] }>(base(companyId), { signal }).then((result) => result.skills),
  content: (companyId: string, skillId: string, signal?: AbortSignal) =>
    api.get<{ markdown: string; manifestDigest: string }>(`${one(companyId, skillId)}/content`, { signal }),
  approve: (companyId: string, skillId: string, body: ApproveCompanyMcpSkillRequest) =>
    api.post<{ skill: CompanyMcpSkill }>(`${one(companyId, skillId)}/approve`, body),
  decline: (companyId: string, skillId: string) => api.post<{ skill: CompanyMcpSkill }>(`${one(companyId, skillId)}/decline`, {}),
};
