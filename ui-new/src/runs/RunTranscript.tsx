import {
  Bot,
  ChevronRight,
  CircleAlert,
  FilePen,
  FileText,
  Globe,
  Info,
  ListTodo,
  Play,
  Search,
  ShieldX,
  Sparkles,
  SquareCheck,
  Terminal,
  Wrench,
} from "lucide-solid";
import { createEffect, createMemo, createSignal, For, Match, on, Show, Switch, type JSX } from "solid-js";
import { createStore, reconcile } from "solid-js/store";
import type { RunDetail } from "@/api/runs";
import { Markdown } from "@/ui/Markdown";
import { toolDuration } from "./activity-model";
import { ActivityRowView, HealthBanner, PlanCard, ProposalCard, ReasoningSections, StatusChipView } from "./RunActivity";
import { hasReasoningHeadlines, latestReasoningHeadline, reasoningSummarySections } from "./reasoning-summary";
import type { RunInvocation } from "./invocation";
import { capitalize, costLabel, elapsedLabel, formatBytes, formatDuration, tokenCount, triggerLabel } from "./run-model";
import { RunRequest, type AnswerRequest } from "./RunRequest";
import { summarizeDecision, type DecisionLookup } from "./tool-decisions";
import { runHealth, transcriptSteps, visibleItems, type DiffLine, type ShownItem, type StepKind, type Subagent, type TranscriptItem } from "./transcript-model";
import "./RunTranscript.css";

/*
 * The Transcript view (board 16): what Paperclip sent, then the run as it happened, each line
 * stamped with the time since the run started. Messages read as text; thinking, tool calls and
 * diffs open on demand; long stretches of steps fold. A finished run leads with its outcome when
 * the agent reported one.
 *
 * Tool calls carry the tool gateway's decision on them (allowed, denied, needs approval) when
 * there is one, and a harness's runtime requests (permission or input it asked for mid-turn) can
 * be answered in place while the run goes.
 *
 * The runner's own activity (U42) reads as in the old task chat: a tool row says what ran and how
 * it went (`$ command`, an exit chip, its time, a refusal, an auto-review's approval) with an edit's
 * diff inline; subagents are a tree with their own calls; dedicated rows, status chips, the plan,
 * a proposed plan and reasoning headlines come from RunActivity.tsx; an MCP server that failed to
 * start leads the view.
 */

const STEP_ICONS: Record<StepKind, (props: { size: number }) => JSX.Element> = {
  read: (p) => <FileText size={p.size} aria-hidden="true" />,
  command: (p) => <Terminal size={p.size} aria-hidden="true" />,
  edit: (p) => <FilePen size={p.size} aria-hidden="true" />,
  search: (p) => <Search size={p.size} aria-hidden="true" />,
  web: (p) => <Globe size={p.size} aria-hidden="true" />,
  task: (p) => <ListTodo size={p.size} aria-hidden="true" />,
  other: (p) => <Wrench size={p.size} aria-hidden="true" />,
};

/** Diff lines shown before "Show N more changed lines". */
const DIFF_PREVIEW = 12;

