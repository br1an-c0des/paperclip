import type { AiConnectionList, AiRuntimeConnectionBinding } from "@paperclipai/shared";
import { useQueryClient } from "@tanstack/solid-query";
import { createMemo, createSignal, Show } from "solid-js";
import { createStore } from "solid-js/store";
import { aiConnectionsApi } from "@/api/ai-connections";
import { queryKeys } from "@/api/queryKeys";
import { harnessLabel } from "@/agents/agent-model";
import { failure } from "@/agents/shared";
import { useCompany } from "@/lib/company";
import { Button } from "@/ui/Button";
import { Dialog } from "@/ui/Dialog";
import { Field, TextInput } from "@/ui/Field";
import { Segmented } from "@/ui/Segmented";
import { Switch as Toggle } from "@/ui/Switch";
import { emptyGateway, gatewayAuthOptions, gatewayBinding, gatewayName, gatewayProtocol, gatewayRequest, type GatewayAuth } from "./onboarding-model";
import "@/connectors/Connectors.css";

/*
 * "Use a custom gateway" (the old wizard's OnboardingGatewaySetup, upstream #17253): an AI
 * connection that sends Claude Code or Codex through your own endpoint, such as Emissary. The API
 * format follows the harness (Anthropic Messages for Claude Code, OpenAI Responses for Codex). The
 * saved connection becomes the agent's sign-in; its model ids, if given, are the models offered.
 */

export function GatewaySetup(props: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  harness: string;
  agentId: string | null;
  list: AiConnectionList;
  onSaved: (name: string, binding: AiRuntimeConnectionBinding) => void;
}) {
  return (
    <Dialog
      open={props.open}
      onOpenChange={props.onOpenChange}
      title="Use a custom gateway"
      description={`Send ${harnessLabel(props.harness)} through your own endpoint. Save it, then choose a model and test it.`}
      width={620}
    >
      <GatewayForm {...props} onCancel={() => props.onOpenChange(false)} />
    </Dialog>
  );
}

function GatewayForm(props: {
  harness: string;
  agentId: string | null;
  list: AiConnectionList;
  onCancel: () => void;
  onSaved: (name: string, binding: AiRuntimeConnectionBinding) => void;
}) {
  const company = useCompany();
  const client = useQueryClient();
  const [draft, setDraft] = createStore(emptyGateway());
  const [nameEdited, setNameEdited] = createSignal(false);
  const [saving, setSaving] = createSignal(false);
  const [error, setError] = createSignal<string | null>(null);
  const canManage = () => props.list.canManageConnections;
  const name = () => (nameEdited() ? draft.name : gatewayName(draft.baseUrl, draft.ownership));
  const request = createMemo(() => gatewayRequest(props.harness, { ...draft, name: name() }, props.agentId));
  const protocolLabel = () => (gatewayProtocol(props.harness) === "messages" ? "Anthropic Messages" : "OpenAI Responses");

  const submit = async (event: Event) => {
    event.preventDefault();
    const built = request();
    if (!built.ok || saving()) return;
    setSaving(true);
    setError(null);
    try {
      const result = await aiConnectionsApi.create(company().id, built.body);
      setDraft("apiKey", "");
      await client.invalidateQueries({ queryKey: queryKeys.aiConnections.list(company().id) });
      props.onSaved(built.body.name, gatewayBinding(props.harness, draft.ownership, result));
    } catch (caught) {
      setError(failure(caught, "Couldn't save the gateway."));
    } finally {
      setSaving(false);
    }
  };

  return (
    <div class="cx-setup">
      <form class="cx-setup-form" onSubmit={(event) => void submit(event)}>
        <Field label="Gateway address" for="ob-gw-url" help={`Speaks ${protocolLabel()}, as ${harnessLabel(props.harness)} needs. HTTPS, or HTTP on localhost.`}>
          <TextInput
            id="ob-gw-url"
            class="mono"
            type="url"
            inputmode="url"
            autocomplete="off"
            spellcheck={false}
            placeholder="https://gateway.example.com/v1"
            value={draft.baseUrl}
            onInput={(event) => setDraft("baseUrl", event.currentTarget.value)}
          />
        </Field>

        <Field label="Sign-in" help="How Paperclip authenticates with the gateway.">
          <Segmented<GatewayAuth> label="Sign-in" options={gatewayAuthOptions(props.harness)} value={draft.auth} onChange={(value) => setDraft("auth", value)} />
        </Field>

        <Show when={draft.auth !== "none"}>
          <Field label="Key" for="ob-gw-key" help="Stored encrypted. It isn't shown again.">
            <TextInput
              id="ob-gw-key"
              type="password"
              autocomplete="new-password"
              value={draft.apiKey}
              onInput={(event) => setDraft("apiKey", event.currentTarget.value)}
            />
          </Field>
        </Show>

        <Field label="Model ids" for="ob-gw-models" help="Comma separated: the provider's ids or your gateway's aliases. Leave empty to type one on the agent.">
          <TextInput
            id="ob-gw-models"
            class="mono"
            autocomplete="off"
            spellcheck={false}
            placeholder={props.harness === "claude_local" ? "claude-sonnet-4-5, claude-opus-4-5" : "gpt-5, gpt-5-codex"}
            value={draft.models}
            onInput={(event) => setDraft("models", event.currentTarget.value)}
          />
        </Field>

        <Field label="Name" for="ob-gw-name">
          <TextInput
            id="ob-gw-name"
            maxLength={160}
            value={name()}
            onInput={(event) => {
              // Read it first: marking the name edited re-renders the field from the draft.
              const value = event.currentTarget.value;
              setDraft("name", value);
              setNameEdited(true);
            }}
          />
        </Field>

        <Field
          label="Who can use it"
          help={
            canManage()
              ? draft.ownership === "shared"
                ? "Everyone in the organization can run agents on it."
                : "Only runs you're responsible for use it."
              : "Only a connection manager can share a connection with everyone."
          }
        >
          <Show when={canManage()} fallback={<p class="cx-static">Just me</p>}>
            <Segmented
              label="Who can use it"
              options={[
                { value: "personal", label: "Just me" },
                { value: "shared", label: "Everyone in the organization" },
              ]}
              value={draft.ownership}
              onChange={(value) => setDraft("ownership", value)}
            />
          </Show>
        </Field>

        <Show when={draft.ownership === "shared"}>
          <Toggle
            checked={draft.allAgents}
            onChange={(on) => setDraft("allAgents", on)}
            label="Every agent"
            description={draft.allAgents ? "Current and future agents can use it." : "Only this agent, for now. You can add others in Apps."}
          />
        </Show>

        <Show when={!request().ok && (draft.baseUrl.trim() || draft.apiKey) && request()}>
          {(built) => <p class="cx-note">{(built() as { problem: string }).problem}</p>}
        </Show>
        <Show when={error()}>
          {(text) => (
            <p class="cx-note cx-note--error" role="alert">
              {text()}
            </p>
          )}
        </Show>

        <div class="cx-actions">
          <Button variant="quiet" onClick={props.onCancel}>
            Cancel
          </Button>
          <Button type="submit" variant="primary" disabled={!request().ok || saving()}>
            {saving() ? "Saving…" : "Save gateway"}
          </Button>
        </div>
      </form>
    </div>
  );
}
