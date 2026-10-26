import type { HeartbeatRunEvent } from "@paperclipai/shared";
import { redactCommandText } from "@paperclipai/adapter-utils/command-redaction";
import { redactHomePathUserSegments, redactHomePathUserSegmentsInValue } from "@paperclipai/adapter-utils/log-redaction";

/*
 * "What the agent was sent" (board 17, decision 4). By default a run keeps only what Paperclip
 * handed the harness: the `adapter.invoke` event's prompt, wake context, command and environment.
 * The harness adds its own system prompt, tools and session history before calling the model, and
 * only a provider trace records that. The rules for showing the payload safely follow the old UI's
 * RunInvocationCard (ui/src/pages/AgentDetail.tsx): secret-looking values and secret references are
 * hidden, and home-directory usernames are masked when the instance asks for it.
 */

export type EnvLine = { key: string; value: string; hidden: boolean };

export type RunInvocation = {
  adapterType: string | null;
  cwd: string | null;
  /** The rendered prompt; JSON prompts are pretty-printed. */
  prompt: string | null;
  /** What Paperclip knew about the wake, pretty-printed. */
  context: string | null;
  command: string | null;
  commandNotes: string[];
  env: EnvLine[];
};

const REDACTED = "••••••••";
const SECRET_KEY = /(api[-_]?key|access[-_]?token|auth(?:_?token)?|authorization|bearer|secret|passwd|password|credential|jwt|private[-_]?key|cookie|connectionstring)/i;
const COMMAND_KEY = /(^command$|^cmd$|command[-_]?line|resolved[-_]?command|PAPERCLIP_RESOLVED_COMMAND)/i;
const JWT_VALUE = /^[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+(?:\.[A-Za-z0-9_-]+)?$/;

const record = (value: unknown): Record<string, unknown> | null =>
  value && typeof value === "object" && !Array.isArray(value) ? (value as Record<string, unknown>) : null;

const text = (value: unknown) => (typeof value === "string" && value.trim() ? value : null);

export function findInvokeEvent(events: readonly HeartbeatRunEvent[] | undefined) {
  return events?.find((event) => event.eventType === "adapter.invoke") ?? null;
}

function envLine(key: string, value: unknown, censor: boolean): EnvLine {
  const options = { enabled: censor };
  if (record(value)?.type === "secret_ref") return { key, value: `${REDACTED} (secret)`, hidden: true };
  if (SECRET_KEY.test(key) || (typeof value === "string" && JWT_VALUE.test(value))) return { key, value: REDACTED, hidden: true };
  if (value === null || value === undefined) return { key, value: "", hidden: false };
  if (typeof value === "string") {
    const shown = COMMAND_KEY.test(key) ? redactCommandText(value, REDACTED) : value;
    return { key, value: redactHomePathUserSegments(shown, options), hidden: false };
  }
  try {
    return { key, value: JSON.stringify(redactHomePathUserSegmentsInValue(value, options)), hidden: false };
  } catch {
    return { key, value: String(value), hidden: false };
  }
}

export function readInvocation(payload: Record<string, unknown> | null | undefined, options: { censorUsername?: boolean } = {}): RunInvocation | null {
  if (!payload) return null;
  const censor = options.censorUsername ?? false;
  const paths = (value: string) => redactHomePathUserSegments(value, { enabled: censor });
  const json = (value: unknown) => JSON.stringify(redactHomePathUserSegmentsInValue(value, { enabled: censor }), null, 2);

  const commandParts = [
    text(payload.command),
    ...(Array.isArray(payload.commandArgs) ? payload.commandArgs.filter((part): part is string => typeof part === "string") : []),
  ].filter((part): part is string => !!part);

  let prompt: string | null = null;
  if (typeof payload.prompt === "string") prompt = paths(payload.prompt);
  else if (payload.prompt !== undefined && payload.prompt !== null) prompt = json(payload.prompt);

  const env = record(payload.env);
  return {
    adapterType: text(payload.adapterType),
    cwd: text(payload.cwd) ? paths(payload.cwd as string) : null,
    prompt,
    context: payload.context === undefined || payload.context === null ? null : json(payload.context),
    command: commandParts.length > 0 ? paths(redactCommandText(commandParts.join(" "), REDACTED)) : null,
    commandNotes: Array.isArray(payload.commandNotes)
      ? payload.commandNotes.filter((note): note is string => typeof note === "string" && note.trim().length > 0).map(paths)
      : [],
    env: env ? Object.keys(env).sort().map((key) => envLine(key, env[key], censor)) : [],
  };
}

/** "4.2k characters": the prompt's size, without pretending to count tokens. */
export function promptSize(prompt: string | null) {
  if (!prompt) return null;
  const n = prompt.length;
  return n >= 1000 ? `${Number((n / 1000).toFixed(1))}k characters` : `${n} characters`;
}
