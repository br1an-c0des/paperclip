import type { AgentDetail, AgentDesiredSkillEntry, AgentSkillEntry } from "@paperclipai/shared";
import { createQuery, useQueryClient } from "@tanstack/solid-query";
import { createMemo, createSignal, For, Show } from "solid-js";
import { agentsApi } from "@/api/agents";
import { queryKeys } from "@/api/queryKeys";
import { useCompany } from "@/lib/company";
import { SettingsCard } from "@/ui/Field";
import { Switch } from "@/ui/Switch";
import { TonePill } from "@/ui/Status";
import { pushToast } from "@/ui/Toast";
import { skillToggle } from "../agent-model";
import { CardNote, failure, SectionTitle } from "../shared";

/*
 * Skills (board 30's outline): the company library's skills, with a switch for each that the agent
 * should have. Saving replaces the agent's list (`POST /agents/:id/skills/sync`, mode replace) and
 * keeps the versions already pinned. Choosing a version per skill isn't offered yet; skills
 * installed outside Paperclip are listed read-only.
 */

const STATE_LABEL: Partial<Record<AgentSkillEntry["state"], string>> = {
  installed: "Installed",
  configured: "Configured",
  missing: "Missing",
  stale: "Out of date",
  external: "Installed outside Paperclip",
};

export function SkillsSection(props: { agent: AgentDetail }) {
  const company = useCompany();
  const client = useQueryClient();
  const [busy, setBusy] = createSignal<string | null>(null);
  const [error, setError] = createSignal<string | null>(null);
  const skills = createQuery(() => ({
    queryKey: queryKeys.agents.part(props.agent.id, "skills"),
    queryFn: ({ signal }) => agentsApi.skills(props.agent.id, company().id, signal),
    retry: false,
  }));
  const entries = createMemo(() =>
    [...(skills.data?.entries ?? [])].sort((a, b) => Number(b.desired) - Number(a.desired) || (a.runtimeName ?? a.key).localeCompare(b.runtimeName ?? b.key)),
  );
  const assigned = () => entries().filter((entry) => entry.desired).length;
  const desired = (): AgentDesiredSkillEntry[] =>
    skills.data?.desiredSkillEntries ?? (skills.data?.desiredSkills ?? []).map((key) => ({ key, versionId: null }));

  const toggle = async (entry: AgentSkillEntry, on: boolean) => {
    setBusy(entry.key);
    setError(null);
    try {
      const snapshot = await agentsApi.syncSkills(props.agent.id, skillToggle(desired(), entry.key, on), "replace", company().id);
      client.setQueryData(queryKeys.agents.part(props.agent.id, "skills"), snapshot);
      pushToast({ tone: "success", title: on ? `Added ${entry.runtimeName ?? entry.key}` : `Removed ${entry.runtimeName ?? entry.key}` });
    } catch (caught) {
      setError(failure(caught, "Couldn't change the skills."));
    } finally {
      setBusy(null);
    }
  };

  return (
    <>
      <SectionTitle title="Skills">What {props.agent.name} knows how to do, from the company's skill library.</SectionTitle>
      <Show when={skills.isError}>
        <p class="ps-list-note" role="alert">
          Couldn't load the skills. {failure(skills.error, "")}
        </p>
      </Show>
      <Show when={skills.data}>
        {(snapshot) => (
          <Show
            when={snapshot().supported}
            fallback={
              <section class="card planned">
                <p>{props.agent.name}'s harness doesn't take skills.</p>
              </section>
            }
          >
            <SettingsCard
              title={`${assigned()} of ${entries().length} assigned`}
              description={
                <CardNote state={busy() ? "saving" : error() ? "error" : "idle"} error={error()}>
                  {snapshot().mode === "ephemeral" ? "Given to each run as it starts." : "Installed in the harness."} Changes save at once.
                </CardNote>
              }
            >
              <Show when={snapshot().warnings.length}>
                <div class="ps-banner" role="status">
                  {snapshot().warnings.join(" ")}
                </div>
              </Show>
              <ul class="ps-list ag-skills">
                <For each={entries()} fallback={<li class="ps-list-note">The library has no skills yet.</li>}>
                  {(entry) => (
                    <li class="ps-list-row">
                      <span class="ps-list-name">
                        <b>{entry.runtimeName ?? entry.key}</b>
                        <span class="ps-list-meta">
                          {entry.originLabel ?? (entry.managed ? "Managed by Paperclip" : "Your library")}
                          {entry.detail ? ` · ${entry.detail}` : ""}
                        </span>
                      </span>
                      <Show when={entry.desired && STATE_LABEL[entry.state]}>
                        <TonePill tone={entry.state === "missing" || entry.state === "stale" ? "amber" : "green"} compact>
                          {STATE_LABEL[entry.state]}
                        </TonePill>
                      </Show>
                      <Switch
                        checked={entry.desired}
                        disabled={busy() !== null || entry.readOnly === true || entry.state === "external"}
                        label={`${entry.desired ? "Remove" : "Add"} ${entry.runtimeName ?? entry.key}`}
                        labelHidden
                        onChange={(checked) => void toggle(entry, checked)}
                      />
                    </li>
                  )}
                </For>
              </ul>
            </SettingsCard>
          </Show>
        )}
      </Show>
    </>
  );
}
