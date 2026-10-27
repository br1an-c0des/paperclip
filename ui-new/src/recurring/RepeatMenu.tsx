import type { RoutineConcurrencyPolicy } from "@paperclipai/shared";
import { CalendarClock, Info, Webhook } from "lucide-solid";
import { createMemo, For, Show } from "solid-js";
import { Button } from "@/ui/Button";
import { TextInput } from "@/ui/Field";
import { Segmented } from "@/ui/Segmented";
import { Switch } from "@/ui/Switch";
import { Tooltip } from "@/ui/Tooltip";
import {
  cronProblem,
  DAY_NAMES,
  DAY_SHORT,
  FREQUENCIES,
  nextFires,
  nextRunsText,
  OPEN_POLICIES,
  scheduleCron,
  timeZoneLabel,
  timeZoneOptions,
  WEEK_ORDER,
  type RepeatDraft,
  type RepeatFrequency,
  type WebhookSender,
} from "./schedule";
import "./RepeatMenu.css";

/*
 * The Repeat menu (board N4): on a schedule (daily, weekdays, weekly on picked days, monthly on a
 * day, or a custom cron, at a time in a time zone, with the next three runs), when a webhook
 * arrives (from an app or script, or from GitHub), and what to do if the last one is still open.
 * "Don't repeat" turns it off; Done closes it.
 *
 * The schedule fields are their own component, so the recurring task's panel edits a schedule
 * trigger with the same controls (board R2).
 */

export const HOOK_TIP = "You get its URL and secret after you create the task. Fields in the JSON it sends fill the placeholders with the same name.";

type ScheduleValue = Pick<RepeatDraft, "frequency" | "time" | "days" | "monthDay" | "cron" | "timezone">;

export function ScheduleFields(props: { value: ScheduleValue; onChange: (patch: Partial<ScheduleValue>) => void; idPrefix: string }) {
  const cron = () => scheduleCron(props.value);
  const fires = createMemo(() => nextFires(cron(), 3, { timeZone: props.value.timezone }));
  const problem = () => (props.value.frequency === "weekly" && props.value.days.length === 0 ? "Pick at least one day" : cronProblem(cron()));
  return (
    <div class="rp-schedule">
      <Segmented label="How often" options={FREQUENCIES} value={props.value.frequency} onChange={(frequency: RepeatFrequency) => props.onChange({ frequency })} />
      <Show when={props.value.frequency === "weekly"}>
        <div class="rp-days" role="group" aria-label="Days of the week">
          <For each={WEEK_ORDER}>
            {(day) => {
              const on = () => props.value.days.includes(day);
              return (
                <button
                  type="button"
                  class="rp-day"
                  aria-pressed={on()}
                  aria-label={DAY_NAMES[day]}
                  onClick={() => props.onChange({ days: on() ? props.value.days.filter((each) => each !== day) : [...props.value.days, day] })}
                >
                  {DAY_SHORT[day]!.slice(0, 2)}
                </button>
              );
            }}
          </For>
        </div>
      </Show>
      <Show when={props.value.frequency === "monthly"}>
        <div class="rp-row">
          <label class="rp-label" for={`${props.idPrefix}-mday`}>
            On day
          </label>
          <TextInput
            id={`${props.idPrefix}-mday`}
            class="rp-mday"
            type="number"
            min="1"
            max="31"
            value={props.value.monthDay}
            onInput={(event) => {
              const day = Number(event.currentTarget.value);
              if (Number.isFinite(day) && day >= 1 && day <= 31) props.onChange({ monthDay: Math.round(day) });
            }}
          />
        </div>
      </Show>
      <Show when={props.value.frequency === "custom"}>
        <div class="rp-row">
          <label class="rp-label" for={`${props.idPrefix}-cron`}>
            Cron
          </label>
          <TextInput
            id={`${props.idPrefix}-cron`}
            class="mono rp-cron"
            value={props.value.cron}
            invalid={Boolean(cronProblem(props.value.cron))}
            spellcheck={false}
            onInput={(event) => props.onChange({ cron: event.currentTarget.value })}
          />
        </div>
      </Show>
      <div class="rp-row">
        <Show when={props.value.frequency !== "custom"}>
          <label class="rp-label" for={`${props.idPrefix}-time`}>
            At
          </label>
          <TextInput
            id={`${props.idPrefix}-time`}
            class="rp-time"
            type="time"
            value={props.value.time}
            onInput={(event) => event.currentTarget.value && props.onChange({ time: event.currentTarget.value })}
          />
        </Show>
        <Show when={props.value.frequency === "custom"}>
          <span class="rp-label">In</span>
        </Show>
        <select
          class="input rp-zone"
          aria-label={`Time zone: ${timeZoneLabel(props.value.timezone)}`}
          value={props.value.timezone}
          onChange={(event) => props.onChange({ timezone: event.currentTarget.value })}
        >
          <For each={timeZoneOptions(props.value.timezone)}>{(zone) => <option value={zone}>{zone === props.value.timezone ? timeZoneLabel(zone) : zone}</option>}</For>
        </select>
      </div>
      <div class="rp-next" aria-live="polite">
        <span class="rp-label">Next</span>
        <Show when={!problem()} fallback={<span class="rp-problem">{problem()}</span>}>
          <span>{nextRunsText(fires(), props.value.timezone)}</span>
        </Show>
      </div>
    </div>
  );
}

