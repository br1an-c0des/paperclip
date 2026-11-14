import type { Environment } from "@paperclipai/shared";
import { errorCodes } from "@/lib/offline/errors";

/*
 * SSH environments on the agent's AI account (U157, upstream #21248). An SSH environment saved with
 * `useHostAuth: false` (every new one) runs agents on the AI account picked for each agent, so an
 * agent there needs one: testing it without one fails with `422 ssh_ai_connection_required`. One
 * saved without the field, or with it on, uses the remote user's own provider sign-in instead.
 *
 * New agent and onboarding say so beside Sign-in before the test, and turn the 422 into the same
 * words, with a way to connect an account or open the environment's settings.
 */

export const SSH_AI_CONNECTION_REQUIRED = "ssh_ai_connection_required";

export const SSH_AI_ACCOUNT_TEXT =
  "This SSH environment runs agents on their own AI account. Pick one under Sign-in, or turn on remote machine authentication in the environment's Advanced settings.";

/** Beside Sign-in, while "Its own sign-in" is picked for such an environment. */
export const SSH_AI_ACCOUNT_HINT = "This SSH environment needs an AI account for the agent: pick one here.";

/** The environment runs agents on their own AI account rather than the remote user's sign-in. */
export function usesAgentAiAccount(environment: Pick<Environment, "driver" | "config"> | null | undefined) {
  return environment?.driver === "ssh" && environment.config?.useHostAuth === false;
}

/** Why the agent can't run there as set up, or null: an SSH environment on agents' AI accounts and no account picked. */
export function sshAiAccountProblem(environment: Pick<Environment, "driver" | "config"> | null | undefined, binding: unknown) {
  return usesAgentAiAccount(environment) && !binding ? SSH_AI_ACCOUNT_HINT : null;
}

/** The server's `422 ssh_ai_connection_required`. */
export function isSshAiAccountRequired(error: unknown) {
  return errorCodes(error).includes(SSH_AI_CONNECTION_REQUIRED);
}

/** A failed test's words: the 422 in plain terms, or the usual reason. */
export function testFailureText(error: unknown, fallback: (error: unknown) => string) {
  return isSshAiAccountRequired(error) ? SSH_AI_ACCOUNT_TEXT : fallback(error);
}

/** Where to turn on remote machine authentication: the organization's environments. */
export function environmentsHref(issuePrefix: string) {
  return `/${issuePrefix}/company/settings/environments`;
}
