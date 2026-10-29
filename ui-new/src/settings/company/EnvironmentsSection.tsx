import type { Environment, EnvironmentDeleteBlastRadius, EnvironmentProbeResult } from "@paperclipai/shared";
import { createQuery, useQueryClient } from "@tanstack/solid-query";
import { Ellipsis, Plus, Server } from "lucide-solid";
import { createMemo, createSignal, For, Show } from "solid-js";
import { createStore } from "solid-js/store";
import { environmentsApi } from "@/api/environments";
import { instanceSettingsApi } from "@/api/instance-settings";
import { queryKeys } from "@/api/queryKeys";
import { useCompany } from "@/lib/company";
import { Button } from "@/ui/Button";
import { Dialog } from "@/ui/Dialog";
import { Menu } from "@/ui/Menu";
import { TonePill } from "@/ui/Status";
import { pushToast } from "@/ui/Toast";
import { EnvironmentDialog, type EnvironmentEdit } from "./EnvironmentDialog";
import { defaultPatchId, deleteSummary, driverLabel, effectiveDefaultId, environmentSummary, isManaged, sortEnvironments } from "./environments-model";
import { CardHead, CardNoteLine, failure, OutlineCard, SectionTitle } from "./shared";

/*
 * Environments (board 30's outline): where this organization's agents run. The API is per company,
 * so this moved here from instance settings. Each environment can be probed (what it can do, and on
 * a sandbox the qualification the Paperclip Runner needs), archived or restored, and deleted once
 * nothing depends on it. The default is the instance's (`PATCH /instance/settings`), so making one
 * the default reaches every organization; the section says so where it's shown and set.
 *
 * New environment and Edit open a dialog (EnvironmentDialog.tsx): an SSH host or a sandbox
 * provider's settings, and the variables runs there get. Custom sandbox images and the terminal are
 * on hold (decision 39, D7).
 */

