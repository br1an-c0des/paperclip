import type { AgentAccessAction } from "@paperclipai/shared";
import { AGENT_ROUTE_POLICY, type AgentRoutePolicyEntry } from "../../middleware/agent-route-policy-table.js";

/** One row of the agent route policy: an Express pattern as mounted under `/api`. */
export type RoutePolicyEntry = AgentRoutePolicyEntry;

/** `/issues/{id}` and `/issues/:issueId` both become `/issues/:`. */
const normalize = (path: string) => path.replace(/\{[^}]+\}|:[A-Za-z0-9_]+/g, ":").replace(/\/+$/, "");

/**
 * The action an agent caller needs to call a route under `/api` (`path` in OpenAPI or Express
 * form, without the `/api` prefix): reads need `tasks:read`; a write needs its tag in the route
 * policy (`route_checks` means the route checks access itself, so `tasks:read`), and an untagged
 * write needs `api:raw`. The same rule the agent route policy middleware applies at request time.
 */
export function routeAction(
  method: string,
  path: string,
  table: readonly RoutePolicyEntry[] = AGENT_ROUTE_POLICY,
): AgentAccessAction | readonly AgentAccessAction[] {
  const upper = method.toUpperCase();
  if (upper === "GET" || upper === "HEAD") return "tasks:read";
  const key = normalize(path);
  const entry = table.find(row => row.method === upper && normalize(row.path) === key);
  if (!entry) return "api:raw";
  return entry.action === "route_checks" ? "tasks:read" : entry.action;
}
