import type { CompanySecret, UserSecretDefinition } from "@paperclipai/shared";
import { Check, Ellipsis } from "lucide-solid";
import { createSignal, For, Match, Show, Switch } from "solid-js";
import { secretsApi, type MyUserSecretEntry } from "@/api/secrets";
import { useCompany } from "@/lib/company";
import { Button } from "@/ui/Button";
import { Dialog } from "@/ui/Dialog";
import { Field, TextInput } from "@/ui/Field";
import { InfoTip } from "@/ui/InfoTip";
import { Menu } from "@/ui/Menu";
import { pushToast } from "@/ui/Toast";
import { missingMine, sortMine, whenLabel } from "./secrets-model";
import { SecretName } from "./SecretParts";
import { CardHead, CardNoteLine, failure } from "./shared";

/*
 * Secrets → My secrets (upstream's MyUserSecretsTab): every secret the organization asks each
 * member to provide, whether you've added your value, and adding, replacing or removing it. The key
 * stays visible: agents point people at a secret by it. The ones still waiting on you come first.
 */

export type MySecretTarget = { definition: UserSecretDefinition; secret: CompanySecret | null };

export function MySecrets(props: { entries: MyUserSecretEntry[] | undefined; loading: boolean; error: string | null; onSet: (target: MySecretTarget) => void; onChanged: () => Promise<unknown> }) {
  const company = useCompany();
  const [busy, setBusy] = createSignal<string | null>(null);
  const missing = () => missingMine(props.entries ?? []);

  const remove = async (entry: MyUserSecretEntry) => {
    if (!entry.secret) return;
    setBusy(entry.definition.id);
    try {
      await secretsApi.removeMySecret(company().id, entry.secret.id);
      await props.onChanged();
      pushToast({ tone: "success", title: "Removed your value", body: entry.definition.name });
    } catch (caught) {
      pushToast({ tone: "error", title: "Couldn't remove your value", body: failure(caught, "") || undefined });
    } finally {
      setBusy(null);
    }
  };

  return (
    <section class="card settings-card" aria-labelledby="sec-mine">
      <CardHead
        id="sec-mine"
        title={
          <span class="info-line">
            My secrets
            <InfoTip label="About my secrets">Values only you provide. Agents use them when they work for you. An admin decides which secrets each member provides.</InfoTip>
          </span>
        }
        note={missing() ? `${missing()} still ${missing() === 1 ? "needs" : "need"} your value.` : undefined}
      />
      <Switch>
        <Match when={props.error}>
          <CardNoteLine alert>Couldn't load your secrets. {props.error}</CardNoteLine>
        </Match>
        <Match when={props.loading}>
          <CardNoteLine>Loading…</CardNoteLine>
        </Match>
        <Match when={(props.entries?.length ?? 0) === 0}>
          <CardNoteLine>Nothing is asked of you yet.</CardNoteLine>
        </Match>
        <Match when={true}>
          <For each={sortMine(props.entries ?? [])}>
            {(entry) => {
              const off = () => entry.definition.status !== "active";
              const replaced = () => (entry.secret && entry.secret.latestVersion > 1 && entry.secret.lastRotatedAt ? entry.secret.lastRotatedAt : null);
              return (
                <div class="cs-lrow cs-lrow--wrap" data-testid={`my-secret-${entry.definition.id}`}>
                  <div class="cs-person-text cs-grow">
                    <span class="cs-inline">
                      <SecretName name={entry.definition.name} full />
                      <code class="mono cs-muted cs-small">{entry.definition.key}</code>
                    </span>
                    <Show when={entry.definition.description}>
                      <span class="cs-muted">{entry.definition.description}</span>
                    </Show>
                    <Show when={entry.definition.usageGuidance}>
                      <span class="cs-muted">{entry.definition.usageGuidance}</span>
                    </Show>
                    <Show when={off()}>
                      <span class="cs-muted">Turned off by an admin. Agents won't ask for it.</span>
                    </Show>
                    <Show when={!off() && entry.secret && entry.secret.status !== "active"}>
                      <span class="cs-muted">Your value is turned off. Replace it to use it again.</span>
                    </Show>
                  </div>
                  <Show
                    when={entry.secret}
                    fallback={
                      <Show when={!off()}>
                        <Button size="compact" variant="primary" onClick={() => props.onSet({ definition: entry.definition, secret: null })}>
                          Set value
                        </Button>
                      </Show>
                    }
                  >
                    {(secret) => (
                      <span class="cs-inline">
                        <span class="cs-muted cs-inline">
                          <Check size={13} aria-hidden="true" />
                          {replaced() ? `Replaced ${whenLabel(replaced())}` : `Added ${whenLabel(secret().createdAt)}`}
                        </span>
                        <Show when={!off()}>
                          <Button size="compact" variant="quiet" onClick={() => props.onSet({ definition: entry.definition, secret: secret() })}>
                            Replace
                          </Button>
                        </Show>
                        <Menu placement="bottom-end">
                          <Menu.Trigger as={Button} variant="icon" ghost size="compact" aria-label={`More actions for ${entry.definition.name}`} disabled={busy() === entry.definition.id}>
                            <Ellipsis size={16} aria-hidden="true" />
                          </Menu.Trigger>
                          <Menu.Content label="My secret actions" width={220}>
                            <Menu.Item danger onSelect={() => void remove(entry)}>
                              Remove your value
                            </Menu.Item>
                          </Menu.Content>
                        </Menu>
                      </span>
                    )}
                  </Show>
                </div>
              );
            }}
          </For>
        </Match>
      </Switch>
    </section>
  );
}

