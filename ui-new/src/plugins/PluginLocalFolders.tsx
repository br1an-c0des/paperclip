import type { PluginLocalFolderDeclaration } from "@paperclipai/shared";
import { createQuery, useQueryClient } from "@tanstack/solid-query";
import { createEffect, createMemo, createSignal, For, on, Show } from "solid-js";
import { pluginsApi, type PluginLocalFolderStatus } from "@/api/plugins";
import { queryKeys } from "@/api/queryKeys";
import { Button } from "@/ui/Button";
import { SettingsCard, TextInput } from "@/ui/Field";
import { TonePill } from "@/ui/Status";
import { folderAccess, folderChecks, folderPathProblem, folderRequirements, folderSaveInput, savedMessage } from "./local-folders-model";

/*
 * A plugin's local folders (the manifest's `localFolders`), in its settings: folders on the server a
 * trusted plugin reads, or reads and writes, chosen per organization. Each shows whether it's set,
 * readable and writable, what the plugin requires inside it and what's missing, and the server's
 * problems. Save checks the path and stores it (`PUT …/local-folders/:folderKey`); the answer is
 * the folder's new status. The old page's "Choose" button only explained how to copy a path, so a
 * plain path field stands in for it.
 */

export function PluginLocalFolders(props: { pluginId: string; companyId: string; declarations: PluginLocalFolderDeclaration[] }) {
  const folders = createQuery(() => ({
    queryKey: queryKeys.plugins.localFolders(props.pluginId, props.companyId),
    queryFn: ({ signal }) => pluginsApi.localFolders(props.pluginId, props.companyId, signal),
    retry: false,
  }));
  const statusFor = (key: string) => folders.data?.folders.find((folder) => folder.folderKey === key);
  return (
    <SettingsCard title="Folders" description="Folders on the server this plugin works in, for this organization.">
      <div class="plf">
        <Show when={folders.isError}>
          <p class="field-error" role="alert">
            Couldn't load the folders: {(folders.error as Error).message}
          </p>
        </Show>
        <Show
          when={!folders.isLoading}
          fallback={
            <p class="sf-muted" role="status">
              Loading the folders…
            </p>
          }
        >
          <For each={props.declarations}>
            {(declaration) => (
              <FolderRow pluginId={props.pluginId} companyId={props.companyId} declaration={declaration} status={statusFor(declaration.folderKey)} />
            )}
          </For>
        </Show>
      </div>
    </SettingsCard>
  );
}

function FolderRow(props: { pluginId: string; companyId: string; declaration: PluginLocalFolderDeclaration; status?: PluginLocalFolderStatus }) {
  const client = useQueryClient();
  const saved = () => props.status?.path ?? "";
  const [path, setPath] = createSignal(saved());
  const [saving, setSaving] = createSignal(false);
  const [message, setMessage] = createSignal<{ tone: "ok" | "bad"; text: string } | null>(null);
  // A new saved path (a save, or another tab's) replaces what's typed.
  createEffect(on(saved, (next) => (setPath(next), setMessage(null)), { defer: true }));

  const access = () => folderAccess(props.declaration, props.status);
  const checks = createMemo(() => folderChecks(props.declaration, props.status));
  const requirements = createMemo(() => folderRequirements(props.declaration, props.status));
  const dirty = () => path().trim() !== saved();
  const inputId = () => `plf-${props.pluginId}-${props.declaration.folderKey}`;

  const save = async () => {
    const problem = folderPathProblem(path());
    if (problem) return setMessage({ tone: "bad", text: problem });
    setMessage(null);
    setSaving(true);
    try {
      const next = await pluginsApi.configureLocalFolder(props.pluginId, props.companyId, props.declaration.folderKey, folderSaveInput(props.declaration, path()));
      setMessage({ tone: next.healthy ? "ok" : "bad", text: savedMessage(next) });
      await client.invalidateQueries({ queryKey: queryKeys.plugins.localFolders(props.pluginId, props.companyId) });
    } catch (caught) {
      setMessage({ tone: "bad", text: caught instanceof Error && caught.message ? caught.message : "Couldn't save the folder." });
    } finally {
      setSaving(false);
    }
  };

  return (
    <section class="plf-folder" aria-label={props.declaration.displayName}>
      <header class="plf-head">
        <div class="plf-title">
          <h4>{props.declaration.displayName}</h4>
          <code>{props.declaration.folderKey}</code>
        </div>
        <div class="plf-pills">
          <TonePill tone={props.status?.healthy ? "green" : "amber"} compact>
            {props.status?.healthy ? "Healthy" : "Needs attention"}
          </TonePill>
          <span class="plf-access">{access() === "readWrite" ? "Read and write" : "Read only"}</span>
        </div>
      </header>
      <Show when={props.declaration.description}>{(text) => <p class="plf-about">{text()}</p>}</Show>

      <dl class="plf-checks">
        <For each={checks()}>
          {(check) => (
            <div class="plf-check">
              <dt>{check.label}</dt>
              <dd classList={{ "ps-ok": check.ok, "ps-bad": !check.ok }}>{check.value}</dd>
            </div>
          )}
        </For>
      </dl>

      <div class="field-stack">
        <label class="field-label" for={inputId()}>
          Folder path
        </label>
        <div class="plf-path">
          <TextInput
            id={inputId()}
            class="plf-input"
            value={path()}
            placeholder="/absolute/path/to/folder"
            spellcheck={false}
            autocomplete="off"
            onInput={(event) => (setPath(event.currentTarget.value), setMessage(null))}
            onKeyDown={(event) => event.key === "Enter" && dirty() && !saving() && void save()}
          />
          <Button variant="primary" size="compact" disabled={!dirty() || saving()} onClick={() => void save()}>
            {saving() ? "Saving…" : "Save"}
          </Button>
        </div>
        <Show when={props.status?.realPath && props.status.realPath !== props.status.path}>
          <span class="fhelp">Resolves to {props.status!.realPath}</span>
        </Show>
      </div>

      <Show when={requirements().length > 0}>
        <div class="plf-reqs">
          <For each={requirements()}>
            {(requirement) => (
              <div class="plf-req">
                <div class="plf-req-head">
                  <span>{requirement.title}</span>
                  <Show when={requirement.state.tone} fallback={<span class="plf-access">{requirement.state.label}</span>}>
                    {(tone) => (
                      <TonePill tone={tone()} compact>
                        {requirement.state.label}
                      </TonePill>
                    )}
                  </Show>
                </div>
                <Show when={requirement.items.length > 0} fallback={<p class="plf-about">None.</p>}>
                  <ul class="plf-items">
                    <For each={requirement.items}>
                      {(item) => <li classList={{ "plf-item--missing": requirement.missing.includes(item) }}>{item}</li>}
                    </For>
                  </ul>
                </Show>
              </div>
            )}
          </For>
        </div>
      </Show>

      <Show when={props.status?.problems.length}>
        <ul class="plf-problems" role="alert">
          <For each={props.status!.problems}>
            {(problem) => (
              <li>
                {problem.message}
                <Show when={problem.path}>{(where) => <code> {where()}</code>}</Show>
              </li>
            )}
          </For>
        </ul>
      </Show>

      <Show when={message()}>
        {(current) => (
          <p class={current().tone === "ok" ? "sf-result sf-result--ok" : "field-error"} role={current().tone === "ok" ? "status" : "alert"}>
            {current().text}
          </p>
        )}
      </Show>
    </section>
  );
}
