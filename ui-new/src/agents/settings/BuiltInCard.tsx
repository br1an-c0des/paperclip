import type { AgentDetail } from "@paperclipai/shared";
import { createQuery, useQueryClient } from "@tanstack/solid-query";
import { Play, RotateCcw } from "lucide-solid";
import { createMemo, createSignal, For, Show } from "solid-js";
import { builtInAgentsApi, type BuiltInAgentState, type BuiltInManagedResourceState } from "@/api/agents";
import { queryKeys } from "@/api/queryKeys";
import { useCompany } from "@/lib/company";
import { useExperimentalSettingsQuery } from "@/lib/company-data";
import { Button } from "@/ui/Button";
import { Dialog } from "@/ui/Dialog";
import { SettingsCard, SettingsRow } from "@/ui/Field";
import { TonePill } from "@/ui/Status";
import { Switch } from "@/ui/Switch";
import { pushToast } from "@/ui/Toast";
import { BUILT_IN_STATUS, builtInFor, featureList, resourceLabel, resourceState } from "../built-in-model";
import { failure, refreshAgent } from "../shared";

/*
 * A built-in agent's own card (`enableBuiltInAgents`), at the top of its Profile, as the old agent
 * page's built-in banner and bundle panel have it: what it's for and its state, Reset to defaults,
 * and for agents that ship a bundle, each managed resource against Paperclip's default (take an
 * update, or reset an edited one) and the bundle's recurring task: run it now, or turn its schedule
 * on or off. Retiring is hidden for built-ins; pausing stays in the header.
 */

export function useBuiltInAgents() {
  const company = useCompany();
  const experimental = useExperimentalSettingsQuery();
  const enabled = () => experimental.data?.enableBuiltInAgents === true;
  const query = createQuery(() => ({
    queryKey: queryKeys.org.builtInAgents(company().id),
    queryFn: ({ signal }) => builtInAgentsApi.list(company().id, signal),
    enabled: enabled(),
    retry: false,
  }));
  return { enabled, query, states: () => (enabled() ? query.data : undefined) };
}

export function BuiltInCard(props: { agent: AgentDetail }) {
  const builtIns = useBuiltInAgents();
  const state = createMemo(() => builtInFor(builtIns.states(), props.agent.id));
  return <Show when={state()}>{(found) => <BuiltInCardBody agent={props.agent} state={found()} />}</Show>;
}

