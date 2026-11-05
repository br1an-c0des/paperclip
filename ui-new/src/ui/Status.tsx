import type { IssueDisplayStatus, IssuePriority } from "@paperclipai/shared";
import { Show, type JSX, type ParentProps } from "solid-js";
import { Grain } from "./Grain";
import { gradientVar, PRIORITY_META, STATUS_META, statusLook, type Gradient, type StatusSource } from "./status-meta";
import "./Status.css";

/*
 * Status capsules, status pills, priority bars, label pills and tone pills (design-system.md,
 * "Status system"). Capsules and bars are decorative; their meaning is always in a visible label or
 * an aria-label beside them.
 */

/** Capsule sizes: `row` 6×16 at the start of a row, `pill` 7×18 in pills, `group` 8×20 in group
 * headers, `tiny` 5×12 inside tone pills. */
export type CapsuleSize = "tiny" | "row" | "pill" | "group";

/**
 * A gradient capsule. `hollow` draws only its outline, for a status that waits on a schedule
 * (Monitoring); `queued` cuts it into a stack of three, for a blocked task waiting in line behind
 * work that's going (the "in queue" look). `title` is a hover hint; the capsule stays aria-hidden.
 */
export function Capsule(props: { gradient: Gradient; size?: CapsuleSize; live?: boolean; grain?: boolean; hollow?: boolean; queued?: boolean; title?: string }) {
  return (
    <span
      class={`capsule capsule--${props.size ?? "pill"}`}
      classList={{ live: props.live, grained: props.grain, hollow: props.hollow, queued: props.queued }}
      style={{ background: gradientVar(props.gradient) }}
      title={props.title}
      aria-hidden="true"
    >
      <Show when={props.grain}>
        <Grain />
      </Show>
    </span>
  );
}

/**
 * A status's capsule. Pass what the task shows (`shownStatus`), so Monitoring draws as Monitoring,
 * and `queued` for a blocked task covered by active work (`isQueued`), which draws Ion in a stack.
 */
export function StatusCapsule(props: { status: IssueDisplayStatus; queued?: boolean; size?: CapsuleSize; live?: boolean; grain?: boolean; title?: string }) {
  const meta = () => STATUS_META[props.status] ?? STATUS_META.backlog;
  return (
    <Capsule
      gradient={props.queued ? "ion" : meta().gradient}
      hollow={!props.queued && meta().hollow}
      queued={props.queued}
      size={props.size}
      live={props.live}
      grain={props.grain}
      title={props.title}
    />
  );
}

/** A task's own capsule, through `statusLook`: Monitoring, the in-queue look, and its full label as a hint. */
export function TaskStatusCapsule(props: { task: StatusSource; size?: CapsuleSize; live?: boolean; grain?: boolean }) {
  const look = () => statusLook(props.task);
  return <StatusCapsule status={look().status} queued={look().queued} size={props.size} live={props.live} grain={props.grain} title={look().title} />;
}

/** Capsule, label and muted count on --ground (board 1's status filters, board 8's counts). */
export function StatusPill(props: { status: IssueDisplayStatus; count?: number; label?: string }) {
  return (
    <span class="status-pill">
      <StatusCapsule status={props.status} />
      {props.label ?? STATUS_META[props.status].label}
      <Show when={props.count !== undefined}>
        <small>{props.count}</small>
      </Show>
    </span>
  );
}

/** Three rising bars. High fills three, Medium two, Low one; Critical fills three in red. */
export function PriorityBars(props: { priority: IssuePriority; withLabel?: boolean }) {
  const meta = () => PRIORITY_META[props.priority];
  const bar = (index: number) => {
    if (index >= meta().bars) return "";
    return meta().critical ? "crit" : "on";
  };
  return (
    <span class="priority" title={props.withLabel ? undefined : `${meta().label} priority`}>
      <span class="pbars" aria-hidden="true">
        <i class={bar(0)} />
        <i class={bar(1)} />
        <i class={bar(2)} />
      </span>
      <Show when={props.withLabel} fallback={<span class="sr-only">{meta().label} priority</span>}>
        {meta().label}
      </Show>
    </span>
  );
}

/** Outline pill with a small colored dot. Label colors come from the API as hex. */
export function LabelPill(props: { name: string; color?: string | null }) {
  return (
    <span class="label-pill">
      <i
        aria-hidden="true"
        style={{
          background: props.color
            ? `linear-gradient(135deg, ${props.color}, color-mix(in srgb, ${props.color} 70%, #000))`
            : "var(--g-ash)",
        }}
      />
      {props.name}
    </span>
  );
}

export type Tone = "run" | "violet" | "amber" | "red" | "green" | "cyan";

/** A tinted pill with matching text: "Running", "Needs your approval", "Blocked by TRA-41". */
export function TonePill(props: ParentProps<{ tone: Tone; icon?: JSX.Element; compact?: boolean }>) {
  return (
    <span
      class="tone-pill"
      classList={{ "tone-pill--compact": props.compact }}
      style={{ background: `var(--${props.tone}-bg)`, color: `var(--${props.tone}-fg)` }}
    >
      {props.icon}
      {props.children}
    </span>
  );
}

/** The breathing Ion capsule in a --run-bg pill. */
export function RunningPill(props: { label?: string; compact?: boolean }) {
  return (
    <TonePill tone="run" compact={props.compact} icon={<Capsule gradient="ion" size="tiny" live />}>
      {props.label ?? "Running"}
    </TonePill>
  );
}
