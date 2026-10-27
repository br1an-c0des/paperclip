import type { RoutineConcurrencyPolicy } from "@paperclipai/shared";

/*
 * Schedules for recurring tasks (boards N4 and R2): the Repeat menu's draft, the 5-field cron it
 * becomes, the plain words for a cron ("Weekdays at 09:00"), and the next few times it fires.
 *
 * The cron grammar and the time-zone walk follow ui/src/lib/cron-fires.ts, which mirrors the
 * server's `nextCronTickInTimeZone`; the server's `nextRunAt` stays the authority, and this is only
 * the preview. A schedule is minute, hour, day of month, month and day of week (Sun = 0), read in
 * the trigger's time zone.
 */

export type RepeatFrequency = "daily" | "weekdays" | "weekly" | "monthly" | "custom";
export type WebhookSender = "app" | "github";

export type RepeatDraft = {
  /** On a schedule. */
  schedule: boolean;
  frequency: RepeatFrequency;
  /** "HH:MM", 24-hour, in `timezone`. */
  time: string;
  /** Weekly: the days it runs, Sun = 0. */
  days: number[];
  /** Monthly: the day of the month, 1–31. */
  monthDay: number;
  /** Custom: a 5-field cron expression. */
  cron: string;
  /** An IANA time zone, such as "America/Chicago". */
  timezone: string;
  /** When a webhook arrives. */
  webhook: boolean;
  sender: WebhookSender;
  /** If the last one is still open. */
  policy: RoutineConcurrencyPolicy;
  /**
   * Defaults for the text's `{{placeholders}}`, by name. A schedule needs one for each, since no
   * one is there to fill them in (the server refuses the trigger otherwise).
   */
  defaults: Record<string, string>;
};

export const FREQUENCIES: { value: RepeatFrequency; label: string }[] = [
  { value: "daily", label: "Daily" },
  { value: "weekdays", label: "Weekdays" },
  { value: "weekly", label: "Weekly" },
  { value: "monthly", label: "Monthly" },
  { value: "custom", label: "Custom" },
];

/** The concurrency policies, in the boards' words. */
export const OPEN_POLICIES: { value: RoutineConcurrencyPolicy; label: string; description: string }[] = [
  { value: "coalesce_if_active", label: "Add it to the open one", description: "The new run joins the task that's still open" },
  { value: "skip_if_active", label: "Skip it", description: "No new task while the last one is open" },
  { value: "always_enqueue", label: "Create another anyway", description: "A new task every time" },
];

export const DAY_SHORT = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
export const DAY_NAMES = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];
/** Monday first, as the board's day picker. */
export const WEEK_ORDER = [1, 2, 3, 4, 5, 6, 0];

/** The viewer's time zone, or UTC where the browser won't say. */
export function localTimeZone(): string {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC";
  } catch {
    return "UTC";
  }
}

export function defaultRepeat(timezone = localTimeZone()): RepeatDraft {
  return {
    schedule: true,
    frequency: "weekdays",
    time: "09:00",
    days: [1],
    monthDay: 1,
    cron: "0 9 * * 1-5",
    timezone,
    webhook: false,
    sender: "app",
    policy: "coalesce_if_active",
    defaults: {},
  };
}

/** A recurring task needs a schedule, a webhook, or both; with neither it's a plain task. */
export function isRepeating(repeat: RepeatDraft | null | undefined): repeat is RepeatDraft {
  return Boolean(repeat && (repeat.schedule || repeat.webhook));
}

function parseTime(time: string): { hour: number; minute: number } | null {
  const match = /^(\d{1,2}):(\d{2})$/.exec(time.trim());
  if (!match) return null;
  const hour = Number(match[1]);
  const minute = Number(match[2]);
  return hour <= 23 && minute <= 59 ? { hour, minute } : null;
}

/** The cron for the draft's schedule, or "" when it can't make one yet (no days picked, a bad time). */
export function scheduleCron(repeat: Pick<RepeatDraft, "frequency" | "time" | "days" | "monthDay" | "cron">): string {
  if (repeat.frequency === "custom") return repeat.cron.trim().replace(/\s+/g, " ");
  const time = parseTime(repeat.time);
  if (!time) return "";
  const at = `${time.minute} ${time.hour}`;
  switch (repeat.frequency) {
    case "daily":
      return `${at} * * *`;
    case "weekdays":
      return `${at} * * 1-5`;
    case "weekly": {
      const days = [...new Set(repeat.days)].filter((day) => day >= 0 && day <= 6).sort((a, b) => a - b);
      return days.length > 0 ? `${at} * * ${days.join(",")}` : "";
    }
    case "monthly": {
      const day = Math.min(Math.max(Math.round(repeat.monthDay), 1), 31);
      return `${at} ${day} * *`;
    }
  }
}

