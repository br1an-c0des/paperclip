import type { ConnectToolApp, ConnectToolAppResult, McpJsonImportDraft, McpJsonImportPreview, ToolAppConnectionActionSummary } from "@paperclipai/shared";
import { A } from "@solidjs/router";
import { createMutation } from "@tanstack/solid-query";
import { KeyRound } from "lucide-solid";
import { createMemo, createSignal, For, Show } from "solid-js";
import { createStore } from "solid-js/store";
import { toolAccessApi } from "@/api/tool-access";
import { toolsApi } from "@/api/tools";
import { useCompany } from "@/lib/company";
import { Button } from "@/ui/Button";
import { Field, TextArea, TextInput } from "@/ui/Field";
import { Switch as Toggle } from "@/ui/Switch";
import { pushToast } from "@/ui/Toast";
import { connectFailure, errorCode, finishDefaults } from "../apps-model";
import { failureText, useRefreshTools } from "../shared";
import { credentialKey, credentialValues, draftSummary, draftUrl, humanizeKey, missingKeys, pasteProblem, SAMPLE_CONFIG } from "./paste-model";

/*
 * Advanced → Paste a config (`/apps/advanced/paste-config`, the old UI's PasteConfigTab): paste the
 * MCP config a tool's README gives, see what Paperclip found in it, then check a remote server's
 * actions and turn it on for every agent. A server that signs in with OAuth leaves for its sign-in
 * and comes back to its connection's page. Commands that run in a workspace stay drafts until an
 * admin maps them to an approved template.
 */

