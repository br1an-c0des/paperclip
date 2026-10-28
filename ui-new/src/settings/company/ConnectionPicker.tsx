import type { AiManagedConnectionSummary, AiProvider } from "@paperclipai/shared";
import { useQueryClient } from "@tanstack/solid-query";
import { Check, Plus } from "lucide-solid";
import { createSignal, For, Show, type JSX } from "solid-js";
import { aiConnectionsApi } from "@/api/ai-connections";
import { queryKeys } from "@/api/queryKeys";
import { useCompany } from "@/lib/company";
import { Button } from "@/ui/Button";
import { Dialog } from "@/ui/Dialog";
import { Field, TextInput } from "@/ui/Field";
import { Menu } from "@/ui/Menu";
import { Segmented } from "@/ui/Segmented";
import { TonePill } from "@/ui/Status";
import { connectionStatus } from "./connections-model";
import { failure } from "./shared";

/*
 * The connection a Paperclip model runs on (board 23's "Connection" rows): the chosen shared
 * connection with its status, a menu of the ones that fit, and "Add connection" for a shared API
 * key, as the old sections' setup dialog offers it (OpenAI or OpenRouter).
 */

const PROVIDER_LABEL: Record<string, string> = { openai: "OpenAI", openrouter: "OpenRouter", anthropic: "Anthropic" };

function mark(connection: Pick<AiManagedConnectionSummary, "provider">) {
  return connection.provider === "openrouter" ? "OR" : connection.provider === "openai" ? "OA" : connection.provider.slice(0, 2).toUpperCase();
}

/** The chosen connection, drawn like the board's connection box. */
export function ConnectionBox(props: { connection: AiManagedConnectionSummary | undefined; model?: string | null; missing: boolean; children?: JSX.Element }) {
  return (
    <div class="cs-conn">
      <Show
        when={props.connection}
        fallback={
          <span class="cs-muted cs-grow">{props.missing ? "The saved connection isn't available to you." : "No connection chosen."}</span>
        }
      >
        {(connection) => (
          <>
            <span class="cs-conn-mark" aria-hidden="true">
              {mark(connection())}
            </span>
            <span class="cs-person-text cs-grow">
              <span class="cs-strong">{connection().name}</span>
              <Show when={props.model}>
                <span class="cs-muted mono">{props.model}</span>
              </Show>
            </span>
            <TonePill tone={connectionStatus(connection()).tone} compact>
              {connectionStatus(connection()).label}
            </TonePill>
          </>
        )}
      </Show>
      {props.children}
    </div>
  );
}

/** "Change" (or "Choose"): the connections that fit, then "Add connection". */
export function ConnectionMenu(props: {
  choices: readonly AiManagedConnectionSummary[];
  grantId: string | null;
  onPick: (connection: AiManagedConnectionSummary) => void;
  onClear?: () => void;
  onAdd: () => void;
  disabled?: boolean;
}) {
  return (
    <Menu placement="bottom-end">
      <Menu.Trigger as={Button} size="compact" disabled={props.disabled}>
        {props.grantId ? "Change" : "Choose"}
      </Menu.Trigger>
      <Menu.Content label="Connection" width={320}>
        <For each={props.choices} fallback={<p class="nt-menu-note">No shared connection fits yet.</p>}>
          {(connection) => (
            <Menu.Item
              onSelect={() => props.onPick(connection)}
              description={`${PROVIDER_LABEL[connection.provider] ?? connection.provider} · ${connectionStatus(connection).label}`}
              hint={connection.grantId === props.grantId ? <Check size={14} /> : undefined}
            >
              {connection.name}
            </Menu.Item>
          )}
        </For>
        <Menu.Separator />
        <Show when={props.onClear && props.grantId}>
          <Menu.Item onSelect={() => props.onClear?.()}>No connection</Menu.Item>
        </Show>
        <Menu.Item icon={<Plus size={14} />} onSelect={props.onAdd}>
          Add connection…
        </Menu.Item>
      </Menu.Content>
    </Menu>
  );
}

/** A new shared API-key connection; the server checks the key with the provider before saving. */
export function AddConnectionDialog(props: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  providers: readonly ("openai" | "openrouter")[];
  purpose: string;
  /** Called with the new connection's id once it's saved. */
  onAdded: (connectionId: string) => void;
}) {
  const company = useCompany();
  const client = useQueryClient();
  const [provider, setProvider] = createSignal<"openai" | "openrouter">(props.providers[0] ?? "openrouter");
  const [name, setName] = createSignal("");
  const [key, setKey] = createSignal("");
  const [busy, setBusy] = createSignal(false);
  const [problem, setProblem] = createSignal<string | null>(null);

  const save = async () => {
    if (!key().trim()) return setProblem("Paste the API key.");
    setBusy(true);
    setProblem(null);
    try {
      const result = await aiConnectionsApi.create(company().id, {
        provider: provider() as AiProvider,
        method: "api_key",
        name: name().trim() || `${PROVIDER_LABEL[provider()]}, shared`,
        ownership: "shared",
        apiKey: key().trim(),
        agentIds: [],
        allAgents: false,
      });
      await client.invalidateQueries({ queryKey: queryKeys.aiConnections.list(company().id) });
      setKey("");
      setName("");
      props.onAdded(result.connectionId);
      props.onOpenChange(false);
    } catch (caught) {
      setProblem(failure(caught, "Couldn't save the connection."));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Dialog
      open={props.open}
      onOpenChange={props.onOpenChange}
      title="Add a shared connection"
      description={`An API key the whole organization can use ${props.purpose}. Calls are charged to it.`}
      width={520}
      footer={
        <>
          <Show when={problem()}>
            <span class="nt-error ps-foot-error" role="alert">
              {problem()}
            </span>
          </Show>
          <Button variant="quiet" disabled={busy()} onClick={() => props.onOpenChange(false)}>
            Cancel
          </Button>
          <Button variant="primary" disabled={busy()} onClick={() => void save()}>
            {busy() ? "Checking the key…" : "Add connection"}
          </Button>
        </>
      }
    >
      <div class="cs-dialog-body">
        <Show when={props.providers.length > 1}>
          <Segmented
            label="Provider"
            options={props.providers.map((value) => ({ value, label: PROVIDER_LABEL[value]! }))}
            value={provider()}
            onChange={setProvider}
          />
        </Show>
        <Field label="Name" for="cs-conn-name" help="Optional.">
          <TextInput id="cs-conn-name" value={name()} placeholder={`${PROVIDER_LABEL[provider()]}, shared`} onInput={(event) => setName(event.currentTarget.value)} />
        </Field>
        <Field label="API key" for="cs-conn-key">
          <TextInput id="cs-conn-key" type="password" autocomplete="new-password" value={key()} onInput={(event) => setKey(event.currentTarget.value)} />
        </Field>
      </div>
    </Dialog>
  );
}

/** A model ID field with the connection's suggestions. */
export function ModelField(props: { id: string; value: string; placeholder?: string; suggestions: readonly { id: string; label?: string }[] | undefined; onInput: (value: string) => void; disabled?: boolean }) {
  return (
    <>
      <TextInput
        id={props.id}
        class="mono cs-field-360"
        list={`${props.id}-list`}
        value={props.value}
        placeholder={props.placeholder}
        disabled={props.disabled}
        autocomplete="off"
        onInput={(event) => props.onInput(event.currentTarget.value)}
      />
      <datalist id={`${props.id}-list`}>
        <For each={props.suggestions ?? []}>{(model) => <option value={model.id}>{model.label ?? model.id}</option>}</For>
      </datalist>
    </>
  );
}