/** Why the draft's schedule can't be saved yet, or null. */
export function repeatProblem(repeat: RepeatDraft): string | null {
  if (!repeat.schedule) return null;
  if (repeat.frequency === "weekly" && repeat.days.length === 0) return "Pick at least one day for the schedule.";
  if (repeat.frequency !== "custom" && !parseTime(repeat.time)) return "Pick a time for the schedule.";
  return cronProblem(scheduleCron(repeat));
}

// ---------------------------------------------------------------------------------------------
// Cron parsing, after ui/src/lib/cron-fires.ts.

type ParsedCron = {
  minutes: number[];
  hours: number[];
  daysOfMonth: number[];
  months: number[];
  daysOfWeek: number[];
  daysOfMonthAll: boolean;
  daysOfWeekAll: boolean;
};

const FIELDS = [
  { min: 0, max: 59 },
  { min: 0, max: 23 },
  { min: 1, max: 31 },
  { min: 1, max: 12 },
  { min: 0, max: 6 },
] as const;

function parseField(token: string, spec: { min: number; max: number }): number[] {
  const values = new Set<number>();
  const int = (text: string) => {
    if (!/^\d+$/.test(text)) throw new Error("not a number");
    const value = Number(text);
    if (value < spec.min || value > spec.max) throw new Error("out of range");
    return value;
  };
  for (const part of token.split(",")) {
    if (part === "") throw new Error("empty");
    const [base = "", stepText] = part.split("/");
    const step = stepText === undefined ? 1 : Number(stepText);
    if (stepText !== undefined && (!/^\d+$/.test(stepText) || step <= 0)) throw new Error("bad step");
    let start: number;
    let end: number;
    if (base === "*" || base === "?") {
      start = spec.min;
      end = spec.max;
    } else if (base.includes("-")) {
      const [a = "", b = ""] = base.split("-");
      start = int(a);
      end = int(b);
      if (start > end) throw new Error("backwards range");
    } else {
      start = int(base);
      end = stepText === undefined ? start : spec.max;
    }
    for (let value = start; value <= end; value += step) values.add(value);
  }
  return [...values].sort((a, b) => a - b);
}

export function parseCron(expression: string | null | undefined): ParsedCron | null {
  const tokens = (expression ?? "").trim().split(/\s+/);
  if (tokens.length !== 5) return null;
  try {
    const [minutes, hours, daysOfMonth, months, daysOfWeek] = tokens.map((token, index) => parseField(token, FIELDS[index]!)) as [
      number[],
      number[],
      number[],
      number[],
      number[],
    ];
    return {
      minutes,
      hours,
      daysOfMonth,
      months,
      daysOfWeek,
      daysOfMonthAll: daysOfMonth.length === 31,
      daysOfWeekAll: daysOfWeek.length === 7,
    };
  } catch {
    return null;
  }
}

/** Why a cron expression won't do, in words, or null. */
export function cronProblem(expression: string): string | null {
  const trimmed = expression.trim();
  if (!trimmed) return "Enter a cron schedule, such as 0 9 * * 1-5.";
  const count = trimmed.split(/\s+/).length;
  if (count !== 5) return `A cron schedule has 5 fields (minute, hour, day, month, weekday); this has ${count}.`;
  if (!parseCron(trimmed)) return "Each cron field takes numbers, ranges (1-5), lists (1,3), steps (*/15) or *.";
  return null;
}

// ---------------------------------------------------------------------------------------------
// Next fires.

type Zoned = { month: number; day: number; hour: number; minute: number; weekday: number };

const zonedFormatters = new Map<string, Intl.DateTimeFormat>();

function zoned(date: Date, timeZone: string): Zoned {
  let formatter = zonedFormatters.get(timeZone);
  if (!formatter) {
    formatter = new Intl.DateTimeFormat("en-US", {
      timeZone,
      month: "numeric",
      day: "numeric",
      hour: "numeric",
      minute: "numeric",
      weekday: "short",
      hourCycle: "h23",
    });
    zonedFormatters.set(timeZone, formatter);
  }
  const parts: Record<string, string> = {};
  for (const part of formatter.formatToParts(date)) parts[part.type] = part.value;
  return {
    month: Number(parts.month),
    day: Number(parts.day),
    hour: Number(parts.hour) % 24,
    minute: Number(parts.minute),
    weekday: DAY_SHORT.indexOf(parts.weekday ?? ""),
  };
}

