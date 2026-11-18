import { eq } from "drizzle-orm";
import { heartbeatRuns, type Db } from "@paperclipai/db";
import { recordRunDisposition } from "../services/heartbeat/run-disposition.js";
import type { CatalogDeps } from "./catalog/index.js";

const text = (value: unknown) => typeof value === "string" && value.trim() ? value.trim() : null;

/** The catalog's database-backed dependencies. */
export function catalogDeps(db: Db): CatalogDeps {
  return {
    async runTask(runId) {
      const [run] = await db.select({
        issueId: heartbeatRuns.issueId, nativeIssueId: heartbeatRuns.nativeIssueId, contextSnapshot: heartbeatRuns.contextSnapshot,
      }).from(heartbeatRuns).where(eq(heartbeatRuns.id, runId));
      const snapshot = run?.contextSnapshot ?? {};
      return {
        taskId: run?.issueId ?? run?.nativeIssueId ?? text(snapshot.issueId),
        wakeCommentId: text(snapshot.wakeCommentId),
      };
    },
    recordDisposition: (runId, disposition) => recordRunDisposition(db, runId, disposition),
  };
}
