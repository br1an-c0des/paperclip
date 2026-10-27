import type { AgentDetail, AgentKeyCreated } from "@paperclipai/shared";
import { createQuery, useQueryClient } from "@tanstack/solid-query";
import { Copy, KeyRound, Plus } from "lucide-solid";
import { createMemo, createSignal, For, Show } from "solid-js";
import { agentsApi, type AgentKey } from "@/api/agents";
import { queryKeys } from "@/api/queryKeys";
import { useCompany } from "@/lib/company";
import { Button } from "@/ui/Button";
import { Dialog } from "@/ui/Dialog";
import { SettingsCard, TextInput } from "@/ui/Field";
import { pushToast } from "@/ui/Toast";
import { failure, SectionTitle, shortDate } from "../shared";

/*
 * API keys (board 30's outline): keys that let outside tools act as this agent. A new key's token
 * is shown once, in a dialog; afterwards only its name is listed. Revoking is immediate. Keys with
 * a narrower scope (task bridge, skill test) are listed but only standard keys are created here.
 */

export function KeysSection(props: { agent: AgentDetail }) {
  const company = useCompany();
  const client = useQueryClient();
  const keys = createQuery(() => ({
    queryKey: queryKeys.agents.part(props.agent.id, "keys"),
    queryFn: ({ signal }) => agentsApi.keys(props.agent.id, company().id, signal),
    retry: false,
  }));
  const [name, setName] = createSignal("");
  const [busy, setBusy] = createSignal(false);
  const [created, setCreated] = createSignal<AgentKeyCreated | null>(null);
  const [revoking, setRevoking] = createSignal<AgentKey | null>(null);
  const active = createMemo(() => (keys.data ?? []).filter((key) => !key.revokedAt));
  const revoked = createMemo(() => (keys.data ?? []).filter((key) => key.revokedAt));

  const create = async (event: Event) => {
    event.preventDefault();
    setBusy(true);
    try {
      const key = await agentsApi.createKey(props.agent.id, name().trim() || "default", company().id);
      setCreated(key);
      setName("");
      await client.invalidateQueries({ queryKey: queryKeys.agents.part(props.agent.id, "keys") });
    } catch (caught) {
      pushToast({ tone: "error", title: "Couldn't create the key", body: failure(caught, "") || undefined });
    } finally {
      setBusy(false);
    }
  };
  const revoke = async (key: AgentKey) => {
    setRevoking(null);
    try {
      await agentsApi.revokeKey(props.agent.id, key.id, company().id);
      await client.invalidateQueries({ queryKey: queryKeys.agents.part(props.agent.id, "keys") });
      pushToast({ tone: "success", title: `Revoked ${key.name}` });
    } catch (caught) {
      pushToast({ tone: "error", title: "Couldn't revoke the key", body: failure(caught, "") || undefined });
    }
  };

  return (
    <>
      <SectionTitle title="API keys">Keys that let outside tools act as {props.agent.name}.</SectionTitle>
      <SettingsCard
        title={active().length === 1 ? "1 active key" : `${active().length} active keys`}
        description="Anyone with a key can act as this agent. Revoke keys you no longer use."
        footer={
          <form class="ag-key-form" onSubmit={(event) => void create(event)}>
            <TextInput value={name()} placeholder="Key name, such as ci-bot" aria-label="Key name" autocomplete="off" onInput={(event) => setName(event.currentTarget.value)} />
            <Button size="compact" variant="primary" type="submit" disabled={busy()} icon={<Plus size={14} aria-hidden="true" />}>
              {busy() ? "Creating…" : "Create key"}
            </Button>
          </form>
        }
      >
        <Show when={keys.isError}>
          <p class="ps-list-note" role="alert">
            Couldn't load the keys. {failure(keys.error, "")}
          </p>
        </Show>
        <ul class="ps-list">
          <For each={active()} fallback={<Show when={keys.isSuccess}><li class="ps-list-note">No keys yet.</li></Show>}>
            {(key) => (
              <li class="ps-list-row">
                <KeyRound size={14} aria-hidden="true" />
                <span class="ps-list-name">
                  <b>{key.name}</b>
                  <span class="ps-list-meta">
                    Created {shortDate(key.createdAt)}
                    {key.scope?.kind && key.scope.kind !== "standard" ? ` · ${key.scope.kind.replace(/_/g, " ")} scope` : ""}
                  </span>
                </span>
                <Button size="compact" variant="danger" onClick={() => setRevoking(key)}>
                  Revoke
                </Button>
              </li>
            )}
          </For>
          <For each={revoked()}>
            {(key) => (
              <li class="ps-list-row ag-revoked">
                <KeyRound size={14} aria-hidden="true" />
                <span class="ps-list-name">
                  <b>{key.name}</b>
                  <span class="ps-list-meta">Revoked {shortDate(key.revokedAt)}</span>
                </span>
              </li>
            )}
          </For>
        </ul>
      </SettingsCard>

      <Dialog
        open={Boolean(created())}
        onOpenChange={(open) => !open && setCreated(null)}
        title="Copy the key now"
        width={520}
        description="It isn't shown again. Store it where the tool that uses it can read it."
        footer={
          <Button variant="primary" onClick={() => setCreated(null)}>
            Done
          </Button>
        }
      >
        <Show when={created()}>
          {(key) => (
            <div class="ag-token">
              <code class="mono">{key().token}</code>
              <Button
                size="compact"
                icon={<Copy size={14} aria-hidden="true" />}
                onClick={() => {
                  void navigator.clipboard?.writeText(key().token).then(() => pushToast({ tone: "success", title: "Copied the key" }));
                }}
              >
                Copy
              </Button>
            </div>
          )}
        </Show>
      </Dialog>
      <Dialog
        open={Boolean(revoking())}
        onOpenChange={(open) => !open && setRevoking(null)}
        title={`Revoke ${revoking()?.name ?? "the key"}?`}
        width={440}
        description="Tools using it stop working at once."
        footer={
          <>
            <Button variant="quiet" onClick={() => setRevoking(null)}>
              Keep it
            </Button>
            <Button variant="danger" onClick={() => revoking() && void revoke(revoking()!)}>
              Revoke key
            </Button>
          </>
        }
      >
        {null}
      </Dialog>
    </>
  );
}
