import { createQueries, createQuery, useQueryClient } from "@tanstack/solid-query";
import { Download, MoreHorizontal, RefreshCw, Trash2 } from "lucide-solid";
import { createMemo, createSignal, For, Show, type JSX } from "solid-js";
import { adaptersApi, agentsApi } from "@/api/agents";
import { queryKeys } from "@/api/queryKeys";
import { useCompaniesQuery } from "@/lib/company";
import { InitialsDisc } from "@/ui/Avatar";
import { Button } from "@/ui/Button";
import { Dialog } from "@/ui/Dialog";
import { SettingsCard, TextInput } from "@/ui/Field";
import { Menu } from "@/ui/Menu";
import { Switch } from "@/ui/Switch";
import { pushToast } from "@/ui/Toast";
import {
  discName,
  groupHarnesses,
  HARNESS_STATE,
  harnessSummary,
  harnessUsage,
  parseInstallTarget,
  updateOffer,
  type HarnessRow,
} from "./app-settings-model";
import { failure, ListRow, SectionTitle, StatePill } from "./shared";

/*
 * Harnesses (board 29): the programs agents run in, named as the agent pages name them. In use lists
 * the built-in harnesses some agent uses, with how many; the other built-in ones are a grid of
 * switches; packages installed from npm (or a local folder) can be updated, reloaded and removed.
 * Turning a harness off hides it when hiring (`PATCH /api/adapters/:type`); agents already on it
 * keep it. An installed package that replaces a built-in harness is paused instead
 * (`PATCH /api/adapters/:type/override`).
 *
 * The API has no usage count, so agents are counted from each organization you can open; and npm's
 * registry is asked for an installed package's latest version, as the old UI does.
 */

async function npmLatest(packageName: string): Promise<string | null> {
  try {
    const res = await fetch(`https://registry.npmjs.org/${encodeURIComponent(packageName)}/latest`, { signal: AbortSignal.timeout(5000) });
    const data = (await res.json()) as { version?: unknown };
    return typeof data.version === "string" ? data.version : null;
  } catch {
    return null;
  }
}