export function RunTranscript(props: {
  run: RunDetail;
  items: TranscriptItem[];
  invocation: RunInvocation | null;
  agentName: string;
  harness: string;
  live: boolean;
  showThinking: boolean;
  showTools: boolean;
  loading: boolean;
  error: string | null;
  skippedBytes: number;
  /** The harness's output can't be read as a structured transcript, so it shows as plain lines. */
  plainLines: boolean;
  onRetry: () => void;
  /** Opens the Input view; left out on a phone, where it opens on desktop. */
  onShowInput?: () => void;
  /** Folds opened for Find in run, because they hide a match (find-model.ts `foldsToReveal`). */
  reveal?: ReadonlySet<string>;
  /** The tool gateway's decision on a tool call, if it made one. */
  decisionFor?: DecisionLookup;
  /** Answers a runtime request; without it, requests show read-only. */
  onAnswer?: AnswerRequest;
  /** Shown before the steps, such as the run's workspace operations. */
  before?: JSX.Element;
}) {
  const [expanded, setExpanded] = createSignal<ReadonlySet<string>>(new Set());
  createEffect(on(() => props.run.id, () => setExpanded(new Set<string>()), { defer: true }));

  const outcomes = createMemo(() => props.items.filter((item): item is Extract<TranscriptItem, { kind: "outcome" }> => item.kind === "outcome"));
  const shown = createMemo(() =>
    visibleItems(transcriptSteps(props.items), {
      thinking: props.showThinking,
      tools: props.showTools,
      expanded: props.reveal?.size ? new Set([...expanded(), ...props.reveal]) : expanded(),
    }),
  );
  // Reconciled by key, so streaming updates change items in place and open details stay open.
  const [store, setStore] = createStore<{ items: ShownItem[] }>({ items: [] });
  createEffect(() => setStore("items", reconcile(shown(), { key: "key", merge: true })));

  const start = () => new Date(props.run.startedAt ?? props.run.createdAt).getTime();
  const at = (ts: string) => elapsedLabel(new Date(ts).getTime() - start());

  return (
    <div class="rt" role="log" aria-label="Run transcript" aria-live={props.live ? "polite" : "off"}>
      <Show when={props.plainLines}>
        <p class="rm-note">
          <Info size={15} aria-hidden="true" />
          <span>
            ui-new can't read {props.harness}'s output as a structured transcript yet, so it shows as plain lines.
            {props.run.runtimeMode === "native" ? " This run used Paperclip's native runtime." : ""}
          </span>
        </p>
      </Show>
      <Show when={runHealth(props.items).length > 0}>
        <HealthBanner failures={runHealth(props.items)} />
      </Show>
      <For each={outcomes()}>{(outcome) => <Outcome item={outcome} />}</For>

      <Show when={props.run.startedAt}>
        <div class="rt-e">
          <span class="rt-ts">0:00</span>
          <p class="rt-sys">
            <Play size={13} aria-hidden="true" />
            <b>Run started</b> · {triggerLabel(props.run).toLowerCase()} · {capitalize(props.harness)}
            <Show when={props.run.sessionIdBefore}>{(session) => <> · resumed session <span class="mono">{session().slice(0, 8)}</span></>}</Show>
          </p>
        </div>
      </Show>

      <Show when={props.invocation?.prompt}>
        {(prompt) => (
          <div class="rt-e">
            <span class="rt-ts">0:00</span>
            <section class="rt-card rt-input" aria-label="Prompt from Paperclip">
              <div class="rt-input-head">
                <span class="rt-tag">Input</span>
                <span>Prompt from Paperclip</span>
                <span class="cap">· {prompt().length.toLocaleString()} characters</span>
                <Show when={props.onShowInput}>
                  {(show) => (
                    <button type="button" class="rm-b" onClick={() => show()()}>
                      Show full input
                    </button>
                  )}
                </Show>
              </div>
              <div class="rt-fade">
                <pre class="rm-pre">{prompt().slice(0, 600)}</pre>
              </div>
            </section>
          </div>
        )}
      </Show>

      {props.before}

      <Show when={props.skippedBytes > 0}>
        <p class="rm-note">
          <Info size={15} aria-hidden="true" />
          <span>The first {formatBytes(props.skippedBytes)} of output aren't loaded; the transcript starts partway through the run.</span>
        </p>
      </Show>

      <For each={store.items}>
        {(item) => (
          <div class="rt-e">
            <span class="rt-ts">{at(item.ts)}</span>
            <div class="rt-main">
              <Item
                item={item}
                agentName={props.agentName}
                onExpand={(key) => setExpanded(new Set([...expanded(), key]))}
                at={at}
                decisionFor={props.decisionFor}
                live={props.live}
                onAnswer={props.onAnswer}
              />
            </div>
          </div>
        )}
      </For>

      <Switch>
        <Match when={props.error}>
          {(error) => (
            <p class="rm-note rm-note--error">
              <CircleAlert size={15} aria-hidden="true" />
              <span>The output couldn't be loaded: {error()}</span>
              <button type="button" class="rm-b" onClick={() => props.onRetry()}>
                Retry
              </button>
            </p>
          )}
        </Match>
        <Match when={props.loading}>
          <p class="cap rt-wait">Loading the transcript…</p>
        </Match>
        <Match when={props.items.length === 0}>
          <p class="cap rt-wait">
            {props.live
              ? props.run.status === "queued"
                ? "The run is queued. Its output appears here when it starts."
                : "Waiting for the first output…"
              : "This run left no output."}
          </p>
        </Match>
      </Switch>
    </div>
  );
}

