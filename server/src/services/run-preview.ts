import type { Db } from "@paperclipai/db";
import type { ClaudeRunPreview } from "@paperclipai/shared";

/**
 * What an agent's runs get, before any run (fork/step-4b-parts-2-3.md, part 2): the next sealed
 * `claude_local` CLI launch's manifest, worked out read-only.
 */
export function runPreviewService(_db: Db) {
  return {
    async previewAgentRun(
      agent: { id: string; companyId: string; adapterType: string },
      _input: { projectId: string | null },
    ): Promise<ClaudeRunPreview> {
      if (agent.adapterType !== "claude_local") return { supported: false, reason: "not_claude_local" };
      return { supported: false, reason: "not_cli_engine" };
    },
  };
}
