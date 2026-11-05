import { A } from "@solidjs/router";
import { createQuery } from "@tanstack/solid-query";
import { Clock } from "lucide-solid";
import { createMemo, For, Show } from "solid-js";
import { agentsApi } from "@/api/agents";
import { queryKeys } from "@/api/queryKeys";
import { creditsLine, limitClock, usageLimit, usageRows, type UsageLimit, type UsageTone } from "@/agents/usage-limit";
import { useNow } from "@/lib/clock";
import { useCompany } from "@/lib/company";
import { Popover } from "@/ui/Popover";
import "./UsageLimit.css";

/*
 * The "Usage limit" line under a task's assignee (`tasks/properties`, since the 2026-11-05 sync,
 * upstream #19270), and the same summary on the agent's Runtime section: the fullest current window
 * and when it resets, or "Limited until …", with a popover listing every window. The model is in
 * agents/usage-limit.ts. The read is the agent's runtime state, under the key the live event
 * `agent.runtime_state.updated` refreshes; a 403 (no agent access) just hides the line.
 */

/** The agent's runtime state, shared with its Runtime section (RunnerStateCard). */
export function useUsageLimit(agentId: () => string | null | undefined) {
  const company = useCompany();
  const state = createQuery(() => ({
    queryKey: queryKeys.agents.part(agentId() ?? "", "runtime-state"),
    queryFn: ({ signal }) => agentsApi.runtimeState(agentId()!, company().id, signal),
    enabled: !!agentId(),
    retry: false,
  }));
  // Windows roll over on the clock, so the summary is worked out again each minute.
  const now = useNow(() => !!state.data);
  const minute = createMemo(() => Math.floor(now() / 60_000) * 60_000);
  return createMemo(() => (agentId() && state.data ? usageLimit(state.data.stateJson, minute()) : null));
}

function Bar(props: { percent: number; tone: UsageTone; wide?: boolean }) {
  return (
    <span class="ul-bar" classList={{ "ul-bar--wide": props.wide }} data-tone={props.tone} aria-hidden="true">
      <span style={{ width: `${Math.min(100, Math.max(0, props.percent))}%` }} />
    </span>
  );
}

/** Every current window, the credits, and when it was reported. `href` links to the agent. */
export function UsageLimitDetail(props: { limit: UsageLimit; href?: string }) {
  const now = Date.now();
  return (
    <div class="ul-detail">
      <For each={usageRows(props.limit, now)}>
        {(row) => (
          <div class="ul-window">
            <div class="ul-window-top">
              <span class="ul-window-label">{row.label}</span>
              <span class="ul-window-value" data-tone={row.tone}>
                {row.percent}%<Show when={row.resets}>{(at) => <span class="ul-muted"> · resets {at()}</span>}</Show>
              </span>
            </div>
            <Bar percent={row.percent} tone={row.tone} wide />
          </div>
        )}
      </For>
      <Show when={props.limit.summary.usingCredits}>
        <p class="ul-note" data-tone="warn">
          Limit reached; work goes on with the account's credits.
        </p>
      </Show>
      <Show when={creditsLine(props.limit.snapshot)}>{(line) => <p class="ul-muted">{line()}</p>}</Show>
      <div class="ul-foot">
        <span>Reported {limitClock(props.limit.snapshot.observedAt, now)}</span>
        <Show when={props.href}>{(href) => <A href={href()}>View agent</A>}</Show>
      </div>
    </div>
  );
}

/** The one-line value with its popover. Nothing when the agent has no current limit to show. */
export function UsageLimitValue(props: { limit: UsageLimit; href?: string }) {
  const tone = () => props.limit.summary.tone;
  return (
    <Popover>
      <Popover.Trigger class="ul-trigger" data-tone={tone()} aria-label={`Provider usage limit: ${props.limit.label}. Show every window`}>
        <Show when={props.limit.summary.limited} fallback={<Bar percent={props.limit.summary.window?.usedPercent ?? 0} tone={tone()} />}>
          <Clock size={14} aria-hidden="true" />
        </Show>
        <span class="ul-label">{props.limit.label}</span>
      </Popover.Trigger>
      <Popover.Content title={`${props.limit.provider} usage limits`} width={300}>
        <UsageLimitDetail limit={props.limit} href={props.href} />
      </Popover.Content>
    </Popover>
  );
}
