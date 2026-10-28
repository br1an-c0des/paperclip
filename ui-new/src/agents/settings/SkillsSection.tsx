import type { AgentDetail, AgentDesiredSkillEntry, AgentSkillEntry } from "@paperclipai/shared";
import { createQuery, useQueryClient } from "@tanstack/solid-query";
import { createMemo, createSignal, For, Match, Show, Switch as SolidSwitch } from "solid-js";
import { agentsApi } from "@/api/agents";
import { queryKeys } from "@/api/queryKeys";
import { useCompany } from "@/lib/company";
import { SettingsCard } from "@/ui/Field";
import { Switch } from "@/ui/Switch";
import { TonePill } from "@/ui/Status";
import { pushToast } from "@/ui/Toast";
import { builtInSkill, PAPERCLIP_CORE_SKILL_KEY, recommendedForLeads, skillToggle } from "../agent-model";
import { CardNote, failure, SectionTitle } from "../shared";

/*
 * Skills (board 30's outline): the company library's skills, with a switch for each that the agent
 * should have. Saving replaces the agent's list (`POST /agents/:id/skills/sync`, mode replace) and
 * keeps the versions already pinned. Choosing a version per skill isn't offered yet; skills
 * installed outside Paperclip are listed read-only.
 *
 * The core `paperclip` skill has no switch (agent-model.ts, builtInSkill): Paperclip Runner agents
 * never get it, since the Runner carries the same contract itself, and legacy harnesses always
 * mount it (with the feedback skills). The other bundled skills are noted as meant for leads.
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
  const builtIn = (entry: AgentSkillEntry) => builtInSkill(props.agent.adapterType, entry.key);
  // What comes with the runner first (the core skill leading), then what's assigned, then the rest by name.
  const rank = (entry: AgentSkillEntry) => (builtIn(entry) === null ? 0 : entry.key.trim().toLowerCase() === PAPERCLIP_CORE_SKILL_KEY ? 2 : 1);
  const entries = createMemo(() =>
    [...(skills.data?.entries ?? [])].sort(
      (a, b) =>
        rank(b) - rank(a) ||
        Number(b.desired) - Number(a.desired) ||
        (a.runtimeName ?? a.key).localeCompare(b.runtimeName ?? b.key),
    ),
  );
  const choosable = () => entries().filter((entry) => builtIn(entry) === null);
  const assigned = () => choosable().filter((entry) => entry.desired).length;
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
              title={`${assigned()} of ${choosable().length} assigned`}
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
                    <SolidSwitch>
                      <Match when={builtIn(entry)}>
                        {(kind) => (
                          <li class="ps-list-row">
                            <span class="ps-list-name">
                              <b>{entry.runtimeName ?? entry.key}</b>
                              <span class="ps-list-meta">
                                {kind() === "runner"
                                  ? `The Runner gives ${props.agent.name} Paperclip's tools and rules directly.`
                                  : "Paperclip adds it to every run in this harness."}
                              </span>
                            </span>
                            <TonePill tone={kind() === "runner" ? "violet" : "green"} compact>
                              {kind() === "runner" ? "Built into the Paperclip Runner" : "Always on"}
                            </TonePill>
                          </li>
                        )}
                      </Match>
                      <Match when={true}>
                        <li class="ps-list-row">
                          <span class="ps-list-name">
                            <b>{entry.runtimeName ?? entry.key}</b>
                            <span class="ps-list-meta">
                              {entry.originLabel ?? (entry.managed ? "Managed by Paperclip" : "Your library")}
                              {recommendedForLeads(entry.key) ? " · Recommended for agents that lead others" : ""}
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
                      </Match>
                    </SolidSwitch>
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