function Item(props: {
  item: ShownItem;
  agentName: string;
  at: (ts: string) => string;
  onExpand: (key: string) => void;
  decisionFor?: DecisionLookup;
  live: boolean;
  onAnswer?: AnswerRequest;
}) {
  return (
    <Switch>
      <Match when={props.item.kind === "fold" && props.item}>
        {(fold) => (
          <button type="button" class="rt-fold" onClick={() => props.onExpand(fold().key)}>
            <ChevronRight size={14} aria-hidden="true" />
            <span>Show {fold().items.length} more steps</span>
            <span class="cap">
              {props.at(fold().ts)} – {props.at(fold().endTs)}
            </span>
            <span class="cap">{fold().summary}</span>
          </button>
        )}
      </Match>
      <Match when={props.item.kind === "started" && props.item}>
        {(started) => (
          <p class="rt-sys">
            <Sparkles size={13} aria-hidden="true" />
            <span>
              {started().model || "Model not reported"}
              <Show when={started().sessionId}>{(session) => <> · session <span class="mono">{session().slice(0, 8)}</span></>}</Show>
            </span>
          </p>
        )}
      </Match>
      <Match when={props.item.kind === "message" && props.item}>
        {(message) => (
          <div class="rt-say" data-role={message().role}>
            <span class="rt-sav" aria-hidden="true">
              <Show when={message().role === "assistant"} fallback={<Info size={12} />}>
                <Bot size={12} />
              </Show>
            </span>
            <div class="rt-say-body">
              <span class="rt-who">{message().role === "assistant" ? props.agentName : "Sent to the agent"}</span>
              <Markdown source={message().text} class="rt-md" />
              <Show when={message().streaming}>
                <span class="rt-caret" aria-hidden="true">
                  ▍
                </span>
              </Show>
            </div>
          </div>
        )}
      </Match>
      <Match when={props.item.kind === "thinking" && props.item}>
        {(thinking) => {
          // A reasoning summary written as headlines (Codex) reads as bullets, led by the latest one.
          const headlines = () => !!thinking().summary && hasReasoningHeadlines(reasoningSummarySections(thinking().text));
          return (
            <details class="rt-think" classList={{ "rt-think--live": thinking().streaming }} open={thinking().streaming}>
              <summary>
                <ChevronRight size={13} class="rt-chev" aria-hidden="true" />
                <Show when={thinking().streaming} fallback={<span>Thought for {formatDuration(new Date(thinking().endTs).getTime() - new Date(thinking().ts).getTime())}</span>}>
                  <span class="rm-pulse" aria-hidden="true" />
                  <span>Thinking now</span>
                </Show>
                <i>{headlines() ? latestReasoningHeadline(thinking().text) : thinking().text.split("\n")[0]}</i>
              </summary>
              <div class="rt-tb">
                <Show
                  when={headlines()}
                  fallback={
                    <p>
                      {thinking().text}
                      <Show when={thinking().streaming}>
                        <span class="rt-caret" aria-hidden="true">
                          ▍
                        </span>
                      </Show>
                    </p>
                  }
                >
                  <ReasoningSections text={thinking().text} streaming={thinking().streaming} />
                </Show>
              </div>
            </details>
          );
        }}
      </Match>
      <Match when={props.item.kind === "tool" && props.item}>
        {(tool) => <Tool item={tool()} decisionFor={props.decisionFor} />}
      </Match>
      <Match when={props.item.kind === "activity" && props.item}>{(activity) => <ActivityRowView row={activity().row} ts={activity().ts} />}</Match>
      <Match when={props.item.kind === "chip" && props.item}>{(chip) => <StatusChipView chip={chip().chip} />}</Match>
      <Match when={props.item.kind === "subagents" && props.item}>{(group) => <Subagents agents={group().agents} decisionFor={props.decisionFor} />}</Match>
      <Match when={props.item.kind === "plan" && props.item}>{(plan) => <PlanCard plan={plan().plan} />}</Match>
      <Match when={props.item.kind === "proposal" && props.item}>{(proposal) => <ProposalCard markdown={proposal().markdown} streaming={proposal().streaming} />}</Match>
      <Match when={props.item.kind === "request" && props.item}>
        {(asked) => <RunRequest request={asked().request} live={props.live} onAnswer={props.onAnswer} />}
      </Match>
      <Match when={props.item.kind === "diff" && props.item}>
        {(diff) => (
          <details class="rt-tool" open>
            <summary>
              <ChevronRight size={13} class="rt-chev" aria-hidden="true" />
              <FilePen size={14} aria-hidden="true" />
              <span class="rt-tn">Diff</span>
              <span class="rt-tt">{diff().file ?? "Changes"}</span>
              <span class="rt-tm">
                <span class="rt-add">+{diff().added}</span>
                <span class="rt-del">−{diff().removed}</span>
              </span>
            </summary>
            <div class="rt-tbody">
              <Diff lines={diff().lines} />
            </div>
          </details>
        )}
      </Match>
      <Match when={props.item.kind === "note" && props.item}>
        {(note) => (
          <div class="rt-note" data-tone={note().tone}>
            <span class="rt-note-label">{note().label}</span>
            <pre>{note().lines.join("\n")}</pre>
          </div>
        )}
      </Match>
      <Match when={props.item.kind === "output" && props.item}>
        {(output) => <pre class="rm-pre">{output().text}</pre>}
      </Match>
      <Match when={props.item.kind === "finished" && props.item}>
        {(finished) => (
          <p class="rt-sys" data-tone={finished().isError ? "error" : undefined}>
            <Show when={finished().isError} fallback={<SquareCheck size={13} aria-hidden="true" />}>
              <CircleAlert size={13} aria-hidden="true" />
            </Show>
            <b>{finished().isError ? "Run ended with an error" : "Run finished"}</b>
            <Show when={finished().isError && finished().text}>{(text) => <span> · {text()}</span>}</Show>
            <Show when={finished().inputTokens || finished().outputTokens}>
              <span>
                · {tokenCount(finished().inputTokens + finished().cachedTokens)} tokens in · {tokenCount(finished().outputTokens)} out
              </span>
            </Show>
            <Show when={finished().costUsd > 0}>
              <span> · {costLabel(finished().costUsd)}</span>
            </Show>
          </p>
        )}
      </Match>
    </Switch>
  );
}