export function HarnessesSection() {
  const client = useQueryClient();
  const companies = useCompaniesQuery();
  const adapters = createQuery(() => ({
    queryKey: queryKeys.instanceSettings.adapters,
    queryFn: ({ signal }: { signal: AbortSignal }) => adaptersApi.list(signal),
  }));
  const agentLists = createQueries(() => ({
    queries: (companies.data ?? []).map((company) => ({
      queryKey: queryKeys.agents.list(company.id),
      queryFn: () => agentsApi.list(company.id),
    })),
  }));
  const usage = createMemo(() => harnessUsage(agentLists.flatMap((query) => query.data ?? [])));
  const groups = createMemo(() => groupHarnesses(adapters.data ?? [], usage()));
  const [pending, setPending] = createSignal<string | null>(null);
  const [install, setInstall] = createSignal("");
  const [installProblem, setInstallProblem] = createSignal<string | null>(null);
  const [installing, setInstalling] = createSignal(false);
  const [removing, setRemoving] = createSignal<HarnessRow | null>(null);
  const [updating, setUpdating] = createSignal<{ row: HarnessRow; version: string } | null>(null);

  const refresh = () => client.invalidateQueries({ queryKey: queryKeys.instanceSettings.adapters });

  const act = async (type: string, work: () => Promise<unknown>, done: string | null, fallback: string) => {
    setPending(type);
    try {
      await work();
      await refresh();
      if (done) pushToast({ tone: "success", title: done });
      return true;
    } catch (caught) {
      pushToast({ tone: "error", title: fallback, body: failure(caught, "Try again.") });
      return false;
    } finally {
      setPending(null);
    }
  };

  const toggle = (row: HarnessRow, on: boolean) =>
    act(
      row.type,
      () => (row.replaces ? adaptersApi.setOverridePaused(row.type, !on) : adaptersApi.setDisabled(row.type, !on)),
      null,
      `Couldn't turn ${row.label} ${on ? "on" : "off"}`,
    );

  const submitInstall = async () => {
    const parsed = parseInstallTarget(install());
    if (!parsed.ok) return setInstallProblem(parsed.problem);
    setInstallProblem(null);
    setInstalling(true);
    try {
      const result = await adaptersApi.install(parsed.target);
      await refresh();
      setInstall("");
      pushToast({ tone: "success", title: `Installed ${result.packageName}${result.version ? ` ${result.version}` : ""}` });
    } catch (caught) {
      setInstallProblem(failure(caught, "Couldn't install the package."));
    } finally {
      setInstalling(false);
    }
  };

  const switchFor = (row: HarnessRow) => (
    <Switch
      checked={row.on}
      disabled={pending() === row.type || row.state === "failed"}
      onChange={(value) => void toggle(row, value)}
      label={row.replaces ? `Use ${row.label} instead of the built-in ${row.replaces}` : `Offer ${row.label} when hiring`}
      labelHidden
    />
  );

  return (
    <>
      <SectionTitle title="Harnesses">
        The programs agents run in, such as Claude Code and Codex. Turning one off hides it when hiring; agents already using it are not changed.
      </SectionTitle>
      <Show when={adapters.error}>
        <section class="card as-empty" role="alert">
          <p>{failure(adapters.error, "Couldn't load the harnesses.")}</p>
        </section>
      </Show>

      <Show when={groups().inUse.length}>
        <SettingsCard title="In use" aria-label="Harnesses in use">
          <For each={groups().inUse}>
            {(row) => (
              <ListRow mark={<InitialsDisc name={discName(row.label)} seed={row.type} size={32} />} title={row.label} mono={row.type} meta={harnessSummary(row)}>
                <StatePill {...HARNESS_STATE[row.state]} />
                {switchFor(row)}
              </ListRow>
            )}
          </For>
        </SettingsCard>
      </Show>

      <Show when={groups().otherBuiltIn.length}>
        <SettingsCard title="Other built-in harnesses" description="Not used by any agent yet. Only those turned on appear when hiring.">
          <div class="as-hgrid">
            <For each={groups().otherBuiltIn}>
              {(row) => (
                <div class="as-htile" classList={{ "as-htile--off": !row.on }}>
                  <div class="as-htile-text">
                    <div class="as-htile-name">{row.label}</div>
                    <div class="mono as-htile-type">{row.type}</div>
                  </div>
                  {switchFor(row)}
                </div>
              )}
            </For>
          </div>
        </SettingsCard>
      </Show>

      <SettingsCard
        title="Installed from npm"
        description="Harness packages added to this instance, from npm or a folder on the server."
        footer={
          <form
            class="as-install"
            onSubmit={(event) => {
              event.preventDefault();
              void submitInstall();
            }}
          >
            <TextInput
              class="mono as-install-field"
              value={install()}
              placeholder="npm package name, or a folder path"
              aria-label="Harness package to install"
              invalid={Boolean(installProblem())}
              onInput={(event) => {
                setInstall(event.currentTarget.value);
                setInstallProblem(null);
              }}
            />
            <Button type="submit" icon={<Download size={15} />} disabled={installing() || !install().trim()}>
              {installing() ? "Installing…" : "Install"}
            </Button>
            <Show when={installProblem()}>
              <span class="field-error as-install-problem" role="alert">
                {installProblem()}
              </span>
            </Show>
          </form>
        }
      >
        <For each={groups().installed} fallback={<p class="as-empty-line">No harness packages installed. Add one by its npm name, like @acme/paperclip-adapter@1.2.0.</p>}>
          {(row) => <InstalledHarness row={row} busy={pending() === row.type} switchFor={switchFor} onRemove={setRemoving} onUpdate={(version) => setUpdating({ row, version })} onReload={() => void act(row.type, () => adaptersApi.reload(row.type), `Reloaded ${row.label}`, `Couldn't reload ${row.label}`)} />}
        </For>
      </SettingsCard>

      <Dialog
        open={removing() !== null}
        onOpenChange={(open) => !open && setRemoving(null)}
        title={`Remove ${removing()?.label ?? "harness"}?`}
        description={
          removing() && removing()!.agents > 0
            ? `${removing()!.agents === 1 ? "1 agent uses" : `${removing()!.agents} agents use`} it, and can't run until you move ${removing()!.agents === 1 ? "it" : "them"} to another harness.`
            : "Agents can't be hired with it anymore. You can install it again later."
        }
        width={480}
        hideClose
        footer={
          <>
            <Button ghost onClick={() => setRemoving(null)}>
              Cancel
            </Button>
            <Button
              variant="danger"
              disabled={pending() !== null}
              onClick={async () => {
                const row = removing();
                if (row && (await act(row.type, () => adaptersApi.remove(row.type), `Removed ${row.label}`, `Couldn't remove ${row.label}`))) setRemoving(null);
              }}
            >
              Remove
            </Button>
          </>
        }
      />

      <Dialog
        open={updating() !== null}
        onOpenChange={(open) => !open && setUpdating(null)}
        title={`Update ${updating()?.row.label ?? "harness"} to ${updating()?.version ?? ""}?`}
        description="Paperclip pulls the latest version from npm and swaps it in. Agents use it from their next run."
        width={480}
        hideClose
        footer={
          <>
            <Button ghost onClick={() => setUpdating(null)}>
              Cancel
            </Button>
            <Button
              variant="primary"
              disabled={pending() !== null}
              onClick={async () => {
                const target = updating();
                if (!target) return;
                const ok = await act(target.row.type, () => adaptersApi.reinstall(target.row.type), `Updated ${target.row.label}`, `Couldn't update ${target.row.label}`);
                if (ok) {
                  void client.invalidateQueries({ queryKey: queryKeys.instanceSettings.npmLatest(target.row.adapter.packageName ?? target.row.type) });
                  setUpdating(null);
                }
              }}
            >
              Update
            </Button>
          </>
        }
      />
    </>
  );
}

