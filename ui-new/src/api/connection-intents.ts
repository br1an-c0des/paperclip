import type { ConnectionIntentInteraction, ConnectionIntentPhase, ConnectionIntentSetupOptions } from "@paperclipai/shared";
import { api } from "./client";

/*
 * An agent's request to connect an app (a `connection_intent` card), as ui/src/api/connection-intents.ts
 * and agents.ts call it. Only the person the card is addressed to can act on it:
 *
 * - Setup options: the app, the connections they could reuse, and for AI connections whether the
 *   agent's sign-in needs adopting or repairing.
 * - Complete with a connection, adopt one for the agent's AI sign-in, or decline.
 * - Phase: "authorizing" while a provider page is open, "needs_retry" when it didn't finish, with
 *   the draft's audience when the setup runs for this request.
 */

export const connectionIntentsApi = {
  setupOptions: (interactionId: string, signal?: AbortSignal) =>
    api.get<ConnectionIntentSetupOptions>(`/connection-intents/${interactionId}/setup-options`, { signal }),
  /**
   * `setupAccess` (#19352) saves who a new tool connection's draft is for, all agents or a list
   * that includes the requester. It grants nothing until the OAuth completion that carries this
   * request applies it with the resolution.
   */
  setPhase: (interactionId: string, phase: ConnectionIntentPhase, setupAccess?: ConnectionIntentInteraction["payload"]["setupAccess"]) =>
    api.post<ConnectionIntentInteraction>(`/connection-intents/${interactionId}/phase`, { phase, ...(setupAccess ? { setupAccess } : {}) }),
  complete: (interactionId: string, connectionId: string) =>
    api.post<ConnectionIntentInteraction>(`/connection-intents/${interactionId}/complete`, { connectionId }),
  decline: (interactionId: string, reason?: string) =>
    api.post<ConnectionIntentInteraction>(`/connection-intents/${interactionId}/decline`, reason ? { reason } : {}),
  /** Uses one of your AI connections for the agent, replacing its own sign-in. */
  adopt: (companyId: string, agentId: string, interactionId: string, connectionId: string) =>
    api.post<ConnectionIntentInteraction>(
      `/agents/${agentId}/connection-intents/${interactionId}/adopt?companyId=${encodeURIComponent(companyId)}`,
      { connectionId },
    ),
};
