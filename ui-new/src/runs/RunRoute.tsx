import { useNavigate, useParams } from "@solidjs/router";
import type { Issue } from "@paperclipai/shared";
import { createQuery, useQueryClient } from "@tanstack/solid-query";
import { createEffect, on, onCleanup } from "solid-js";
import { issuePath } from "@/api/issues";
import { queryKeys } from "@/api/queryKeys";
import { runPath, runsApi } from "@/api/runs";
import { useCommands } from "@/lib/commands";
import { useCompany } from "@/lib/company";
import { useAgentsQuery } from "@/lib/company-data";
import { AgentPage } from "@/agents/AgentPage";

/*
 * A run's link: the old UI's run route, `/:companyPrefix/agents/:agentKey/runs/:runId`, which agents,
 * emails and the run modal's "Copy link" point to. It opens the run modal over the agent's page, as
 * the old UI shows a run inside its agent.
 *
 * While the route is open the URL follows the modal: stepping to the task's previous or next run,
 * or to a retry, changes it. Closing the modal goes to the run's task, where its runs live in
 * ui-new, or to the agent when the run had no task or was a reply in the agent's chat (board 18).
 * Leaving the route another way (Back) closes it.
 */

export function RunRoute() {
  const params = useParams<{ agentKey: string; runId: string }>();
  const commands = useCommands();
  const company = useCompany();
  const navigate = useNavigate();
  const agents = useAgentsQuery();
  const client = useQueryClient();
  /** Whether a task is a chat, from what the run modal has already read. */
  const isChat = (issueId: string) =>
    !!(client.getQueryData<Issue>(queryKeys.issues.detail(issueId)) ?? client.getQueryData<Issue>(queryKeys.issues.section(issueId, "core")))?.conversationAgentId;
  /** The route has been left: nothing more to navigate. */
  let left = false;

  // The run the modal shows, to name it in the URL by its own agent.
  const shown = createQuery(() => ({
    queryKey: queryKeys.runs.detail(commands.runModal() ?? params.runId),
    queryFn: ({ signal }) => runsApi.get(commands.runModal() ?? params.runId, signal),
  }));
  const agentKey = (agentId: string) => agents.data?.find((agent) => agent.id === agentId)?.urlKey ?? agentId;

  createEffect(on(() => params.runId, (runId) => commands.openRunModal(runId)));

  createEffect(() => {
    const run = shown.data;
    if (!run || run.id !== commands.runModal() || run.id === params.runId) return;
    navigate(runPath(company().issuePrefix, agentKey(run.agentId), run.id), { replace: true });
  });

  // Whether the modal has been open on this route. Not a deferred `on`'s previous value: it skips its
  // first run without recording it, and by then the effect above has already opened the modal, so
  // the close looked like it came from nothing and the URL stayed on the run.
  let opened = false;
  createEffect(
    on(
      commands.runModal,
      (open) => {
        if (open) {
          opened = true;
          return;
        }
        if (!opened) return;
        opened = false;
        const run = shown.data;
        const next =
          run?.issueId && !isChat(run.issueId)
            ? issuePath(company().issuePrefix, { id: run.issueId, identifier: null })
            : `/${company().issuePrefix}/agents/${params.agentKey}`;
        // After the click that closed it, in case that click was a link going somewhere already.
        window.setTimeout(() => !left && navigate(next, { replace: true }));
      },
    ),
  );

  // Back, or another way out: the modal closes with the route. The effects are gone by now, so
  // closing doesn't navigate again.
  onCleanup(() => {
    left = true;
    if (commands.runModal()) commands.closeRunModal();
  });

  return <AgentPage />;
}