function Tool(props: { item: Extract<TranscriptItem, { kind: "tool" }>; decisionFor?: DecisionLookup }) {
  const took = () =>
    props.item.endTs ? formatDuration(new Date(props.item.endTs).getTime() - new Date(props.item.ts).getTime()) : null;
  const decision = createMemo(() => props.decisionFor?.(props.item.refs) ?? null);
  const summary = createMemo(() => {
    const found = decision();
    return found ? summarizeDecision(found) : null;
  });
  // A call the gateway held or refused opens, so the reader sees why.
  const held = () => summary()?.tone === "red" || summary()?.tone === "amber";
  // Exit 0 is news only for a command; for reads and searches it's noise.
  const exit = () => {
    const code = props.item.exitCode;
    return code === null || code === undefined || props.item.status === "running" || (code === 0 && props.item.step !== "command") ? null : code;
  };
  const time = () => (props.item.durationMs ? toolDuration(props.item.durationMs) : took());
  return (
    <details class="rt-tool" data-status={props.item.blocked ? "blocked" : props.item.status} open={held() || undefined}>
      <summary>
        <ChevronRight size={13} class="rt-chev" aria-hidden="true" />
        <Show when={props.item.blocked} fallback={STEP_ICONS[props.item.step]({ size: 14 })}>
          <ShieldX size={14} class="rt-blocked-icon" aria-hidden="true" />
        </Show>
        <span class="rt-tn">{props.item.name}</span>
        <span class="rt-tt" title={props.item.title}>
          {props.item.step === "command" && props.item.title ? `$ ${props.item.title}` : props.item.title}
        </span>
        <span class="rt-tm">
          <Show when={props.item.review}>
            {(review) => (
              <span class="rt-dec rt-review" data-tone="green" title="An automatic review approved this call">
                {review()}
              </span>
            )}
          </Show>
          <Show when={summary()}>
            {(found) => (
              <span class="rt-dec" data-tone={found().tone} title="The tool gateway's decision">
                {found().label}
              </span>
            )}
          </Show>
          <Show when={props.item.diff}>
            <span class="rt-add">+{props.item.added}</span>
            <Show when={props.item.removed}>
              <span class="rt-del">−{props.item.removed}</span>
            </Show>
          </Show>
          <Show when={exit() !== null}>
            <span class="rt-exit" data-ok={exit() === 0 || undefined}>
              exit {exit()}
            </span>
          </Show>
          <Switch>
            <Match when={props.item.status === "running"}>
              <span class="rt-running">running</span>
            </Match>
            <Match when={props.item.blocked}>
              <span class="rt-failed">blocked</span>
            </Match>
            <Match when={props.item.status === "error" && exit() === null}>
              <span class="rt-failed">failed</span>
            </Match>
            <Match when={time()}>{(text) => <span>{text()}</span>}</Match>
          </Switch>
        </span>
      </summary>
      <div class="rt-tbody">
        <Show when={props.item.description}>{(description) => <p class="rt-why">{description()}</p>}</Show>
        <Show when={props.item.blocked}>
          {(reason) => (
            <p class="rt-why rt-why--blocked">
              <b>Blocked</b> · {reason()}
            </p>
          )}
        </Show>
        <Show when={decision()}>
          {(found) => (
            <div class="rt-decision">
              <span class="rt-lbl">Gateway decision</span>
              <p>
                <b>{summary()!.label}</b>
                <Show when={found().reasonCode}>{(code) => <span class="mono"> · {code()}</span>}</Show>
                <Show when={summary()!.detail && summary()!.detail !== found().reasonCode}> · {summary()!.detail}</Show>
              </p>
              <Show when={found().pendingAction?.previewMarkdown}>{(preview) => <Markdown source={preview()} class="rt-md" />}</Show>
              <span class="cap mono">
                invocation {found().invocation.id.slice(0, 8)} · {found().auditEvents.length} audit {found().auditEvents.length === 1 ? "event" : "events"}
                <Show when={found().actionRequest}>{(request) => <> · action {request().status.replace(/_/g, " ")}</>}</Show>
              </span>
            </div>
          )}
        </Show>
        <Show
          when={props.item.diff}
          fallback={
            <Show when={props.item.input}>
              <span class="rt-lbl">Input</span>
              <pre class="rm-pre">{props.item.input}</pre>
            </Show>
          }
        >
          {(lines) => (
            <>
              <Diff lines={lines()} />
              <Show when={props.item.diffTruncated}>
                <p class="cap">The diff was shortened for display; the line counts cover the whole change.</p>
              </Show>
            </>
          )}
        </Show>
        <Show when={props.item.output}>
          {(output) => (
            <>
              <span class="rt-lbl">{props.item.status === "error" ? "Error" : "Output"}</span>
              <pre class="rm-pre" data-tone={props.item.status === "error" ? "error" : undefined}>
                {output()}
              </pre>
            </>
          )}
        </Show>
      </div>
    </details>
  );
}

