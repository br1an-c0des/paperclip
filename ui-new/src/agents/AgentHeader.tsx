import type { AgentDetail } from "@paperclipai/shared";
import { A } from "@solidjs/router";
import { createQuery, useQueryClient } from "@tanstack/solid-query";
import { Crown, Eye, MessageCircle, MoreHorizontal, Pause, Play, SlidersHorizontal } from "lucide-solid";
import { createMemo, createSignal, Show } from "solid-js";
import { agentsApi } from "@/api/agents";
import { queryKeys } from "@/api/queryKeys";
import { runPath } from "@/api/runs";
import { useCompany } from "@/lib/company";
import { useAgentsQuery, useLiveRunsQuery } from "@/lib/company-data";
import { AgentAvatar } from "@/ui/Avatar";
import { Button, buttonClass } from "@/ui/Button";
import { Dialog } from "@/ui/Dialog";
import { Menu } from "@/ui/Menu";
import { PageHeader } from "@/ui/PageHeader";
import { RunningPill, TonePill } from "@/ui/Status";
import { pushToast } from "@/ui/Toast";
import { headerSummary, harnessType, modelLabel } from "./agent-model";
import { failure, refreshAgent } from "./shared";

/*
 * The agent's header card (boards 12 and 26): avatar with its state, name, the primary-agent crown,
 * a state pill, and one line saying what it is and how it runs ("General · Claude Code · Paperclip
 * Runner · Claude Opus 5.5 · $0.00 spent this month"). On the settings view the actions are Watch
 * run (while it runs), Open chat, Pause or Resume and a More menu; on the chat view, Manage agent.
 */

