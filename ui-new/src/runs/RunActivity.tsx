import {
  ArrowRightLeft,
  Bot,
  Check,
  ChevronRight,
  CircleCheck,
  CircleDashed,
  CircleX,
  Clock3,
  FileText,
  Globe,
  Info,
  Layers,
  ListChecks,
  RotateCw,
  Search,
  ShieldAlert,
  ShieldCheck,
  ShieldX,
  TerminalSquare,
  TriangleAlert,
  Webhook,
} from "lucide-solid";
import { createSignal, For, Match, Show, Switch, type JSX } from "solid-js";
import { useNow } from "@/lib/clock";
import { Markdown } from "@/ui/Markdown";
import {
  planHeadline,
  planRows,
  proposalTitle,
  waitDuration,
  type ActivityRow,
  type Plan,
  type PlanStep,
  type StatusChip,
} from "./activity-model";
import { hasReasoningHeadlines, reasoningSummarySections } from "./reasoning-summary";
import "./RunActivity.css";

/*
 * The runner's own activity in a transcript (U42, upstream's Nov 5 task-chat upgrades), drawn in
 * Capsule Stack's quiet style: dedicated rows for web searches, model switches, waits, checks,
 * hooks and auto-reviews (grey unless they stopped the agent); status notices as chips; the
 * agent's native plan as a checklist; a proposed plan as a card; a warning for MCP servers that
 * didn't start; and Codex reasoning summaries as headline bullets. The run modal and the chat's
 * live reply both use them.
 */

const SOURCE_PREVIEW = 3;

function RowIcon(props: { row: ActivityRow }) {
  const size = 14;
  return (
    <Switch fallback={<Info size={size} aria-hidden="true" />}>
      <Match when={props.row.icon === "web"}>
        <Search size={size} aria-hidden="true" />
      </Match>
      <Match when={props.row.icon === "page"}>
        <Globe size={size} aria-hidden="true" />
      </Match>
      <Match when={props.row.icon === "model"}>
        <ArrowRightLeft size={size} aria-hidden="true" />
      </Match>
      <Match when={props.row.icon === "wait"}>
        <Clock3 size={size} aria-hidden="true" />
      </Match>
      <Match when={props.row.icon === "check"}>
        <Switch fallback={<CircleDashed size={size} aria-hidden="true" />}>
          <Match when={props.row.tone === "passed"}>
            <CircleCheck size={size} aria-hidden="true" />
          </Match>
          <Match when={props.row.tone === "failed"}>
            <CircleX size={size} aria-hidden="true" />
          </Match>
        </Switch>
      </Match>
      <Match when={props.row.icon === "hook"}>
        <Show when={props.row.tone === "neutral"} fallback={<ShieldX size={size} aria-hidden="true" />}>
          <Webhook size={size} aria-hidden="true" />
        </Show>
      </Match>
      <Match when={props.row.icon === "review"}>
        <Switch fallback={<ShieldAlert size={size} aria-hidden="true" />}>
          <Match when={props.row.tone === "blocked"}>
            <ShieldX size={size} aria-hidden="true" />
          </Match>
          <Match when={props.row.label === "Auto-review approved" || props.row.status === "running"}>
            <ShieldCheck size={size} aria-hidden="true" />
          </Match>
        </Switch>
      </Match>
      <Match when={props.row.icon === "subagent"}>
        <Bot size={size} aria-hidden="true" />
      </Match>
    </Switch>
  );
}

/** "12s left" for a running wait with a planned length, counted from when it started. */
function Countdown(props: { startedAt: string; plannedMs: number }) {
  const now = useNow(() => true);
  const left = () => Math.max(0, props.plannedMs - (now() - new Date(props.startedAt).getTime()));
  return <span class="ra-left">{waitDuration(left())} left</span>;
}

/**
 * One dedicated row: icon, what happened, its subject; a reason under it when it stopped the agent.
 * A check's outcome ("6 tests passed") follows on the same line.
 */