function BuiltInCardBody(props: { agent: AgentDetail; state: BuiltInAgentState }) {
  const company = useCompany();
  const client = useQueryClient();
  const [busy, setBusy] = createSignal<string | null>(null);
  const [confirmReset, setConfirmReset] = createSignal(false);
  const key = () => props.state.definition.key;
  const status = () => BUILT_IN_STATUS[props.state.status];
  const routine = () => props.state.definition.bundle?.routine;
  const routineResource = () => props.state.resources?.find((resource) => resource.resourceKind === "routine");
  const scheduleOn = () => routineResource()?.scheduleEnabled ?? routine()?.status === "active";

  const act = async (id: string, work: () => Promise<unknown>, done: string, fallback: string) => {
    setBusy(id);
    try {
      const result = await work();
      if (result && typeof result === "object" && "definition" in result) {
        client.setQueryData<BuiltInAgentState[]>(queryKeys.org.builtInAgents(company().id), (list) =>
          list?.map((entry) => (entry.definition.key === key() ? (result as BuiltInAgentState) : entry)),
        );
      }
      await Promise.all([
        client.invalidateQueries({ queryKey: queryKeys.org.builtInAgents(company().id) }),
        refreshAgent(client, company().id, props.agent.id),
      ]);
      pushToast({ tone: "success", title: done });
      return true;
    } catch (caught) {
      pushToast({ tone: "error", title: fallback, body: failure(caught, "") || undefined });
      return false;
    } finally {
      setBusy(null);
    }
  };

  const resetResource = (resource: BuiltInManagedResourceState, update: boolean) =>
    void act(
      `resource:${resource.resourceKind}`,
      () => builtInAgentsApi.reset(company().id, key(), [resource.resourceKind]),
      update ? `Updated the ${resourceLabel(resource.resourceKind).toLowerCase()}` : `Reset the ${resourceLabel(resource.resourceKind).toLowerCase()}`,
      "Couldn't change it",
    );

  return (
    <SettingsCard
      title={`Built-in agent: ${props.state.definition.displayName}`}
      description={props.state.definition.shortPurpose}
      footer={
        <Button size="compact" variant="quiet" disabled={busy() !== null} icon={<RotateCcw size={14} aria-hidden="true" />} onClick={() => setConfirmReset(true)}>
          Reset to defaults
        </Button>
      }
    >
      <SettingsRow label="State">
        <div class="ps-stack">
          <TonePill tone={status().tone} compact>
            {status().label}
          </TonePill>
          <Show when={props.state.pauseReason}>
            <span class="fhelp">{props.state.pauseReason}</span>
          </Show>
        </div>
      </SettingsRow>
      <Show when={props.state.definition.featureKeys.length > 0}>
        <SettingsRow label="Serves">
          <span class="ag-static-text">{featureList(props.state.definition.featureKeys)}</span>
        </SettingsRow>
      </Show>
      <For each={props.state.resources ?? []}>
        {(resource) => {
          const view = () => resourceState(resource);
          return (
            <SettingsRow label={resourceLabel(resource.resourceKind)} help={resource.resourceKey}>
              <div class="ps-inline">
                <TonePill tone={view().tone} compact>
                  {view().text}
                </TonePill>
                <Show when={view().action}>
                  {(action) => (
                    <Button size="compact" variant={action() === "update" ? "primary" : "quiet"} disabled={busy() !== null} onClick={() => resetResource(resource, action() === "update")}>
                      {action() === "update" ? "Take the update" : "Reset to the default"}
                    </Button>
                  )}
                </Show>
              </div>
            </SettingsRow>
          );
        }}
      </For>
      <Show when={routine()}>
        {(found) => (
          <div class="frow ag-frow-switch">
            <div class="flabel">
              {found().title}
              <span class="fhelp">
                {found().scheduleLabel ?? `${found().triggerCount} ${found().triggerCount === 1 ? "trigger" : "triggers"}`}. Turning the schedule off stops it starting work in the background.
              </span>
              <div class="ag-frow-extra">
                <Button
                  size="compact"
                  disabled={busy() !== null || props.state.status !== "ready"}
                  icon={<Play size={14} aria-hidden="true" />}
                  onClick={() => void act("run", () => builtInAgentsApi.runRoutine(company().id, key(), found().routineKey), `Started ${found().title}`, "Couldn't start it")}
                >
                  Run now
                </Button>
              </div>
            </div>
            <div class="ag-switch-cell">
              <Switch
                checked={scheduleOn()}
                disabled={busy() !== null}
                label={`${found().title} on a schedule`}
                labelHidden
                onChange={(on) =>
                  void act(
                    "schedule",
                    () => builtInAgentsApi.setRoutineSchedule(company().id, key(), found().routineKey, on),
                    on ? "Turned the schedule on" : "Turned the schedule off",
                    "Couldn't change the schedule",
                  )
                }
              />
            </div>
          </div>
        )}
      </Show>
      <Dialog
        open={confirmReset()}
        onOpenChange={setConfirmReset}
        title={`Reset ${props.state.definition.displayName} to its defaults?`}
        width={480}
        description="Its harness, model and budget go back to Paperclip's defaults, and so do its instructions, skill and recurring task. Edits to them are lost."
        footer={
          <>
            <Button variant="quiet" onClick={() => setConfirmReset(false)}>
              Cancel
            </Button>
            <Button
              variant="primary"
              disabled={busy() !== null}
              onClick={() =>
                void act("reset", () => builtInAgentsApi.reset(company().id, key()), `Reset ${props.state.definition.displayName}`, "Couldn't reset it").then(
                  (ok) => ok && setConfirmReset(false),
                )
              }
            >
              {busy() === "reset" ? "Resetting…" : "Reset to defaults"}
            </Button>
          </>
        }
      >
        {null}
      </Dialog>
    </SettingsCard>
  );
}
