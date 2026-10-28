import type {
  EmailAddressCheckResult,
  EmailCredentialOption,
  EmailEndpointSetupInput,
  EmailEndpointSummary,
  EmailPublicationSummary,
  EmailThreadSummary,
  ToolConnection,
} from "@paperclipai/shared";
import { api } from "./client";

/*
 * AgentMail email inboxes (`/api/companies/:companyId/email/*`, `/api/email/inboxes/*`), as
 * ui/src/api/email.ts uses them: saved AgentMail accounts, an inbox for an agent, its controls, and
 * a task's email thread with the deliveries that need someone to say what happened.
 *
 * An inbox is also a chat endpoint (provider `agentmail`), with the same id.
 */

export type AgentMailInspection = {
  scope: { scope_type: string };
  inboxes: { inbox_id: string }[];
  domains: { domain_id: string; domain: string; status: string }[];
};

const enc = encodeURIComponent;
const company = (companyId: string, rest: string) => `/companies/${enc(companyId)}/email/${rest}`;

export const emailApi = {
  /** Saved AgentMail accounts you may use (metadata only). */
  credentials: (companyId: string, signal?: AbortSignal) => api.get<EmailCredentialOption[]>(company(companyId, "connections"), { signal }),
  /** Saves an AgentMail API key as an account connection. */
  connect: (
    companyId: string,
    input: { apiKey: string; grantKind: "user" | "organization"; allAgents: boolean; agentIds: string[]; idempotencyKey: string },
  ) => api.post<ToolConnection>(company(companyId, "connections"), input),
  /** What a pasted key can reach, without saving it. */
  inspect: (companyId: string, apiKey: string) => api.post<AgentMailInspection>(company(companyId, "inspect"), { apiKey }),
  inspectSaved: (companyId: string, connectionId: string) =>
    api.post<AgentMailInspection>(company(companyId, `connections/${enc(connectionId)}/inspect`), {}),
  checkAddress: (companyId: string, connectionId: string, input: { username: string; domain: string }, signal?: AbortSignal) =>
    api.post<EmailAddressCheckResult>(company(companyId, `connections/${enc(connectionId)}/check-address`), input, { signal }),

  inboxes: (companyId: string, signal?: AbortSignal) => api.get<EmailEndpointSummary[]>(company(companyId, "inboxes"), { signal }),
  /** Creates or attaches an inbox for an agent; the idempotency key resumes a partial setup. */
  setup: (companyId: string, input: EmailEndpointSetupInput) => api.post<EmailEndpointSummary>(company(companyId, "inboxes"), input),
  control: (inboxId: string, action: "pause" | "resume" | "remove") =>
    api.post<EmailEndpointSummary>(`/email/inboxes/${enc(inboxId)}/control`, { action }),

  /** A task's email conversation, or null for an ordinary task. */
  thread: (companyId: string, issueId: string, signal?: AbortSignal) =>
    api.get<EmailThreadSummary | null>(company(companyId, `tasks/${enc(issueId)}`), { signal }),
  /** Records what happened to a delivery Paperclip lost track of; it never resends. */
  resolve: (companyId: string, publicationId: string, outcome: "sent" | "failed", providerMessageId?: string) =>
    api.post<EmailPublicationSummary>(company(companyId, `deliveries/${enc(publicationId)}/resolve`), { outcome, providerMessageId }),
};
