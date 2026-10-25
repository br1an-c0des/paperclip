import type { IssuePriority, IssueStatus } from "@paperclipai/shared";
import { Show, type JSX, type ParentProps } from "solid-js";
import { Grain } from "./Grain";
import { gradientVar, PRIORITY_META, STATUS_META, type Gradient } from "./status-meta";
import "./Status.css";

/*
 * Status capsules, status pills, priority bars, label pills and tone pills (design-system.md,
 * "Status system"). Capsules and bars are decorative; their meaning is always in a visible label or
 * an aria-label beside them.
 */

/** Capsule sizes: `row` 6×16 at the start of a row, `pill` 7×18 in pills, `group` 8×20 in group
 * headers, `tiny` 5×12 inside tone pills. */
export type CapsuleSize = "tiny" | "row" | "pill" | "group";

export function Capsule(props: { gradient: Gradient; size?: CapsuleSize; live?: boolean; grain?: boolean }) {
  return (
    <span
      class={`capsule capsule--${props.size ?? "pill"}`}
      classList={{ live: props.live, grained: props.grain }}
      style={{ background: gradientVar(props.gradient) }}
      aria-hidden="true"
    >
      <Show when={props.grain}>
        <Grain />
      </Show>
    </span>
  );
}

export function StatusCapsule(props: { status: IssueStatus; size?: CapsuleSize; live?: boolean }) {
  return <Capsule gradient={STATUS_META[props.status].gradient} size={props.size} live={props.live} />;
}

/** Capsule, label and muted count on --ground (board 1's status filters, board 8's counts). */
export function StatusPill(props: { status: IssueStatus; count?: number; label?: string }) {
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
