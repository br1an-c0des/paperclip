import type { AgentDetail } from "@paperclipai/shared";
import { A } from "@solidjs/router";
import { createQuery, useQueryClient } from "@tanstack/solid-query";
import { RotateCcw } from "lucide-solid";
import { createMemo, createSignal, For, Show } from "solid-js";
import { agentsApi } from "@/api/agents";
import { issuePath, issuesApi } from "@/api/issues";
import { queryKeys } from "@/api/queryKeys";
import { runPath } from "@/api/runs";
import { useCompany } from "@/lib/company";
import { Button } from "@/ui/Button";
import { SettingsCard, SettingsRow } from "@/ui/Field";
import { TonePill, type Tone } from "@/ui/Status";
import { pushToast } from "@/ui/Toast";
import { formatCents, formatTokens, runtimeIdentity } from "../agent-model";
import { dateTime, failure } from "../shared";

/*
 * Runner information (M5): what the runner keeps between runs. The agent's runtime state (its
 * current provider session, the last run, token and cost totals, the last error) and its task
 * sessions (`GET /agents/:id/task-sessions`, which the old UI never showed): one provider session
 * per task, each of which can be reset so the next run starts with fresh context.
 *
 * What the Runner keeps only on disk (sandbox state, ACP state, its own logs) isn't in the API;
 * the build plan's 3.11 tracks it.
 */

export function runStatusTone(status: string | null | undefined): Tone {
  if (status === "succeeded") return "green";
  if (status === "failed" || status === "timed_out" || status === "process_lost") return "red";
  if (status === "running" || status === "queued") return "run";
  if (status === "cancelled") return "amber";
  return "violet";
}

