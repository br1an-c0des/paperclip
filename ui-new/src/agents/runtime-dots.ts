import { savedText, type Changed } from "@/ui/changed";
import { intervalLabel, type RuntimeDraft } from "./agent-model";

/*
 * What Model and runtime's unsaved-change dots say (ui/ChangedDot.tsx) for the rows whose saved
 * value needs more than a label: a switch with settings under it, a number with its unit, text.
 * Each takes the saved draft (`base`) and is only asked when the row has a counted change
 * (runtime-form.ts `changed`).
 */

const lower = (text: string) => text.charAt(0).toLowerCase() + text.slice(1);

export const onOff = (value: boolean) => (value ? "on" : "off");

/** "On a heartbeat" with its interval: "on, every 5 minutes", "off", or the interval alone when only it changed. */
export function heartbeatFrom(base: RuntimeDraft, draft: RuntimeDraft): Changed {
  const interval = lower(intervalLabel(Number(base.intervalSec) || 0));
  if (base.heartbeatEnabled === draft.heartbeatEnabled) return { from: interval };
  return { from: base.heartbeatEnabled ? `on, ${interval}` : "off" };
}

/** "Continue after a turn limit" with its follow-ups: "on, up to 2 more runs, 1 second apart", or "off". */
export function continueFrom(base: RuntimeDraft): Changed {
  if (!base.continueEnabled) return { from: "off" };
  const runs = base.continueAttempts === "1" ? "1 more run" : `${base.continueAttempts} more runs`;
  const gap = base.continueDelaySec === "1" ? "1 second" : `${base.continueDelaySec} seconds`;
  return { from: `on, up to ${runs}, ${gap} apart` };
}

/** A number with its unit: "20 runs", "0 minutes". */
export function amountFrom(value: string, unit: (value: string) => string): Changed {
  return { from: value.trim() ? `${savedText(value)} ${unit(value)}` : "empty" };
}

/** Text such as a command or prompt template, cut to one short line; `empty` names the blank value. */
export function textFrom(value: string, empty: string): Changed {
  return { from: savedText(value, empty) };
}
