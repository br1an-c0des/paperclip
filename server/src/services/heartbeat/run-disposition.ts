import { and, eq, sql } from "drizzle-orm";
import { heartbeatRuns, type Db } from "@paperclipai/db";
import { runDispositionSchema, type RunDisposition } from "@paperclipai/shared";

const DISPOSITION_KEY = "paperclipDisposition";

/**
 * Records how the run ended its work in `result_json.paperclipDisposition`, keeping the other keys.
 * The first disposition wins: a later one (a `finish` after a `block`) is ignored.
 */
export async function recordRunDisposition(db: Db, runId: string, disposition: RunDisposition): Promise<void> {
  const current = sql`coalesce(${heartbeatRuns.resultJson}, '{}'::jsonb)`;
  await db
    .update(heartbeatRuns)
    .set({
      resultJson: sql`${current} || jsonb_build_object(${DISPOSITION_KEY}::text, ${JSON.stringify(disposition)}::jsonb)`,
      updatedAt: new Date(),
    })
    .where(and(eq(heartbeatRuns.id, runId), sql`(${current} -> ${DISPOSITION_KEY}::text) is null`));
}

/** The run's recorded disposition, or null when none was recorded (or it doesn't parse). */
export function readRunDisposition(run: { resultJson: Record<string, unknown> | null }): RunDisposition | null {
  const parsed = runDispositionSchema.safeParse(run.resultJson?.[DISPOSITION_KEY]);
  return parsed.success ? parsed.data : null;
}