export function ActivityRowView(props: { row: ActivityRow; ts: string }) {
  const inline = () => props.row.icon === "check";
  const hosts = () => {
    const seen = new Set<string>();
    return (props.row.links ?? []).filter((link) => !seen.has(link.host) && !!seen.add(link.host));
  };
  return (
    <div class="ra-row" data-tone={props.row.tone} data-status={props.row.status} data-icon={props.row.icon}>
      <div class="ra-line">
        <span class="ra-icon">
          <RowIcon row={props.row} />
        </span>
        <span class="ra-label">
          {props.row.label}
          {props.row.status === "running" ? "…" : ""}
        </span>
        <Show when={props.row.detail}>
          <span class="ra-detail" title={props.row.detail}>
            {props.row.detail}
          </span>
        </Show>
        <Show when={inline() && props.row.note}>
          <span class="ra-outcome" title={props.row.note}>
            {props.row.note}
          </span>
        </Show>
        <Show when={props.row.status === "running" && props.row.plannedMs !== undefined}>
          <Countdown startedAt={props.ts} plannedMs={props.row.plannedMs!} />
        </Show>
        <Show when={props.row.status === "running"}>
          <span class="rm-pulse ra-pulse" aria-hidden="true" />
          <span class="sr-only">(going)</span>
        </Show>
      </div>
      <Show when={!inline() && props.row.note}>
        <p class="ra-note">{props.row.note}</p>
      </Show>
      <Show when={hosts().length > 0}>
        <div class="ra-sources" aria-label="Sources">
          <For each={hosts().slice(0, SOURCE_PREVIEW)}>
            {(link) => (
              <a class="ra-source" href={link.href} target="_blank" rel="noreferrer" title={link.title}>
                {link.host}
              </a>
            )}
          </For>
          <Show when={(props.row.links?.length ?? 0) > Math.min(SOURCE_PREVIEW, hosts().length)}>
            <span class="ra-more">+{(props.row.links?.length ?? 0) - Math.min(SOURCE_PREVIEW, hosts().length)} more</span>
          </Show>
        </div>
      </Show>
    </div>
  );
}

/** A harness status notice as a chip; a fatal provider error as a full row. */
export function StatusChipView(props: { chip: StatusChip }) {
  const icon = () => {
    const size = 13;
    switch (props.chip.category) {
      case "context_compaction":
        return props.chip.tone === "warning" ? <TriangleAlert size={size} aria-hidden="true" /> : <Layers size={size} aria-hidden="true" />;
      case "provider_retry":
        return props.chip.label === "Recovered after retry" ? <Check size={size} aria-hidden="true" /> : <RotateCw size={size} aria-hidden="true" />;
      case "model_fallback":
        return <ArrowRightLeft size={size} aria-hidden="true" />;
      case "local_command_output":
        return <TerminalSquare size={size} aria-hidden="true" />;
      case "provider_error":
        return <CircleX size={size} aria-hidden="true" />;
      default:
        return props.chip.tone === "neutral" ? <Info size={size} aria-hidden="true" /> : <TriangleAlert size={size} aria-hidden="true" />;
    }
  };
  return (
    <Show
      when={!props.chip.fatal}
      fallback={
        <p class="rm-note rm-note--error ra-fatal" role="alert">
          {icon()}
          <span>
            <b>{props.chip.label}</b> · {props.chip.detail}
          </span>
        </p>
      }
    >
      <div class="ra-chips">
        <span class="ra-chip" data-tone={props.chip.tone} data-active={props.chip.active || undefined} role="status" title={props.chip.detail}>
          <Show when={props.chip.active} fallback={icon()}>
            <span class="rm-pulse ra-pulse" aria-hidden="true" />
          </Show>
          <span class="ra-chip-label">{props.chip.label}</span>
          <Show when={props.chip.detail}>
            <span class="ra-chip-detail">{props.chip.detail}</span>
          </Show>
        </span>
      </div>
    </Show>
  );
}

const STEP_MARKS: Record<PlanStep["status"], string> = { completed: "✓", in_progress: "›", pending: "○", blocked: "!", failed: "!" };
const STEP_WORDS: Record<PlanStep["status"], string> = { completed: "done", in_progress: "going", pending: "to do", blocked: "blocked", failed: "failed" };

/** The plan's steps: done, the current one, what's next and what's stuck. Long plans show a window. */
export function PlanChecklist(props: { plan: Plan; window?: boolean }) {
  const [all, setAll] = createSignal(false);
  const rows = () => planRows(props.plan, !props.window || all());
  return (
    <ol class="ra-steps">
      <For each={rows()}>
        {(row) => (
          <Switch>
            <Match when={row.kind === "step" && row}>
              {(step) => (
                <li class="ra-step" data-status={step().step.status} data-current={step().current || undefined}>
                  <span class="ra-step-mark" aria-hidden="true">
                    {STEP_MARKS[step().step.status]}
                  </span>
                  <span class="ra-step-label">{step().step.label}</span>
                  <span class="sr-only">({STEP_WORDS[step().step.status]})</span>
                </li>
              )}
            </Match>
            <Match when={row.kind !== "step" && row}>
              {(more) => (
                <li class="ra-step ra-step--more">
                  <button type="button" class="ra-link" onClick={() => setAll(true)}>
                    {more().kind === "earlier" ? `${(more() as { count: number }).count} earlier` : `${(more() as { count: number }).count} more`}
                  </button>
                </li>
              )}
            </Match>
          </Switch>
        )}
      </For>
    </ol>
  );
}