export function EnvironmentsSection() {
  const company = useCompany();
  const client = useQueryClient();
  const environments = createQuery(() => ({
    queryKey: queryKeys.projectSettings.environments(company().id),
    queryFn: ({ signal }) => environmentsApi.list(company().id, signal),
  }));
  const instance = createQuery(() => ({ queryKey: queryKeys.companySettings.instanceSettings, queryFn: instanceSettingsApi.settings }));
  const defaultId = createMemo(() => effectiveDefaultId(instance.data?.defaultEnvironmentId, environments.data));
  const isDefault = (environment: Environment) => environment.id === defaultId();
  const list = createMemo(() => sortEnvironments(environments.data, defaultId()));
  const [probes, setProbes] = createStore<Record<string, EnvironmentProbeResult | "running" | { error: string }>>({});
  const [deleting, setDeleting] = createSignal<Environment | null>(null);
  const [editing, setEditing] = createSignal<EnvironmentEdit | null>(null);
  const capabilities = createQuery(() => ({
    queryKey: queryKeys.companySettings.environmentCapabilities(company().id),
    queryFn: ({ signal }) => environmentsApi.capabilities(company().id, signal),
    retry: false,
  }));
  const providerName = (environment: Environment) => {
    const key = typeof environment.config?.provider === "string" ? environment.config.provider : "";
    return key ? (capabilities.data?.sandboxProviders?.[key]?.displayName ?? key) : undefined;
  };
  const refresh = () => client.invalidateQueries({ queryKey: queryKeys.projectSettings.environments(company().id) });

  const probe = async (environment: Environment) => {
    setProbes(environment.id, "running");
    try {
      setProbes(environment.id, await environmentsApi.probe(environment.id, company().id));
    } catch (caught) {
      setProbes(environment.id, { error: failure(caught, "The probe couldn't run.") });
    }
  };
  const setStatus = async (environment: Environment, status: "active" | "archived") => {
    try {
      await environmentsApi.update(environment.id, company().id, { status });
      await refresh();
      pushToast({ tone: "success", title: status === "archived" ? `Archived ${environment.name}` : `Restored ${environment.name}` });
    } catch (caught) {
      pushToast({ tone: "error", title: "Couldn't change the environment", body: failure(caught, "") || undefined });
    }
  };

  const makeDefault = async (environment: Environment) => {
    try {
      await instanceSettingsApi.update({ defaultEnvironmentId: defaultPatchId(environment) });
      await client.invalidateQueries({ queryKey: queryKeys.companySettings.instanceSettings });
      pushToast({ tone: "success", title: `${environment.name} is the default`, body: "For every organization on this instance." });
    } catch (caught) {
      pushToast({ tone: "error", title: "Couldn't change the default", body: failure(caught, "") || undefined });
    }
  };

  return (
    <>
      <SectionTitle title="Environments">Where this organization's agents run.</SectionTitle>
      <section class="card settings-card" aria-labelledby="cs-envs">
        <CardHead
          id="cs-envs"
          title="Environments"
          note={environments.data ? `${list().filter((entry) => entry.status === "active").length} active` : "Loading…"}
          actions={
            <Button size="compact" variant="primary" icon={<Plus size={14} aria-hidden="true" />} onClick={() => setEditing({ mode: "new" })}>
              New environment
            </Button>
          }
        />
        <CardNoteLine>
          The default is instance-wide: agents in every organization on this instance that haven't picked an environment run
          there.
        </CardNoteLine>
        <Show when={environments.isError}>
          <CardNoteLine alert>Couldn't load the environments. {failure(environments.error, "")}</CardNoteLine>
        </Show>
        <For each={list()} fallback={<Show when={environments.data}><CardNoteLine>No environments.</CardNoteLine></Show>}>
          {(environment) => {
            const result = () => probes[environment.id];
            return (
              <div class="cs-lrow cs-lrow--wrap" classList={{ "cs-lrow--quiet": environment.status === "archived" }}>
                <div class="cs-person cs-grow">
                  <span class="cs-conn-mark" aria-hidden="true">
                    <Server size={15} />
                  </span>
                  <span class="cs-person-text">
                    <span class="cs-strong">
                      {environment.name}
                      <Show when={isDefault(environment)}>
                        <span class="cs-pill" title="The default for every organization on this instance">
                          Instance default
                        </span>
                      </Show>
                      <Show when={environment.status === "archived"}>
                        <span class="cs-pill">Archived</span>
                      </Show>
                    </span>
                    <span class="cs-muted">{[driverLabel(environment.driver), isManaged(environment) ? "managed by Paperclip" : null, environmentSummary(environment, providerName(environment)), environment.description]
                        .filter(Boolean)
                        .join(" · ")}</span>
                    <Show when={result()}>
                      {(found) => {
                        const value = found();
                        if (value === "running") return <span class="fhelp">Probing…</span>;
                        if ("error" in value) return <span class="fhelp cs-bad">{value.error}</span>;
                        return (
                          <span class="fhelp">
                            <TonePill tone={value.ok ? "green" : "red"} compact>
                              {value.ok ? "Reachable" : "Problem"}
                            </TonePill>{" "}
                            {value.summary}
                          </span>
                        );
                      }}
                    </Show>
                  </span>
                </div>
                <div class="cs-inline">
                  <Button size="compact" disabled={result() === "running" || environment.status === "archived"} onClick={() => void probe(environment)}>
                    Probe
                  </Button>
                  <Show when={environment.status === "active" || !isManaged(environment)}>
                    <Menu placement="bottom-end">
                      <Menu.Trigger as={Button} variant="icon" ghost size="compact" aria-label={`More actions for ${environment.name}`}>
                        <Ellipsis size={16} aria-hidden="true" />
                      </Menu.Trigger>
                      <Menu.Content label="Environment actions" width={260}>
                        <Show when={environment.status === "active"}>
                          <Menu.Item onSelect={() => setEditing({ mode: "edit", environment })} description={isManaged(environment) ? "Its variables" : "Settings and variables"}>
                            Edit…
                          </Menu.Item>
                        </Show>
                        <Show when={!isDefault(environment) && environment.status === "active"}>
                          <Menu.Item onSelect={() => void makeDefault(environment)} description="For every organization on this instance">
                            Make the default
                          </Menu.Item>
                        </Show>
                        <Show when={!isManaged(environment)}>
                          <Show when={environment.status === "active"}>
                            <Menu.Separator />
                          </Show>
                          <Show
                            when={environment.status === "archived"}
                            fallback={
                              <Menu.Item disabled={isDefault(environment)} onSelect={() => void setStatus(environment, "archived")} description="Agents can't pick it until it's restored">
                                Archive
                              </Menu.Item>
                            }
                          >
                            <Menu.Item onSelect={() => void setStatus(environment, "active")}>Restore</Menu.Item>
                          </Show>
                          <Menu.Separator />
                          <Menu.Item danger onSelect={() => setDeleting(environment)}>
                            Delete…
                          </Menu.Item>
                        </Show>
                      </Menu.Content>
                    </Menu>
                  </Show>
                </div>
              </div>
            );
          }}
        </For>
      </section>
      <OutlineCard
        note="On hold (decision 39, D7):"
        rows={[
          { name: "Custom images", text: "Set up a sandbox by hand, capture it as an image, and boot later runs from it." },
          { name: "Terminal", text: "Open a terminal in a sandbox environment." },
        ]}
        was="Instance settings → Environments"
      />
      <EnvironmentDialog edit={editing()} onClose={() => setEditing(null)} onSaved={refresh} />
      <DeleteEnvironmentDialog environment={deleting()} onClose={() => setDeleting(null)} onDeleted={refresh} />
    </>
  );
}