export function RepeatMenu(props: {
  value: RepeatDraft;
  onChange: (patch: Partial<RepeatDraft>) => void;
  onStop: () => void;
  onDone: () => void;
}) {
  return (
    <div class="rp">
      <section class="rp-section" aria-label="On a schedule">
        <div class="rp-switch">
          <CalendarClock size={16} aria-hidden="true" class="rp-icon" />
          <Switch label="On a schedule" checked={props.value.schedule} onChange={(schedule) => props.onChange({ schedule })} />
        </div>
        <Show when={props.value.schedule}>
          <ScheduleFields value={props.value} onChange={props.onChange} idPrefix="nt-repeat" />
        </Show>
      </section>
      <section class="rp-section" aria-label="When a webhook arrives">
        <div class="rp-switch">
          <Webhook size={16} aria-hidden="true" class="rp-icon" />
          <Switch label="When a webhook arrives" checked={props.value.webhook} onChange={(webhook) => props.onChange({ webhook })} />
          <InfoTip text={HOOK_TIP} />
        </div>
        <Show when={props.value.webhook}>
          <div class="rp-row">
            <span class="rp-label">Sent by</span>
            <Segmented
              label="Sent by"
              options={[
                { value: "app", label: "An app or script" },
                { value: "github", label: "GitHub" },
              ]}
              value={props.value.sender}
              onChange={(sender: WebhookSender) => props.onChange({ sender })}
            />
          </div>
        </Show>
      </section>
      <div class="rp-section" role="radiogroup" aria-labelledby="rp-policy-label">
        <div id="rp-policy-label" class="rp-heading">
          If the last one is still open
        </div>
        <For each={OPEN_POLICIES}>
          {(option) => (
            <button
              type="button"
              class="rp-radio"
              role="radio"
              aria-checked={props.value.policy === option.value}
              onClick={() => props.onChange({ policy: option.value as RoutineConcurrencyPolicy })}
            >
              <span class="rp-radio-dot" aria-hidden="true" />
              <span>{option.label}</span>
            </button>
          )}
        </For>
      </div>
      <div class="rp-foot">
        <Button ghost size="compact" variant="quiet" onClick={() => props.onStop()}>
          Don't repeat
        </Button>
        <Button size="compact" variant="primary" onClick={() => props.onDone()}>
          Done
        </Button>
      </div>
    </div>
  );
}

/** A small (i) whose tooltip explains the control beside it. */
export function InfoTip(props: { text: string; label?: string }) {
  return (
    <Tooltip content={props.text}>
      {(trigger) => (
        <button {...trigger} type="button" class="rp-info" aria-label={props.label ?? props.text}>
          <Info size={14} aria-hidden="true" />
        </button>
      )}
    </Tooltip>
  );
}
