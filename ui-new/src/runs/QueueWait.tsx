import type { ExecutionAgentQueue } from "@paperclipai/shared";
import { A } from "@solidjs/router";
import { Hourglass } from "lucide-solid";
import { createEffect, createSignal, onCleanup, Show } from "solid-js";
import { useAgentsQuery } from "@/lib/company-data";
import { useCompany } from "@/lib/company";
import { Capsule, TonePill } from "@/ui/Status";
import { agentQueueParts, queueWait, startGraceEndsAt, type QueueRun, type QueueWait, type TaskWaiting } from "./queue-wait";
import "./QueueWait.css";

/*
 * How a waiting run reads (U151, queue-wait.ts): the agent's line with Configure, and the quiet
 * "Waiting" pill task rows show in place of the running pill. Neither has a spinner or a running
 * time: nothing is working yet.
 */

/** Where the agent's "Runs at once" is set: its runtime settings. */
export function agentRuntimeHref(prefix: string, agent: { urlKey?: string | null; id: string }) {
  return `/${prefix}/agents/${agent.urlKey ?? agent.id}/settings/runtime`;
}

/** "Waiting for Codie · 20 slots max · 41 of 295 in line · Configure". */
export function AgentQueueLine(props: { queue: ExecutionAgentQueue; configure?: boolean; class?: string }) {
  const company = useCompany();
  const agents = useAgentsQuery();
  const parts = () => agentQueueParts(props.queue);
  const href = () => {
    const agent = (agents.data ?? []).find((entry) => entry.id === props.queue.agentId);
    return agentRuntimeHref(company().issuePrefix, agent ?? { id: props.queue.agentId });
  };
  return (
    <span class={`qw-line${props.class ? ` ${props.class}` : ""}`} data-testid="agent-queue-wait">
      <Hourglass size={13} class="qw-icon" aria-hidden="true" />
      <span class="qw-lead">{parts()[0]}</span>
      <span aria-hidden="true">·</span>
      <span>{parts()[1]}</span>
      <span aria-hidden="true">·</span>
      <span>{parts()[2]}</span>
      <Show when={props.configure !== false}>
        <span aria-hidden="true">·</span>
        <A class="qw-configure" href={href()} aria-label={`Configure ${props.queue.agentName}'s runs at once`}>
          Configure
        </A>
      </Show>
    </span>
  );
}

/** A named hold or "Waiting to start": an hourglass and the server's words. */
export function WaitLine(props: { wait: QueueWait; class?: string; configure?: boolean }) {
  return (
    <Show
      when={props.wait.kind === "agent" && props.wait}
      fallback={
        <span class={`qw-line${props.class ? ` ${props.class}` : ""}`}>
          <Hourglass size={13} class="qw-icon" aria-hidden="true" />
          <span class="qw-lead">{props.wait.label}</span>
        </span>
      }
    >
      {(agent) => <AgentQueueLine queue={(agent() as Extract<QueueWait, { kind: "agent" }>).queue} configure={props.configure} class={props.class} />}
    </Show>
  );
}

/** A task row's "Waiting", in place of the running pill; the whole sentence is its tooltip. */
export function WaitingPill(props: { waiting: TaskWaiting; label?: string }) {
  return (
    <span class="qw-pill" title={props.waiting.label} aria-label={props.waiting.label} data-testid="task-waiting">
      <TonePill tone="run" compact icon={<Capsule gradient="ion" size="tiny" queued />}>
        {props.label ?? "Waiting"}
      </TonePill>
    </span>
  );
}

/**
 * What a live run waits for, now: the agent's line, a named hold, or "Waiting to start" once its
 * 30-second startup grace has passed. One timer at the end of the grace; no per-second ticking.
 */
export function createQueueWait(run: () => QueueRun | null | undefined): () => QueueWait | null {
  const [tick, setTick] = createSignal(0);
  createEffect(() => {
    const current = run();
    const ends = current ? startGraceEndsAt(current) : null;
    if (ends === null) return;
    const delay = ends - Date.now();
    if (delay <= 0) return;
    const timer = window.setTimeout(() => setTick((value) => value + 1), delay + 50);
    onCleanup(() => window.clearTimeout(timer));
  });
  return () => {
    tick();
    return queueWait(run(), Date.now());
  };
}