/** Set or replace your own value for a secret each user provides. */
export function MySecretDialog(props: { target: MySecretTarget | null; onClose: () => void; onSaved: () => Promise<unknown> }) {
  const company = useCompany();
  const [value, setValue] = createSignal("");
  const [busy, setBusy] = createSignal(false);
  const [problem, setProblem] = createSignal<string | null>(null);

  const save = async () => {
    const target = props.target;
    if (!target) return;
    if (!value()) return setProblem("Paste your value.");
    setBusy(true);
    setProblem(null);
    try {
      if (target.secret) await secretsApi.rotateMySecret(company().id, target.secret.id, value());
      else await secretsApi.setMySecret(company().id, target.definition.id, value());
      await props.onSaved();
      pushToast({ tone: "success", title: `Saved your ${target.definition.key}` });
      setValue("");
      props.onClose();
    } catch (caught) {
      setProblem(failure(caught, "Couldn't save it."));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Dialog
      open={!!props.target}
      onOpenChange={(open) => {
        if (open) return;
        setValue("");
        setProblem(null);
        props.onClose();
      }}
      title={props.target?.secret ? `Update my value · ${props.target.definition.name}` : `Set my value · ${props.target?.definition.name ?? ""}`}
      description={props.target?.definition.usageGuidance ?? props.target?.definition.description ?? undefined}
      width={480}
      footer={
        <>
          <Show when={problem()}>
            <span class="nt-error ps-foot-error" role="alert">
              {problem()}
            </span>
          </Show>
          <Button variant="quiet" disabled={busy()} onClick={props.onClose}>
            Cancel
          </Button>
          <Button variant="primary" disabled={busy()} onClick={() => void save()}>
            {busy() ? "Saving…" : "Save value"}
          </Button>
        </>
      }
    >
      <div class="cs-dialog-body">
        <Field
          label={
            <span class="info-line">
              {props.target?.secret ? "New value" : "Value"}
              <InfoTip label="About your value">Only runs you're responsible for use it. It's never shown again after you save it.</InfoTip>
            </span>
          }
          for="sec-my-value"
        >
          <TextInput id="sec-my-value" type="password" autocomplete="new-password" value={value()} onInput={(event) => setValue(event.currentTarget.value)} />
        </Field>
      </div>
    </Dialog>
  );
}