const SUBAGENT_STATUS: Record<Subagent["status"], string> = { running: "running", done: "done", error: "failed", stopped: "stopped" };

/**
 * Subagents dispatched together (upstream #19264): one card each, or a tree under "N subagents".
 * Each opens to the task it was given, the calls it made and what it reported.
 */
function Subagents(props: { agents: Subagent[]; decisionFor?: DecisionLookup }) {
  return (
    <section class="rt-subs" aria-label={props.agents.length === 1 ? "Subagent" : `${props.agents.length} subagents`}>
      <Show when={props.agents.length > 1}>
        <p class="rt-subs-head">
          <Bot size={13} aria-hidden="true" />
          <b>{props.agents.length} subagents</b>
          <span class="cap">
            {props.agents.filter((agent) => agent.status === "running").length
              ? `${props.agents.filter((agent) => agent.status === "running").length} running`
              : "all finished"}
          </span>
        </p>
      </Show>
      <For each={props.agents}>
        {(agent) => (
          <details class="rt-tool rt-sub" data-status={agent.status === "error" ? "error" : agent.status} open={agent.status === "running" || undefined}>
            <summary>
              <ChevronRight size={13} class="rt-chev" aria-hidden="true" />
              <Bot size={14} aria-hidden="true" />
              <span class="rt-tn">{agent.role}</span>
              <span class="rt-sub-desc">{agent.description}</span>
              <span class="rt-tm">
                <Show when={agent.tools.length > 0}>
                  <span>
                    {agent.tools.length} {agent.tools.length === 1 ? "step" : "steps"}
                  </span>
                </Show>
                <span classList={{ "rt-running": agent.status === "running", "rt-failed": agent.status === "error" }}>{SUBAGENT_STATUS[agent.status]}</span>
              </span>
            </summary>
            <div class="rt-tbody">
              <Show when={agent.progress}>{(progress) => <p class="rt-why">{progress()}</p>}</Show>
              <Show when={agent.prompt}>
                {(prompt) => (
                  <>
                    <span class="rt-lbl">Task{agent.model ? ` · ${agent.model}` : ""}</span>
                    <p class="rt-why">{prompt()}</p>
                  </>
                )}
              </Show>
              <Show when={agent.tools.length > 0}>
                <div class="rt-sub-tools">
                  <For each={agent.tools}>{(tool) => <Tool item={tool} decisionFor={props.decisionFor} />}</For>
                </div>
              </Show>
              <Show when={agent.result}>
                {(result) => (
                  <>
                    <span class="rt-lbl">{agent.status === "error" ? "What went wrong" : "Result"}</span>
                    <Markdown source={result()} class="rt-md" />
                  </>
                )}
              </Show>
            </div>
          </details>
        )}
      </For>
    </section>
  );
}

