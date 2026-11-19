import { z } from "zod";

/**
 * How a task-bound run ended its work: `paperclip_finish`, `paperclip_block`,
 * `paperclip_report_progress` with `continue: true`, or the task reaching done, in review or
 * blocked by any route. Stored on the run as `result_json.paperclipDisposition`.
 */
export const RUN_DISPOSITION_KINDS = ["finished", "blocked", "continuing", "task_state"] as const;
export type RunDispositionKind = (typeof RUN_DISPOSITION_KINDS)[number];

export interface RunDisposition {
  kind: RunDispositionKind;
  /** ISO timestamp. */
  at: string;
  via: "tool" | "task_status";
  /** The tool that recorded it, when `via` is `"tool"`. */
  tool?: string;
  taskStatus?: string;
  summary?: string;
  blockedOwner?: string;
  unblockAction?: string;
}

export const runDispositionSchema = z.object({
  kind: z.enum(RUN_DISPOSITION_KINDS),
  at: z.string().min(1),
  via: z.enum(["tool", "task_status"]),
  tool: z.string().optional(),
  taskStatus: z.string().optional(),
  summary: z.string().optional(),
  blockedOwner: z.string().optional(),
  unblockAction: z.string().optional(),
}) satisfies z.ZodType<RunDisposition>;