function InstalledHarness(props: {
  row: HarnessRow;
  busy: boolean;
  switchFor: (row: HarnessRow) => JSX.Element;
  onRemove: (row: HarnessRow) => void;
  onUpdate: (version: string) => void;
  onReload: () => void;
}) {
  const packageName = () => props.row.adapter.packageName ?? props.row.type;
  const latest = createQuery(() => ({
    queryKey: queryKeys.instanceSettings.npmLatest(packageName()),
    queryFn: () => npmLatest(packageName()),
    enabled: !props.row.adapter.isLocalPath,
    staleTime: 60 * 60_000,
  }));
  const offer = () => updateOffer(props.row.adapter, latest.data);
  return (
    <ListRow mark={<InitialsDisc name={discName(props.row.label)} seed={props.row.type} size={32} />} title={props.row.label} mono={packageName()} meta={harnessSummary(props.row)}>
      <Show when={offer()}>{(version) => <Button size="compact" disabled={props.busy} onClick={() => props.onUpdate(version())}>Update to {version()}</Button>}</Show>
      <StatePill {...HARNESS_STATE[props.row.state]} />
      {props.switchFor(props.row)}
      <Menu placement="bottom-end">
        <Menu.Trigger class="btn btn--icon btn--ghost btn--compact" aria-label={`More actions for ${props.row.label}`}>
          <MoreHorizontal size={16} />
        </Menu.Trigger>
        <Menu.Content label={`${props.row.label} actions`} width={220}>
          <Menu.Item icon={<RefreshCw size={15} />} disabled={props.busy} onSelect={props.onReload} description="Load the package again from disk">
            Reload
          </Menu.Item>
          <Menu.Item icon={<Trash2 size={15} />} danger onSelect={() => props.onRemove(props.row)}>
            Remove…
          </Menu.Item>
        </Menu.Content>
      </Menu>
    </ListRow>
  );
}