function dayMatches(cron: ParsedCron, at: Zoned) {
  if (!cron.months.includes(at.month)) return false;
  const byDate = cron.daysOfMonth.includes(at.day);
  const byWeekday = cron.daysOfWeek.includes(at.weekday);
  // Cron's rule: when both day fields are restricted, either may match.
  return !cron.daysOfMonthAll && !cron.daysOfWeekAll ? byDate || byWeekday : byDate && byWeekday;
}

/**
 * Up to `count` times the schedule fires after `after`, in `timeZone`. It walks forward a day, an
 * hour or a minute at a time, whichever the cron rules out, so a sparse schedule stays quick.
 */
export function nextFires(expression: string | null | undefined, count: number, options: { after?: Date; timeZone?: string } = {}): Date[] {
  const cron = parseCron(expression);
  if (!cron || count <= 0) return [];
  const timeZone = options.timeZone || "UTC";
  const cursor = new Date(options.after ?? new Date());
  cursor.setUTCSeconds(0, 0);
  cursor.setUTCMinutes(cursor.getUTCMinutes() + 1);
  const fires: Date[] = [];
  for (let step = 0; step < 100_000 && fires.length < count; step++) {
    let at: Zoned;
    try {
      at = zoned(cursor, timeZone);
    } catch {
      return fires;
    }
    let skip = 1;
    if (!dayMatches(cron, at)) skip = (23 - at.hour) * 60 + (60 - at.minute);
    else if (!cron.hours.includes(at.hour)) skip = 60 - at.minute;
    else if (cron.minutes.includes(at.minute)) fires.push(new Date(cursor));
    cursor.setUTCMinutes(cursor.getUTCMinutes() + skip);
  }
  return fires;
}

// ---------------------------------------------------------------------------------------------
// Words.

const pad = (value: number) => String(value).padStart(2, "0");

function ordinal(value: number) {
  const tens = value % 100;
  if (tens >= 11 && tens <= 13) return `${value}th`;
  return `${value}${["th", "st", "nd", "rd"][value % 10] ?? "th"}`;
}

/**
 * A cron in plain words, as the boards write them: "Weekdays at 09:00", "Every 15 minutes",
 * "Mondays at 08:00", "Every Mon, Thu at 09:00", "Monthly on the 1st at 10:00". Anything else is
 * "Custom: <cron>".
 */
export function describeCron(expression: string | null | undefined): string {
  const trimmed = (expression ?? "").trim().replace(/\s+/g, " ");
  if (!trimmed) return "No schedule";
  const fields = trimmed.split(" ");
  if (fields.length !== 5 || !parseCron(trimmed)) return `Custom: ${trimmed}`;
  const [minute = "", hour = "", dom = "", month = "", dow = ""] = fields;
  const number = /^\d+$/;
  const anyDay = dom === "*" && month === "*" && (dow === "*" || dow === "?");
  if (minute === "*" && hour === "*" && anyDay) return "Every minute";
  const everyMinutes = /^\*\/(\d+)$/.exec(minute);
  if (everyMinutes && hour === "*" && anyDay) return `Every ${everyMinutes[1]} minutes`;
  if (number.test(minute) && hour === "*" && anyDay) return `Every hour at :${pad(Number(minute))}`;
  const everyHours = /^\*\/(\d+)$/.exec(hour);
  if (number.test(minute) && everyHours && anyDay) return `Every ${everyHours[1]} hours at :${pad(Number(minute))}`;
  if (!number.test(minute) || !number.test(hour) || month !== "*") return `Custom: ${trimmed}`;
  const time = `${pad(Number(hour))}:${pad(Number(minute))}`;
  if (anyDay) return `Every day at ${time}`;
  if (dom === "*") {
    if (dow === "1-5") return `Weekdays at ${time}`;
    if (dow === "0,6" || dow === "6,0") return `Weekends at ${time}`;
    if (/^\d(,\d)*$/.test(dow)) {
      const days = [...new Set(dow.split(",").map(Number))].filter((day) => day <= 6);
      days.sort((a, b) => WEEK_ORDER.indexOf(a) - WEEK_ORDER.indexOf(b));
      if (days.length === 1) return `${DAY_NAMES[days[0]!]}s at ${time}`;
      return `Every ${days.map((day) => DAY_SHORT[day]).join(", ")} at ${time}`;
    }
  }
  if (number.test(dom) && (dow === "*" || dow === "?")) return `Monthly on the ${ordinal(Number(dom))} at ${time}`;
  return `Custom: ${trimmed}`;
}