function DeleteEnvironmentDialog(props: { environment: Environment | null; onClose: () => void; onDeleted: () => Promise<unknown> }) {
  const radius = createQuery(() => ({
    queryKey: ["environments", "delete-blast-radius", props.environment?.id ?? ""],
    queryFn: ({ signal }) => environmentsApi.deleteBlastRadius(props.environment!.id, signal),
    enabled: !!props.environment,
    staleTime: 0,
  }));
  const [busy, setBusy] = createSignal(false);
  const summary = () => (radius.data ? deleteSummary(radius.data as EnvironmentDeleteBlastRadius) : null);

  const remove = async () => {
    const environment = props.environment;
    if (!environment) return;
    setBusy(true);
    try {
      await environmentsApi.remove(environment.id);
      await props.onDeleted();
      pushToast({ tone: "success", title: `Deleted ${environment.name}` });
      props.onClose();
    } catch (caught) {
      pushToast({ tone: "error", title: "Couldn't delete the environment", body: failure(caught, "") || undefined });
    } finally {
      setBusy(false);
    }
  };

  return (
    <Dialog
      open={!!props.environment}
      onOpenChange={(open) => !open && props.onClose()}
      title={`Delete ${props.environment?.name ?? ""}?`}
      width={460}
      hideClose
      footer={
        <>
          <Button variant="quiet" disabled={busy()} onClick={props.onClose}>
            Cancel
          </Button>
          <Button variant="danger" disabled={busy() || !summary()?.allowed} onClick={() => void remove()}>
            {busy() ? "Deleting…" : "Delete"}
          </Button>
        </>
      }
    >
      <div class="cs-dialog-body">
        <Show when={summary()} fallback={<p class="cs-muted">{radius.isError ? failure(radius.error, "Couldn't check what depends on it.") : "Checking what depends on it…"}</p>}>
          {(found) => (
            <>
              <p>{found().allowed ? (found().lines.length ? "Deleting it affects:" : "Nothing depends on it.") : "It can't be deleted:"}</p>
              <Show when={found().lines.length}>
                <ul class="cs-bullets">
                  <For each={found().lines}>{(line) => <li>{line}</li>}</For>
                </ul>
              </Show>
            </>
          )}
        </Show>
      </div>
    </Dialog>
  );
}
