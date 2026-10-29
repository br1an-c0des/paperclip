import type { InboxAgentPolicy } from "@paperclipai/shared";
import { createQuery, useQueryClient } from "@tanstack/solid-query";
import { Bot } from "lucide-solid";
import { createEffect, createMemo, For, on, Show } from "solid-js";
import { createStore, reconcile } from "solid-js/store";
import { inboxAgentPolicyApi } from "@/api/inbox-agent-policy";
import { queryKeys } from "@/api/queryKeys";
import { useCompany } from "@/lib/company";
import { useAgentsQuery } from "@/lib/company-data";
import { Button } from "@/ui/Button";
import { FieldButton, SettingsCard, SettingsRow } from "@/ui/Field";
import { Menu } from "@/ui/Menu";
import { Segmented } from "@/ui/Segmented";
import { INBOX_POLICY_OPTIONS, inboxPolicyBody, inboxPolicyDirty, tidyingAgents, type InboxPolicyDraft } from "./app-settings-model";
import { SaveNote, useSaver } from "./shared";

/*
 * "Let agents tidy my inbox" (the old Profile page, `GET|PUT /companies/:id/users/me/inbox-agent-policy`):
 * whether the agents you manage may archive tasks out of your inbox, in the organization you're in.
 * Any archive can be undone, and the task says which agent archived it. Saving is explicit, and a
 * background refetch never overwrites an unsaved choice.
 */

export function InboxTidyCard() {
  const company = useCompany();
  const client = useQueryClient();
  const saver = useSaver();
  const policy = createQuery(() => ({
    queryKey: queryKeys.instanceSettings.inboxAgentPolicy(company().id),
    queryFn: ({ signal }) => inboxAgentPolicyApi.mine(company().id, signal),
  }));
  const agents = useAgentsQuery();
  const choices = createMemo(() => tidyingAgents(agents.data));
  const [draft, setDraft] = createStore<InboxPolicyDraft>({ mode: "open", allowedAgentIds: [] });
  const dirty = () => inboxPolicyDirty(draft, policy.data);
  let synced: string | null = null;

  // Take the saved policy on load, and on refetch only while there's nothing unsaved.
  createEffect(
    on(
      () => policy.data,
      (saved) => {
        if (!saved) return;
        const current = JSON.stringify(inboxPolicyBody(draft));
        if (synced === null || current === synced) setDraft(reconcile({ mode: saved.mode, allowedAgentIds: [...saved.allowedAgentIds] }));
        synced = JSON.stringify(inboxPolicyBody(saved));
      },
    ),
  );

  const toggle = (agentId: string, on: boolean) =>
    setDraft("allowedAgentIds", (ids) => (on ? [...new Set([...ids, agentId])] : ids.filter((id) => id !== agentId)));
  const chosenLabel = () => {
    const count = draft.allowedAgentIds.length;
    if (count === 0) return "Pick agents";
    if (count === 1) return choices().find((agent) => agent.id === draft.allowedAgentIds[0])?.name ?? "1 agent";
    return `${count} agents`;
  };

  const save = () =>
    saver.run(async () => {
      const saved = await inboxAgentPolicyApi.updateMine(company().id, inboxPolicyBody(draft));
      synced = JSON.stringify(inboxPolicyBody(saved));
      client.setQueryData<InboxAgentPolicy>(queryKeys.instanceSettings.inboxAgentPolicy(company().id), saved);
    }, "Couldn't save who may tidy your inbox.");

  return (
    <SettingsCard
      title="Let agents tidy my inbox"
      description={
        <SaveNote saver={saver}>
          In {company().name}: whether agents you manage may archive tasks out of your inbox. You can undo any archive, and the task says which agent did it.
        </SaveNote>
      }
      footer={
        <Show when={dirty()}>
          <span class="as-lrow-end">
            <Button size="compact" variant="quiet" disabled={saver.busy()} onClick={() => policy.data && setDraft(reconcile({ mode: policy.data.mode, allowedAgentIds: [...policy.data.allowedAgentIds] }))}>
              Discard
            </Button>
            <Button size="compact" variant="primary" disabled={saver.busy()} onClick={() => void save()}>
              {saver.busy() ? "Saving…" : "Save"}
            </Button>
          </span>
        </Show>
      }
    >
      <Show when={!policy.isError} fallback={<p class="as-empty-line">Couldn't load your inbox setting. {policy.error instanceof Error ? policy.error.message : ""}</p>}>
        <SettingsRow label="Who may archive" help={INBOX_POLICY_OPTIONS.find((option) => option.value === draft.mode)?.help}>
          <Show when={policy.data} fallback={<span class="as-muted">Loading…</span>}>
            <Segmented label="Who may archive from your inbox" options={INBOX_POLICY_OPTIONS} value={draft.mode} onChange={(mode) => setDraft("mode", mode)} />
          </Show>
        </SettingsRow>
        <Show when={draft.mode === "allowlist"}>
          <SettingsRow label="Agents" help={draft.allowedAgentIds.length === 0 ? "None picked yet: no agent may archive until you pick one." : undefined}>
            <Menu>
              <Menu.Trigger as={FieldButton} class="as-field-320" icon={<Bot size={14} aria-hidden="true" />} aria-label="Agents allowed to tidy your inbox">
                {chosenLabel()}
              </Menu.Trigger>
              <Menu.Content label="Agents" width={300}>
                <For each={choices()} fallback={<p class="nt-menu-note">No agents yet.</p>}>
                  {(agent) => (
                    <Menu.CheckboxItem checked={draft.allowedAgentIds.includes(agent.id)} onChange={(value) => toggle(agent.id, value)} description={agent.title ?? undefined}>
                      {agent.name}
                    </Menu.CheckboxItem>
                  )}
                </For>
              </Menu.Content>
            </Menu>
          </SettingsRow>
        </Show>
      </Show>
    </SettingsCard>
  );
}