/** The Repeat menu's schedule fields for a cron, so a saved schedule opens on the right choice. */
export function repeatFromCron(expression: string, timezone: string): RepeatDraft {
  const base = { ...defaultRepeat(timezone), cron: expression };
  const fields = expression.trim().split(/\s+/);
  const [minute = "", hour = "", dom = "", month = "", dow = ""] = fields;
  const number = /^\d+$/;
  if (fields.length !== 5 || !number.test(minute) || !number.test(hour) || month !== "*" || Number(hour) > 23 || Number(minute) > 59) {
    return { ...base, frequency: "custom" };
  }
  const time = `${pad(Number(hour))}:${pad(Number(minute))}`;
  if (dom === "*" && dow === "*") return { ...base, frequency: "daily", time };
  if (dom === "*" && dow === "1-5") return { ...base, frequency: "weekdays", time };
  if (dom === "*" && /^[0-6](,[0-6])*$/.test(dow)) return { ...base, frequency: "weekly", time, days: [...new Set(dow.split(",").map(Number))] };
  if (number.test(dom) && Number(dom) >= 1 && Number(dom) <= 31 && dow === "*") return { ...base, frequency: "monthly", time, monthDay: Number(dom) };
  return { ...base, frequency: "custom" };
}

const fireFormatters = new Map<string, Intl.DateTimeFormat>();

function fireParts(date: Date, timeZone: string) {
  let formatter = fireFormatters.get(timeZone);
  if (!formatter) {
    formatter = new Intl.DateTimeFormat("en-US", {
      timeZone,
      weekday: "short",
      month: "short",
      day: "numeric",
      hour: "2-digit",
      minute: "2-digit",
      hourCycle: "h23",
    });
    fireFormatters.set(timeZone, formatter);
  }
  const parts: Record<string, string> = {};
  for (const part of formatter.formatToParts(date)) parts[part.type] = part.value;
  return { day: `${parts.weekday} ${parts.month} ${parts.day}`, time: `${pad(Number(parts.hour) % 24)}:${parts.minute}` };
}

/** "Mon Oct 26, 09:00", in the schedule's time zone. */
export function formatFire(date: Date | string, timeZone = localTimeZone()): string {
  const parts = fireParts(new Date(date), timeZone);
  return `${parts.day}, ${parts.time}`;
}

/** The Repeat menu's "Next" line: "Mon Oct 26 at 09:00, then Tue Oct 27 and Wed Oct 28". */
export function nextRunsText(fires: readonly Date[], timeZone: string): string {
  if (fires.length === 0) return "No upcoming runs";
  const [first, ...rest] = fires.map((fire) => fireParts(fire, timeZone));
  const head = `${first!.day} at ${first!.time}`;
  if (rest.length === 0) return head;
  // Later fires on the same day as the one before name the time; on another day, the day, and its
  // time too unless every fire is at the same time.
  const sameTime = rest.every((part) => part.time === first!.time);
  const names = rest.map((part, index) =>
    part.day === (index === 0 ? first! : rest[index - 1]!).day ? part.time : sameTime ? part.day : `${part.day} ${part.time}`,
  );
  return `${head}, then ${names.length === 1 ? names[0] : `${names.slice(0, -1).join(", ")} and ${names.at(-1)}`}`;
}

/** "Chicago (CDT)": the zone's city and its short name now. */
export function timeZoneLabel(timeZone: string, at: Date = new Date()): string {
  const city = (timeZone.split("/").at(-1) ?? timeZone).replace(/_/g, " ");
  try {
    const short = new Intl.DateTimeFormat("en-US", { timeZone, timeZoneName: "short" })
      .formatToParts(at)
      .find((part) => part.type === "timeZoneName")?.value;
    return short && short !== city ? `${city} (${short})` : city;
  } catch {
    return city;
  }
}

/** The time zones the browser knows, the viewer's first; a short list where it can't say. */
export function timeZoneOptions(current: string): string[] {
  let zones: string[] = [];
  try {
    zones = (Intl as unknown as { supportedValuesOf?: (key: string) => string[] }).supportedValuesOf?.("timeZone") ?? [];
  } catch {
    zones = [];
  }
  if (zones.length === 0) zones = ["UTC", "America/New_York", "America/Chicago", "America/Denver", "America/Los_Angeles", "Europe/London", "Europe/Berlin", "Asia/Tokyo"];
  const local = localTimeZone();
  return [...new Set([current, local, "UTC", ...zones])];
}

/** The Repeat pill: "Weekdays at 09:00", "Weekdays at 09:00 + webhook", or "When a webhook arrives". */
export function repeatLabel(repeat: RepeatDraft): string {
  const hook = repeat.sender === "github" ? "GitHub webhook" : "webhook";
  const schedule = describeCron(scheduleCron(repeat));
  if (repeat.schedule && repeat.webhook) return `${schedule} + ${hook}`;
  if (repeat.schedule) return schedule;
  if (repeat.webhook) return `When a ${hook} arrives`;
  return "Repeat";
}