export function RunnerStateCard(props: { agent: AgentDetail }) {
  const company = useCompany();
  const client = useQueryClient();
  const [busy, setBusy] = createSignal<string | null>(null);
  const state = createQuery(() => ({
    queryKey: queryKeys.agents.part(props.agent.id, "runtime-state"),
    queryFn: ({ signal }) => agentsApi.runtimeState(props.agent.id, company().id, signal),
    retry: false,
  }));
  const sessions = createQuery(() => ({
    queryKey: queryKeys.agents.part(props.agent.id, "task-sessions"),
    queryFn: ({ signal }) => agentsApi.taskSessions(props.agent.id, company().id, signal),
    retry: false,
  }));
  const tasks = createQuery(() => ({
    queryKey: queryKeys.agents.part(props.agent.id, "tasks"),
    queryFn: ({ signal }) => issuesApi.list(company().id, { participantAgentId: props.agent.id, limit: 200 }, signal),
    enabled: (sessions.data?.length ?? 0) > 0,
    retry: false,
  }));
  const taskById = createMemo(() => new Map((tasks.data ?? []).map((task) => [task.id, task])));
  const sortedSessions = createMemo(() => [...(sessions.data ?? [])].sort((a, b) => new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime()));

  const reset = async (taskKey: string | null) => {
    setBusy(taskKey ?? "__all__");
    try {
      await agentsApi.resetSession(props.agent.id, taskKey, company().id);
      await client.invalidateQueries({ queryKey: queryKeys.agents.detail(props.agent.id) });
      pushToast({ tone: "success", title: taskKey ? "Reset the task's session" : "Reset every session", body: "The next run starts with fresh provider context." });
    } catch (caught) {
      pushToast({ tone: "error", title: "Couldn't reset the session", body: failure(caught, "") || undefined });
    } finally {
      setBusy(null);
    }
  };

  const sessionLabel = (value: string | null | undefined) => (value ? (value.length > 18 ? `${value.slice(0, 8)}…${value.slice(-4)}` : value) : "None");

  return (
    <SettingsCard
      title="Runner state and sessions"
      description={`What ${runtimeIdentity(props.agent).label} keeps between runs. Reset a session to give the next run fresh context.`}
      footer={
        <Button size="compact" disabled={busy() !== null} icon={<RotateCcw size={14} aria-hidden="true" />} onClick={() => void reset(null)}>
          Reset all sessions
        </Button>
      }
    >
      <Show when={state.isError}>
        <p class="ps-list-note" role="alert">
          Couldn't load the runtime state. {failure(state.error, "")}
        </p>
      </Show>
      <Show when={state.data} fallback={<Show when={state.isSuccess}><p class="ps-list-note">{props.agent.name} hasn't run yet.</p></Show>}>
        {(current) => (
          <>
            <SettingsRow label="Current session" help="The provider session the next run without a task resumes.">
              <div class="ps-stack">
                <span class="mono" title={current().sessionDisplayId ?? current().sessionId ?? undefined}>
                  {sessionLabel(current().sessionDisplayId ?? current().sessionId)}
                </span>
                <span class="fhelp">Updated {dateTime(current().updatedAt)}</span>
              </div>
            </SettingsRow>
            <SettingsRow label="Last run">
              <Show when={current().lastRunId} fallback={<span class="ag-static-text">None yet</span>}>
                {(runId) => (
                  <div class="ps-inline">
                    <TonePill tone={runStatusTone(current().lastRunStatus)} compact>
                      {(current().lastRunStatus ?? "unknown").replace(/_/g, " ")}
                    </TonePill>
                    <A class="ps-link mono" href={runPath(company().issuePrefix, props.agent.urlKey, runId())}>
                      {runId().slice(0, 8)}
                    </A>
                  </div>
                )}
              </Show>
            </SettingsRow>
            <SettingsRow label="Totals" help="Across every run the runtime state has counted.">
              <div class="ag-stats">
                <span>
                  <b>{formatTokens(current().totalInputTokens)}</b> input
                </span>
                <span>
                  <b>{formatTokens(current().totalCachedInputTokens)}</b> cached
                </span>
                <span>
                  <b>{formatTokens(current().totalOutputTokens)}</b> output
                </span>
                <span>
                  <b>{formatCents(current().totalCostCents)}</b> billed
                </span>
              </div>
            </SettingsRow>
            <Show when={current().lastError}>
              <SettingsRow label="Last error">
                <pre class="ag-pre mono">{current().lastError}</pre>
              </SettingsRow>
            </Show>
          </>
        )}
      </Show>
      <SettingsRow label="Task sessions" help="One provider session per task. The newest first.">
        <Show when={sortedSessions().length > 0} fallback={<span class="ag-static-text">{sessions.isLoading ? "Loading…" : "No task sessions."}</span>}>
          <ul class="ps-list ag-sessions">
            <For each={sortedSessions()}>
              {(session) => {
                const task = () => taskById().get(session.taskKey);
                return (
                  <li class="ps-list-row">
                    <span class="ps-list-name">
                      <A class="ps-link" href={issuePath(company().issuePrefix, { id: session.taskKey, identifier: task()?.identifier ?? null })}>
                        {task()?.identifier ?? "Task"}
                      </A>{" "}
                      <span class="ag-session-title">{task()?.title ?? ""}</span>
                      <span class="ps-list-meta">
                        Session <span class="mono">{sessionLabel(session.sessionDisplayId ?? (session.sessionParamsJson?.sessionId as string | undefined))}</span> · updated {dateTime(session.updatedAt)}
                        {session.lastError ? ` · ${session.lastError}` : ""}
                      </span>
                    </span>
                    <Show when={session.lastRunId}>
                      {(runId) => (
                        <A class="ps-link" href={runPath(company().issuePrefix, props.agent.urlKey, runId())}>
                          Last run
                        </A>
                      )}
                    </Show>
                    <Button size="compact" variant="quiet" disabled={busy() !== null} onClick={() => void reset(session.taskKey)}>
                      {busy() === session.taskKey ? "Resetting…" : "Reset"}
                    </Button>
                  </li>
                );
              }}
            </For>
          </ul>
        </Show>
      </SettingsRow>
    </SettingsCard>
  );
}