function Diff(props: { lines: DiffLine[] }) {
  const [all, setAll] = createSignal(false);
  const lines = () => (all() ? props.lines : props.lines.slice(0, DIFF_PREVIEW));
  return (
    <div class="rt-diff">
      <For each={lines()}>
        {(line) => (
          <div data-type={line.type}>
            {line.type === "add" ? "+" : line.type === "remove" ? "-" : line.type === "context" ? " " : ""}
            {line.text}
          </div>
        )}
      </For>
      <Show when={!all() && props.lines.length > DIFF_PREVIEW}>
        <button type="button" class="rt-diff-more" onClick={() => setAll(true)}>
          Show {props.lines.length - DIFF_PREVIEW} more changed lines
        </button>
      </Show>
    </div>
  );
}

function Outcome(props: { item: Extract<TranscriptItem, { kind: "outcome" }> }) {
  const DISPOSITIONS: Record<string, string> = {
    done: "Done",
    blocked: "Blocked",
    needs_review: "Needs review",
    yielded: "Progress made · task continues",
  };
  return (
    <section class="rt-card rt-out" data-disposition={props.item.disposition} aria-label="Outcome">
      <div class="rt-input-head">
        <span class="rt-tag">Outcome</span>
        <span>{DISPOSITIONS[props.item.disposition] ?? props.item.disposition}</span>
      </div>
      <Show when={props.item.summary}>
        <Markdown source={props.item.summary} class="rt-md" />
      </Show>
      <dl class="rt-og">
        <Show when={props.item.checks.length > 0}>
          <dt>Checks</dt>
          <dd>
            <For each={props.item.checks}>
              {(check) => (
                <span class="rt-li" data-passed={check.passed === null ? undefined : String(check.passed)}>
                  {check.passed === false ? "✕" : check.passed ? "✓" : "–"} {check.label}
                </span>
              )}
            </For>
          </dd>
        </Show>
        <Show when={props.item.remaining.length > 0}>
          <dt>Still to do</dt>
          <dd>
            <For each={props.item.remaining}>{(work) => <span class="rt-li">{work}</span>}</For>
          </dd>
        </Show>
        <Show when={props.item.artifacts.length > 0}>
          <dt>Outputs</dt>
          <dd>
            <For each={props.item.artifacts}>{(artifact) => <span class="rt-obj">{artifact}</span>}</For>
          </dd>
        </Show>
      </dl>
    </section>
  );
}