export function AgentHeader(props: { agent: AgentDetail; base: string; view: "chat" | "settings" }) {
  const company = useCompany();
  const client = useQueryClient();
  const agents = useAgentsQuery();
  const liveRuns = useLiveRunsQuery();
  const [busy, setBusy] = createSignal(false);
  const [retireOpen, setRetireOpen] = createSignal(false);

  const harness = () => harnessType(props.agent.adapterType, props.agent.adapterConfig);
  const models = createQuery(() => ({
    queryKey: queryKeys.agents.adapterModels(company().id, harness()),
    queryFn: () => agentsApi.adapterModels(company().id, harness()),
    staleTime: 5 * 60_000,
    retry: false,
  }));
  const primary = createQuery(() => ({
    queryKey: queryKeys.agents.primary(company().id),
    queryFn: ({ signal }) => agentsApi.primaryAgent(company().id, signal),
    retry: false,
  }));
  const isPrimary = () => primary.data?.primaryAgentId === props.agent.id;
  const manager = () => (props.agent.reportsTo ? agents.data?.find((agent) => agent.id === props.agent.reportsTo) : undefined);
  const run = createMemo(() => (liveRuns.data ?? []).find((entry) => entry.agentId === props.agent.id && entry.status === "running"));
  const queued = createMemo(() => (liveRuns.data ?? []).some((entry) => entry.agentId === props.agent.id && entry.status === "queued"));
  const config = () => props.agent.adapterConfig as Record<string, unknown>;
  const summary = () =>
    headerSummary({
      agent: props.agent,
      managerName: manager()?.name ?? null,
      modelLabel: modelLabel(typeof config().model === "string" ? (config().model as string) : null, models.data),
    });

  const act = async (work: () => Promise<unknown>, done: string, fallback: string) => {
    setBusy(true);
    try {
      await work();
      await refreshAgent(client, company().id, props.agent.id);
      void client.invalidateQueries({ queryKey: queryKeys.liveRuns(company().id) });
      pushToast({ tone: "success", title: done });
    } catch (caught) {
      pushToast({ tone: "error", title: fallback, body: failure(caught, "") || undefined });
    } finally {
      setBusy(false);
    }
  };
  const paused = () => props.agent.status === "paused";
  const retired = () => props.agent.status === "terminated";

  return (
    <>
      <PageHeader
        size="compact"
        crumbs={
          <>
            <A href={`/${company().issuePrefix}/agents`}>Agents</A>
            <span aria-hidden="true" style={{ color: "var(--dashed)" }}>
              /
            </span>
          </>
        }
        mark={
          <span class="ag-mark">
            <AgentAvatar agent={props.agent} size={40} ring={Boolean(run())} />
          </span>
        }
        title={props.agent.name}
        titleAside={
          <>
            <Show when={isPrimary()}>
              <span class="ag-crown" title="Your primary agent">
                <Crown size={14} aria-label="Your primary agent" />
              </span>
            </Show>
            <StatePill agent={props.agent} running={Boolean(run())} queued={queued()} />
          </>
        }
        numbers={<span>{summary()}</span>}
        actions={
          <Show
            when={props.view === "settings"}
            fallback={
              <A class={buttonClass({ size: "compact" })} href={`${props.base}/profile`}>
                <SlidersHorizontal size={14} aria-hidden="true" />
                Manage agent
              </A>
            }
          >
            <Show when={run()}>
              {(current) => (
                <A class={buttonClass({ size: "compact" })} href={runPath(company().issuePrefix, props.agent.urlKey, current().id)}>
                  <Eye size={14} aria-hidden="true" />
                  Watch run
                </A>
              )}
            </Show>
            <A class={buttonClass({ size: "compact" })} href={props.base} title="Chat arrives in the next part of M5">
              <MessageCircle size={14} aria-hidden="true" />
              Open chat
            </A>
            <Show when={!retired() && props.agent.status !== "pending_approval"}>
              <Button
                size="compact"
                disabled={busy()}
                icon={paused() ? <Play size={14} aria-hidden="true" /> : <Pause size={14} aria-hidden="true" />}
                onClick={() =>
                  void (paused()
                    ? act(() => agentsApi.resume(props.agent.id, company().id), `Resumed ${props.agent.name}`, "Couldn't resume the agent")
                    : act(() => agentsApi.pause(props.agent.id, company().id), `Paused ${props.agent.name}`, "Couldn't pause the agent"))
                }
              >
                {paused() ? "Resume" : "Pause"}
              </Button>
            </Show>
            <Menu placement="bottom-end">
              <Menu.Trigger as={Button} variant="icon" ghost size="compact" aria-label="More actions">
                <MoreHorizontal size={16} aria-hidden="true" />
              </Menu.Trigger>
              <Menu.Content label="Agent actions" width={260}>
                <Show when={!retired() && !paused()}>
                  <Menu.Item
                    description="Starts a run now"
                    onSelect={() => void act(() => agentsApi.invoke(props.agent.id, company().id), `Started a run for ${props.agent.name}`, "Couldn't start a run")}
                  >
                    Run now
                  </Menu.Item>
                </Show>
                <Show when={props.agent.status === "pending_approval"}>
                  <Menu.Item onSelect={() => void act(() => agentsApi.approve(props.agent.id, company().id), `Approved ${props.agent.name}`, "Couldn't approve the agent")}>
                    Approve hire
                  </Menu.Item>
                </Show>
                <Show when={props.agent.status === "error"}>
                  <Menu.Item onSelect={() => void act(() => agentsApi.clearError(props.agent.id, company().id), "Cleared the error", "Couldn't clear the error")}>
                    Clear error
                  </Menu.Item>
                </Show>
                <Show when={props.agent.lifecycleError}>
                  <Menu.Item
                    description={props.agent.lifecycleError ?? undefined}
                    onSelect={() => void act(() => agentsApi.retryLifecycle(props.agent.id, company().id), "Retrying setup", "Couldn't retry setup")}
                  >
                    Retry setup
                  </Menu.Item>
                </Show>
                <Show when={!isPrimary() && !retired()}>
                  <Menu.Item
                    description="The default for your new tasks and chat"
                    onSelect={() =>
                      void act(
                        async () => {
                          await agentsApi.setPrimaryAgent(company().id, props.agent.id);
                          await client.invalidateQueries({ queryKey: queryKeys.agents.primary(company().id) });
                        },
                        `${props.agent.name} is your primary agent`,
                        "Couldn't change your primary agent",
                      )
                    }
                  >
                    Make my primary agent
                  </Menu.Item>
                </Show>
                <Menu.Item
                  description="Fresh provider context on every task"
                  onSelect={() => void act(() => agentsApi.resetSession(props.agent.id, null, company().id), "Reset every session", "Couldn't reset the sessions")}
                >
                  Reset all sessions
                </Menu.Item>
                <Show when={!retired()}>
                  <Menu.Separator />
                  <Menu.Item danger onSelect={() => setRetireOpen(true)}>
                    Retire agent…
                  </Menu.Item>
                </Show>
              </Menu.Content>
            </Menu>
          </Show>
        }
      />
      <Dialog
        open={retireOpen()}
        onOpenChange={setRetireOpen}
        title={`Retire ${props.agent.name}?`}
        width={480}
        description="It stops taking work and leaves the sidebar. Its tasks, runs and history are kept. This can't be undone from here."
        footer={
          <>
            <Button variant="quiet" onClick={() => setRetireOpen(false)}>
              Keep {props.agent.name}
            </Button>
            <Button
              variant="danger"
              disabled={busy()}
              onClick={() => {
                setRetireOpen(false);
                void act(() => agentsApi.terminate(props.agent.id, company().id), `Retired ${props.agent.name}`, "Couldn't retire the agent");
              }}
            >
              Retire agent
            </Button>
          </>
        }
      >
        {null}
      </Dialog>
    </>
  );
}

function StatePill(props: { agent: AgentDetail; running: boolean; queued: boolean }) {
  return (
    <Show when={!props.running} fallback={<RunningPill compact label="Working" />}>
      <Show
        when={props.agent.status === "paused"}
        fallback={
          <Show
            when={props.agent.status === "error"}
            fallback={
              <Show
                when={props.agent.status === "pending_approval"}
                fallback={<span class="ag-state">{props.agent.status === "terminated" ? "Retired" : props.queued ? "Queued" : "Idle"}</span>}
              >
                <TonePill tone="amber" compact>
                  Needs approval
                </TonePill>
              </Show>
            }
          >
            <TonePill tone="red" compact>
              Error
            </TonePill>
          </Show>
        }
      >
        <TonePill tone="amber" compact>
          {props.agent.pauseReason === "budget" ? "Paused · budget" : "Paused"}
        </TonePill>
      </Show>
    </Show>
  );
}