/** The plan card in the transcript: headline, progress, every step. */
export function PlanCard(props: { plan: Plan }) {
  const done = () => props.plan.steps.filter((step) => step.status === "completed").length;
  return (
    <section class="rt-card ra-plan" aria-label="The agent's plan" data-complete={props.plan.complete || undefined}>
      <div class="rt-input-head">
        <ListChecks size={14} aria-hidden="true" />
        <span class="rt-tag">Plan</span>
        <span class="ra-plan-head">{planHeadline(props.plan)}</span>
        <span class="cap ra-count">
          {done()}/{props.plan.steps.length}
        </span>
      </div>
      <Show when={props.plan.explanation && props.plan.explanation !== "Plan"}>
        <p class="ra-plan-why">{props.plan.explanation}</p>
      </Show>
      <PlanProgress plan={props.plan} />
      <PlanChecklist plan={props.plan} />
    </section>
  );
}

export function PlanProgress(props: { plan: Plan }) {
  const done = () => props.plan.steps.filter((step) => step.status === "completed").length;
  return (
    <div class="ra-bar" role="progressbar" aria-label="Steps done" aria-valuemin={0} aria-valuemax={props.plan.steps.length} aria-valuenow={done()}>
      <span style={{ width: `${props.plan.steps.length ? (done() / props.plan.steps.length) * 100 : 0}%` }} />
    </div>
  );
}

/**
 * A plan the harness proposed. While it's written it shows as it streams; once complete, the task's
 * Plan document and its approval request carry it, so the transcript keeps it folded.
 */
export function ProposalCard(props: { markdown: string; streaming: boolean }) {
  return (
    <Show
      when={!props.streaming}
      fallback={
        <section class="rt-card ra-proposal" data-live aria-label="Proposed plan">
          <div class="rt-input-head">
            <FileText size={14} aria-hidden="true" />
            <span class="rt-tag">Plan</span>
            <span>Writing a plan…</span>
          </div>
          <Show when={props.markdown}>
            <Markdown source={props.markdown} class="rt-md ra-proposal-md" />
          </Show>
        </section>
      }
    >
      <details class="rt-tool ra-proposal">
        <summary>
          <ChevronRight size={13} class="rt-chev" aria-hidden="true" />
          <FileText size={14} aria-hidden="true" />
          <span class="rt-tn">Plan</span>
          <span class="ra-proposal-title">
            Proposed a plan · <b>{proposalTitle(props.markdown)}</b>
          </span>
        </summary>
        <div class="rt-tbody">
          <Markdown source={props.markdown} class="rt-md ra-proposal-md" />
          <p class="cap">On a standard or planning task, the task's Plan document takes this plan, with a request to approve it.</p>
        </div>
      </details>
    </Show>
  );
}

/** MCP servers that failed to start: a warning at the top of the run, since it explains missing tools. */
export function HealthBanner(props: { failures: { server: string; reason: string | null }[] }) {
  const [open, setOpen] = createSignal(false);
  const line = (failure: { server: string; reason: string | null }): JSX.Element => (
    <>
      <b>{failure.server}</b> MCP server failed to start
      <Show when={failure.reason}>
        <span class="ra-muted">: {failure.reason}</span>
      </Show>
    </>
  );
  return (
    <div class="rm-note ra-health" role="status">
      <TriangleAlert size={15} aria-hidden="true" />
      <span>
        <button type="button" class="ra-health-btn" aria-expanded={open()} onClick={() => setOpen(!open())}>
          <span>
            <Show
              when={props.failures.length === 1}
              fallback={
                <>
                  <b>{props.failures.length} MCP servers</b> failed to start: <span class="ra-muted">{props.failures.map((failure) => failure.server).join(", ")}</span>
                </>
              }
            >
              {line(props.failures[0]!)}
            </Show>
          </span>
          <ChevronRight size={13} class="ra-health-chev" aria-hidden="true" />
        </button>
        <Show when={open()}>
          <Show when={props.failures.length > 1}>
            <For each={props.failures}>{(failure) => <span class="ra-health-line">{line(failure)}</span>}</For>
          </Show>
          <span class="ra-health-line">The agent ran without these tools. Fix the server's command or credentials, then try again.</span>
        </Show>
      </span>
    </div>
  );
}

/** A reasoning summary: one bullet per headline, with the prose under it muted; plain prose otherwise. */
export function ReasoningSections(props: { text: string; streaming?: boolean }) {
  const sections = () => reasoningSummarySections(props.text);
  return (
    <Show when={hasReasoningHeadlines(sections())} fallback={<p class="ra-prose">{props.text.trim()}</p>}>
      <ul class="ra-rs">
        <For each={sections()}>
          {(section, index) => (
            <li data-current={(props.streaming && index() === sections().length - 1) || undefined}>
              <span class="ra-rs-dot" aria-hidden="true" />
              <div>
                <Show when={section.headline}>
                  <span class="ra-rs-head">{section.headline}</span>
                </Show>
                <Show when={section.body}>
                  <Markdown source={section.body} class="ra-rs-body" />
                </Show>
              </div>
            </li>
          )}
        </For>
      </ul>
    </Show>
  );
}
