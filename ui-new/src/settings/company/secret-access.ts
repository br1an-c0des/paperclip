import type { Agent } from "@paperclipai/shared";
import { agentsApi } from "@/api/agents";
import { grantConfig, revokeConfig, type AccessReference } from "./secrets-model";

/*
 * Giving an agent a secret, and taking it away (upstream's agent-secret-access.ts). Both read the
 * agent's freshest config first and write the whole adapter config back
 * (`replaceAdapterConfig: true`), so a change made elsewhere since the list loaded isn't lost.
 */

/** Adds the secret to one agent as the environment variable `envKey`. */
export async function grantAccess(input: { companyId: string; agentId: string; envKey: string; reference: AccessReference }): Promise<Agent> {
  const detail = await agentsApi.get(input.agentId, input.companyId);
  const adapterConfig = grantConfig(detail.adapterConfig, detail.name, input.envKey, input.reference);
  return agentsApi.update(input.agentId, { adapterConfig, replaceAdapterConfig: true }, input.companyId);
}

/** Removes every env var and API alias of one agent that points at the secret. */
export async function revokeAccess(input: { companyId: string; agentId: string; reference: AccessReference }): Promise<Agent> {
  const detail = await agentsApi.get(input.agentId, input.companyId);
  const adapterConfig = revokeConfig(detail.adapterConfig, input.reference);
  if (!adapterConfig) return detail;
  return agentsApi.update(input.agentId, { adapterConfig, replaceAdapterConfig: true }, input.companyId);
}

/** Gives each chosen agent access after a secret is saved. The secret stays if one fails: the failures come back as messages. */
export async function grantEach(companyId: string, agentIds: readonly string[], envKey: string, reference: AccessReference): Promise<string[]> {
  const results = await Promise.allSettled(agentIds.map((agentId) => grantAccess({ companyId, agentId, envKey, reference })));
  return results.flatMap((result) => (result.status === "rejected" ? [result.reason instanceof Error ? result.reason.message : String(result.reason)] : []));
}
