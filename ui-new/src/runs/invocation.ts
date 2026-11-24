import type { ClaudeRunManifest, HeartbeatRunEvent, RunPromptRecord } from "@paperclipai/shared";
import { isRunPromptRecord } from "@paperclipai/shared/run-prompt";
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
  /** What a sealed claude_local CLI run got (step 4b); null for other runs and older ones. */
  manifest: ClaudeRunManifest | null;
};

const REDACTED = "••••••••";
const SECRET_KEY = /(api[-_]?key|access[-_]?token|auth(?:_?token)?|authorization|bearer|secret|passwd|password|credential|jwt|private[-_]?key|cookie|connectionstring)/i;
const COMMAND_KEY = /(^command$|^cmd$|command[-_]?line|resolved[-_]?command|PAPERCLIP_RESOLVED_COMMAND)/i;
const JWT_VALUE = /^[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+(?:\.[A-Za-z0-9_-]+)?$/;

const record = (value: unknown): Record<string, unknown> | null =>
  value && typeof value === "object" && !Array.isArray(value) ? (value as Record<string, unknown>) : null;

const text = (value: unknown) => (typeof value === "string" && value.trim() ? value : null);

/*
 * Each attempt of a run writes its own `adapter.invoke`, and a claude_local CLI attempt its own
 * `adapter.prompt` right after it. A resume that fails and retries fresh writes two pairs, and the
 * last is the attempt that ran (plan Review Focus 1), so Input reads the last of each, in `seq`
 * order. An event without a `seq` counts by its place in the list.
 */
function lastEvent(events: readonly HeartbeatRunEvent[] | undefined, eventType: string) {
  let found: { event: HeartbeatRunEvent; order: number } | null = null;
  for (const [index, event] of (events ?? []).entries()) {
    if (event.eventType !== eventType) continue;
    const order = typeof event.seq === "number" ? event.seq : index;
    if (!found || order >= found.order) found = { event, order };
  }
  return found;
}

/** The latest attempt's `adapter.invoke` event. */
export function findInvokeEvent(events: readonly HeartbeatRunEvent[] | undefined) {
  return lastEvent(events, "adapter.invoke")?.event ?? null;
}

/**
 * The latest attempt's prompt in sections (step 5): the last `adapter.prompt` event, and only when it
 * came after the latest `adapter.invoke`. Until the latest attempt's record lands, an earlier
 * attempt's isn't shown beside its invocation.
 */
export function findPromptEvent(events: readonly HeartbeatRunEvent[] | undefined) {
  const prompt = lastEvent(events, "adapter.prompt");
  const invoke = lastEvent(events, "adapter.invoke");
  if (!prompt || (invoke && prompt.order < invoke.order)) return null;
  return prompt.event;
}

/** The prompt record on an `adapter.prompt` event, with home-directory usernames masked when asked. */
export function readPromptRecord(payload: Record<string, unknown> | null | undefined, options: { censorUsername?: boolean } = {}): RunPromptRecord | null {
  if (!isRunPromptRecord(payload)) return null;
  return redactHomePathUserSegmentsInValue(payload, { enabled: options.censorUsername ?? false }) as RunPromptRecord;
}

/* `adapter.prompt` lands just after `adapter.invoke`; a read between the two misses it. */
const PROMPT_EVENT_GRACE_MS = 15_000;

/**
 * Whether a live run's events may still gain what Input shows: no `adapter.invoke` yet, or one so
 * recent that its `adapter.prompt` may not have landed. Runs that record no sections stop after the grace.
 */
export function awaitingInvocationEvents(events: readonly HeartbeatRunEvent[] | undefined, now = Date.now()) {
  const invoke = findInvokeEvent(events);
  if (!invoke) return true;
  if (findPromptEvent(events)) return false;
  // JSON gives an ISO string where the type says Date; `new Date` takes either.
  const at = new Date(invoke.createdAt).getTime();
  return Number.isFinite(at) && now - at < PROMPT_EVENT_GRACE_MS;
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

/**
 * The run manifest a sealed claude_local CLI run records on its `adapter.invoke` event
 * (`payload.runManifest`, step 4b). ui-new takes only types from `@paperclipai/shared`, so this
 * repeats `isClaudeRunManifest`'s checks: an object with `version: 1` and `engine: "cli"`.
 */
export function readRunManifest(payload: Record<string, unknown> | null | undefined): ClaudeRunManifest | null {
  const manifest = record(payload?.runManifest);
  return manifest && manifest.version === 1 && manifest.engine === "cli" ? (manifest as unknown as ClaudeRunManifest) : null;
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
    manifest: (() => {
      const manifest = readRunManifest(payload);
      return manifest ? (redactHomePathUserSegmentsInValue(manifest, { enabled: censor }) as ClaudeRunManifest) : null;
    })(),
  };
}

/** "4.2k characters": the prompt's size, without pretending to count tokens. */
export function promptSize(prompt: string | null) {
  if (!prompt) return null;
  return charsSize(prompt.length);
}

/** "4.2k characters" for a count of characters, as `promptSize` gives for a text. */
export function charsSize(n: number) {
  return n >= 1000 ? `${Number((n / 1000).toFixed(1))}k characters` : `${n} characters`;
}