export function PasteConfig() {
  const company = useCompany();
  const refresh = useRefreshTools();
  const [text, setText] = createSignal("");
  const [preview, setPreview] = createSignal<McpJsonImportPreview | null>(null);
  const [names, setNames] = createStore<Record<string, string>>({});
  const [keys, setKeys] = createStore<Record<string, string>>({});
  const [result, setResult] = createSignal<ConnectToolAppResult | null>(null);
  const [checking, setChecking] = createSignal<string | null>(null);
  const [enabled, setEnabled] = createStore<Record<string, boolean>>({});
  const [done, setDone] = createSignal<{ id: string; name: string } | null>(null);
  const problem = () => pasteProblem(text());

  const read = createMutation(() => ({
    mutationFn: () => toolAccessApi.importMcpJson(company().id, text()),
    onSuccess: (found) => {
      setPreview(found);
      for (const draft of found.drafts) setNames(draft.name, draft.name);
      setResult(null);
      setDone(null);
    },
  }));

  const check = createMutation(() => ({
    mutationFn: async (draft: McpJsonImportDraft) => {
      const link = draftUrl(draft);
      if (!link) throw new Error("Only servers with a web address can be checked here.");
      setChecking(draft.name);
      return toolsApi.connectApp(company().id, { link, name: names[draft.name]?.trim() || draft.name, credentialValues: credentialValues(draft, keys) } as ConnectToolApp);
    },
    onSuccess: async (found) => {
      void refresh();
      if (found.auth?.kind === "oauth") {
        if (found.auth.manualClientRequired) {
          pushToast({
            title: "This server needs your own OAuth app",
            body: "Finish it from Connect your own server, with its client ID and secret.",
            tone: "warn",
          });
          return;
        }
        const start = found.auth.startUrl?.trim()
          ? { authorizationUrl: found.auth.startUrl.trim(), handoff: found.auth.handoff }
          : await toolsApi.startOAuth(found.connectionId);
        if (start.handoff) {
          pushToast({ title: "Can't sign in from here", body: "This server signs in through Paperclip Cloud, which this board can't hand off to yet.", tone: "error" });
          return;
        }
        window.location.assign(start.authorizationUrl);
        return;
      }
      setResult(found);
      for (const id of finishDefaults(found).enabled) setEnabled(id, true);
    },
    onError: (error) => pushToast({ title: "Couldn't check that server", body: connectFailure(errorCode(error), error instanceof Error ? error.message : null), tone: "error" }),
    onSettled: () => setChecking(null),
  }));

  const finish = createMutation(() => ({
    mutationFn: () => {
      const current = result()!;
      const on = new Set(Object.entries(enabled).filter(([, value]) => value).map(([id]) => id));
      const ask = finishDefaults(current).askFirst.filter((id) => on.has(id));
      return toolsApi.finishApp(company().id, current.connectionId, { enabledCatalogEntryIds: [...on], askFirstCatalogEntryIds: ask, access: "all_agents" });
    },
    onSuccess: () => {
      const current = result()!;
      setDone({ id: current.connectionId, name: current.application.name });
      pushToast({ title: `${current.application.name} is on`, body: "Every agent can use it. Narrow that on its page.", tone: "success" });
    },
    onError: (error) => pushToast({ title: "Couldn't turn it on", body: failureText(error, "Please try again."), tone: "error" }),
    onSettled: () => refresh(),
  }));

  return (
    <>
      <section class="card ap-card" aria-labelledby="pc-paste">
        <header class="chead">
          <h3 id="pc-paste" class="disp">
            Paste a config
          </h3>
          <p>
            For tools that aren't in the gallery: paste the MCP config snippet from the tool's README and Paperclip shows what it found before anything is saved.
            Just an address? <A href={`/${company().issuePrefix}/apps/byo`}>Connect your own server</A> instead.
          </p>
        </header>
        <form
          class="tl-form"
          onSubmit={(event) => {
            event.preventDefault();
            if (text().trim() && !problem()) read.mutate();
          }}
        >
          <Field label="MCP config" for="pc-config" error={problem() ?? undefined} help={'The JSON with "mcpServers" in it.'}>
            <TextArea
              id="pc-config"
              class="tl-textarea"
              spellcheck={false}
              rows={10}
              placeholder={SAMPLE_CONFIG}
              value={text()}
              onInput={(event) => {
                setText(event.currentTarget.value);
                setPreview(null);
                setResult(null);
                setDone(null);
              }}
            />
          </Field>
          <Show when={read.error}>
            <p class="cx-note cx-note--error" role="alert">
              {failureText(read.error, "Paperclip couldn't read that config.")}
            </p>
          </Show>
          <div class="cx-actions">
            <Button type="submit" variant="primary" disabled={!text().trim() || Boolean(problem()) || read.isPending}>
              {read.isPending ? "Reading…" : "Check config"}
            </Button>
          </div>
        </form>
      </section>

      <Show when={preview()}>
        {(found) => (
          <section class="card ap-card" aria-labelledby="pc-found">
            <header class="chead">
              <h3 id="pc-found" class="disp">
                {found().drafts.length === 0 ? "No apps found" : `Found ${found().drafts.length} ${found().drafts.length === 1 ? "app" : "apps"}`}
              </h3>
              <p>
                {found().drafts.length === 0
                  ? "Check you pasted the whole snippet."
                  : found().drafts.some((draft) => draftUrl(draft))
                    ? "Checking a server makes a draft connection, keeps any keys as Paperclip secrets, and lists its actions before you turn it on."
                    : "These run in a workspace, so they stay drafts until an admin maps them to an approved template."}
              </p>
            </header>
            <ul class="ap-rows">
              <For each={found().drafts}>
                {(draft) => (
                  <DraftRow
                    draft={draft}
                    name={names[draft.name] ?? draft.name}
                    onName={(value) => setNames(draft.name, value)}
                    keys={keys}
                    onKey={(path, value) => setKeys(credentialKey(draft, path), value)}
                    checking={checking() === draft.name}
                    disabled={check.isPending || Boolean(result())}
                    onCheck={() => check.mutate(draft)}
                  />
                )}
              </For>
            </ul>
          </section>
        )}
      </Show>

      <Show when={result()}>
        {(found) => <Review result={found()} enabled={enabled} onToggle={(id, on) => setEnabled(id, on)} busy={finish.isPending} done={done()} onFinish={() => finish.mutate()} />}
      </Show>
    </>
  );
}

