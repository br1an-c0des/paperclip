import type { AgentDetail } from "@paperclipai/shared";
import { createQuery } from "@tanstack/solid-query";
import { Copy } from "lucide-solid";
import { Match, Show, Switch } from "solid-js";
import { agentsApi } from "@/api/agents";
import { queryKeys } from "@/api/queryKeys";
import { useCompany } from "@/lib/company";
import { usePeopleQuery } from "@/lib/company-data";
import { copyText } from "@/tasks/TaskActions";
import { Button } from "@/ui/Button";
import { SettingsCard, SettingsRow } from "@/ui/Field";
import { pushToast } from "@/ui/Toast";
import { creatorLabel } from "../agent-model";
import { dateTime, failure } from "../shared";

/*
 * Where the agent came from and how it proves who it is (the old overview's Identity card): who
 * created it and when, and its public signing key (`GET /agents/:id/identity`), which its first
 * managed run creates. The private key never leaves the runtime; Copy copies the PEM.
 */

export function IdentityCard(props: { agent: AgentDetail }) {
  const company = useCompany();
  const people = usePeopleQuery();
  const identity = createQuery(() => ({
    queryKey: queryKeys.agents.part(props.agent.id, "identity"),
    queryFn: ({ signal }) => agentsApi.identity(props.agent.id, company().id, signal),
    retry: false,
  }));
  const creator = () => creatorLabel(props.agent, people.data?.users);
  const copy = async (pem: string) => {
    try {
      await copyText(pem);
      pushToast({ tone: "success", title: "Copied the public key" });
    } catch (caught) {
      pushToast({ tone: "error", title: "Couldn't copy the key", body: failure(caught, "") || undefined });
    }
  };

  return (
    <SettingsCard title="Origin and signing key" description="Who made the agent, and the key its runs sign their work with.">
      <SettingsRow label="Created">
        <span class="ag-static-text">
          {dateTime(props.agent.createdAt)}
          <Show when={creator()}>{(name) => ` by ${name()}`}</Show>
        </span>
      </SettingsRow>
      <SettingsRow label="Public key" help="Ed25519. Paperclip and other agents check its signature against this.">
        <Switch>
          <Match when={identity.isPending}>
            <span class="ps-muted-line">Loading…</span>
          </Match>
          <Match when={identity.isError}>
            <span class="fhelp ag-warn" role="alert">
              Couldn't load the key. {failure(identity.error, "")}
            </span>
          </Match>
          <Match when={identity.data}>
            {(key) => (
              <div class="ps-inline">
                <span class="mono ag-key-id" title={key().keyId}>
                  {key().keyId.length > 22 ? `${key().keyId.slice(0, 22)}…` : key().keyId}
                </span>
                <Button size="compact" variant="quiet" icon={<Copy size={14} aria-hidden="true" />} onClick={() => void copy(key().publicKeyPem)}>
                  Copy public key
                </Button>
                <span class="ps-muted-line">Since {dateTime(key().createdAt)}</span>
              </div>
            )}
          </Match>
          <Match when={true}>
            <div class="ps-stack">
              <span>Not created yet</span>
              <span class="fhelp">Paperclip creates it on the agent's next managed run.</span>
            </div>
          </Match>
        </Switch>
      </SettingsRow>
    </SettingsCard>
  );
}