function DraftRow(props: {
  draft: McpJsonImportDraft;
  name: string;
  onName: (value: string) => void;
  keys: Record<string, string>;
  onKey: (configPath: string, value: string) => void;
  checking: boolean;
  disabled: boolean;
  onCheck: () => void;
}) {
  const url = () => draftUrl(props.draft);
  const missing = () => missingKeys(props.draft, props.keys);
  return (
    <li class="ap-row tl-draft" style={{ "flex-direction": "column", "align-items": "stretch" }}>
      <div class="ap-inline">
        <div class="ap-row-main">
          <span class="ap-row-name">{props.draft.name}</span>
          <span class="ap-row-meta">{draftSummary(props.draft)}</span>
        </div>
        <Show when={url()}>
          <Button size="compact" variant="primary" disabled={props.disabled || missing().length > 0} onClick={() => props.onCheck()}>
            {props.checking ? "Checking…" : "Check actions"}
          </Button>
        </Show>
      </div>
      <Show when={url()}>
        <Field label="Connection name" for={`pc-name-${props.draft.name}`}>
          <TextInput id={`pc-name-${props.draft.name}`} maxLength={160} value={props.name} onInput={(event) => props.onName(event.currentTarget.value)} />
        </Field>
      </Show>
      <Show
        when={props.draft.credentialFields.length > 0}
        fallback={
          <p class="cx-note">
            {props.draft.credentialRefs.length > 0 ? "Its keys stay in the draft until an admin maps it to an approved template." : "No keys needed for this one."}
          </p>
        }
      >
        <For each={props.draft.credentialFields}>
          {(field) => (
            <Field
              label={
                <>
                  <KeyRound size={13} aria-hidden="true" /> {humanizeKey(field.label || field.key)}
                  {field.required ? "" : " (optional)"}
                </>
              }
              for={`pc-key-${props.draft.name}-${field.configPath}`}
              help={<span class="mono">{field.key}</span>}
            >
              <TextInput
                id={`pc-key-${props.draft.name}-${field.configPath}`}
                type="password"
                autocomplete="new-password"
                placeholder="Paste the value"
                value={props.keys[credentialKey(props.draft, field.configPath)] ?? ""}
                onInput={(event) => props.onKey(field.configPath, event.currentTarget.value)}
              />
            </Field>
          )}
        </For>
      </Show>
      <For each={props.draft.warnings}>
        {(warning) => (
          <p class="cx-note cx-note--warn" role="note">
            {warning}
          </p>
        )}
      </For>
    </li>
  );
}

function Review(props: {
  result: ConnectToolAppResult;
  enabled: Record<string, boolean>;
  onToggle: (id: string, on: boolean) => void;
  busy: boolean;
  done: { id: string; name: string } | null;
  onFinish: () => void;
}) {
  const company = useCompany();
  const ask = createMemo(() => new Set(finishDefaults(props.result).askFirst));
  const total = () => props.result.actions.readOnly.length + props.result.actions.canMakeChanges.length;
  const count = () => Object.values(props.enabled).filter(Boolean).length;
  const group = (title: string, actions: ToolAppConnectionActionSummary[]) => (
    <Show when={actions.length > 0}>
      <div class="ap-group">
        <div class="ap-group-head">
          <h4 class="ap-group-title">{title}</h4>
          <span class="ap-inline">
            <Button size="compact" variant="quiet" disabled={Boolean(props.done)} onClick={() => actions.forEach((action) => props.onToggle(action.catalogEntryId, true))}>
              All on
            </Button>
            <Button size="compact" variant="quiet" disabled={Boolean(props.done)} onClick={() => actions.forEach((action) => props.onToggle(action.catalogEntryId, false))}>
              All off
            </Button>
          </span>
        </div>
        <ul class="ap-rows">
          <For each={actions}>
            {(action) => (
              <li class="ap-action">
                <div class="ap-row-main">
                  <span class="ap-row-name">{action.title || action.toolName}</span>
                  <span class="ap-row-meta">{ask().has(action.catalogEntryId) ? "Asks first when on" : action.riskLevel}</span>
                </div>
                <Toggle
                  checked={props.enabled[action.catalogEntryId] ?? false}
                  disabled={Boolean(props.done)}
                  onChange={(on) => props.onToggle(action.catalogEntryId, on)}
                  label={action.title || action.toolName}
                  labelHidden
                />
              </li>
            )}
          </For>
        </ul>
      </div>
    </Show>
  );
  return (
    <section class="card ap-card" aria-labelledby="pc-review">
      <header class="chead ap-chead">
        <div>
          <h3 id="pc-review" class="disp">
            Actions in {props.result.application.name}
          </h3>
          <p>It answered and listed its actions. Pick the ones agents may use; you can narrow who uses it on its page afterwards.</p>
        </div>
        <Show
          when={props.done}
          fallback={
            <Button size="compact" variant="primary" disabled={props.busy || count() === 0} onClick={() => props.onFinish()}>
              {props.busy ? "Turning on…" : `Turn on ${count()} of ${total()}`}
            </Button>
          }
        >
          {(found) => (
            <A class="tl-rowlink" href={`/${company().issuePrefix}/apps/${found().id}/permissions`}>
              Open {found().name}
            </A>
          )}
        </Show>
      </header>
      <Show when={total() > 0} fallback={<p class="ap-empty">It didn't list any actions yet. Turn it on and check for new actions from its page.</p>}>
        {group("Reads", props.result.actions.readOnly)}
        {group("Makes changes", props.result.actions.canMakeChanges)}
      </Show>
    </section>
  );
}
