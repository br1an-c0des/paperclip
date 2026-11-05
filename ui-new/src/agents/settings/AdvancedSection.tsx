import type { AgentDetail } from "@paperclipai/shared";
import { createQuery, useQueryClient } from "@tanstack/solid-query";
import { Copy, FileDiff, ListOrdered, RotateCcw } from "lucide-solid";
import { createEffect, createMemo, createSignal, For, on, onCleanup, Show, untrack } from "solid-js";
import { configurationClient } from "@/api/agent-configuration";
import { ApiError } from "@/api/client";
import { queryKeys } from "@/api/queryKeys";
import { useCompany } from "@/lib/company";
import { Button } from "@/ui/Button";
import { SettingsCard } from "@/ui/Field";
import { pushToast } from "@/ui/Toast";
import {
  ConfigurationSaveInterrupted,
  editorState,
  loadAgentConfiguration,
  planAgentConfiguration,
  saveAgentConfiguration,
  type AgentConfigurationSnapshot,
  type ConfigurationReceipt,
} from "../configuration-model";
import { compactAgentConfiguration, parseAgentConfigurationYaml, serializeAgentConfigurationDocument } from "../configuration-yaml";
import { diffHunks, diffSummary, lineDiff } from "../instructions-model";
import { failure, refreshAgent, SectionTitle } from "../shared";
import type { YamlEditorHandle } from "./cm-yaml-editor";
import "./Advanced.css";

/*
 * Advanced (`agents/configuration-yaml`, the old UI's Advanced tab): the agent's whole setup as one
 * `paperclip/v1` YAML document, edited as text and saved through each resource's own API. The model
 * is agents/configuration-model.ts; the text rules are agents/configuration-yaml.ts.
 *
 * - The document shown is the compact one: defaults, empty fields and instruction file contents are
 *   left out, and anything left out stays as saved.
 * - While the text differs from what's saved, the card below lists the steps a save would run, in
 *   order, or why it can't be saved; the text diff is one click away.
 * - Saving reloads first and refuses if the agent or an edited section changed meanwhile. A save that
 *   stops part-way lists what went through and what didn't, and asks for a reload.
 * - Created API keys show their token once, here; created secrets their id.
 * - Leaving the section keeps the draft (with the configuration it started from) until the page is
 *   reloaded, so switching sections doesn't lose it; closing the tab asks first.
 */

type Draft = { snapshot: AgentConfigurationSnapshot; source: string };
const drafts = new Map<string, Draft>();

const editableYaml = (snapshot: AgentConfigurationSnapshot) => serializeAgentConfigurationDocument(compactAgentConfiguration(snapshot.document));

export function AdvancedSection(props: { agent: AgentDetail }) {
  return (
    <>
      <SectionTitle title="Configuration as YAML">
        {props.agent.name}'s whole setup as one YAML document: profile, runtime, instructions, skills, tools, channels, permissions, secrets and
        keys. Anything you leave out stays as it is.
      </SectionTitle>
      <Show when={props.agent.id} keyed>
        {(agentId) => <ConfigurationLoader agent={props.agent} agentId={agentId} />}
      </Show>
    </>
  );
}

/** Loads the snapshot once per agent (or picks up the kept draft) and hands it to the editor. */
function ConfigurationLoader(props: { agent: AgentDetail; agentId: string }) {
  const company = useCompany();
  const kept = drafts.get(untrack(() => props.agentId)) ?? null;
  const query = createQuery(() => ({
    queryKey: queryKeys.agentConfiguration(company().id, props.agentId),
    queryFn: () => loadAgentConfiguration(configurationClient, props.agentId, company().id),
    enabled: !kept,
    refetchOnWindowFocus: false,
    staleTime: 0,
    gcTime: 0,
    retry: false,
  }));
  // The document reads every resource it covers; a refusal (403) won't go away on a retry.
  const denied = () => query.error instanceof ApiError && query.error.status === 403;
  // The first complete load (or the kept draft) seeds the editor; later refetches don't replace it.
  const initial = createMemo<Draft | null>(
    (previous) => previous ?? kept ?? (query.data && !query.isFetching ? { snapshot: query.data, source: editableYaml(query.data) } : null),
    null,
  );
  return (
    <Show
      when={initial()}
      fallback={
        <section class="card settings-card adv-loading" role={query.isError ? "alert" : "status"}>
          <Show when={query.isError} fallback={<p class="ps-list-note">Loading the configuration…</p>}>
            <Show
              when={!denied()}
              fallback={
                <p class="ps-list-note">
                  You can't read all of {props.agent.name}'s configuration, so it can't be shown as one document. {failure(query.error, "")}
                </p>
              }
            >
              <p class="ps-list-note">
                Couldn't load the configuration. {failure(query.error, "")}{" "}
                <Button size="compact" onClick={() => void query.refetch()}>
                  Try again
                </Button>
              </p>
            </Show>
          </Show>
        </section>
      }
    >
      {(draft) => <ConfigurationEditor agent={props.agent} initial={draft()} />}
    </Show>
  );
}

function ConfigurationEditor(props: { agent: AgentDetail; initial: Draft }) {
  const company = useCompany();
  const client = useQueryClient();
  const agentId = untrack(() => props.agent.id);
  const [saved, setSaved] = createSignal(untrack(() => props.initial.snapshot));
  const [source, setSource] = createSignal(untrack(() => props.initial.source));
  const [busy, setBusy] = createSignal<"save" | "reload" | null>(null);
  const [progress, setProgress] = createSignal("");
  const [error, setError] = createSignal<string | null>(null);
  const [interrupted, setInterrupted] = createSignal<ConfigurationSaveInterrupted | null>(null);
  const [receipts, setReceipts] = createSignal<ConfigurationReceipt[]>([]);
  const [showDiff, setShowDiff] = createSignal(false);
  const restored = untrack(() => drafts.has(agentId));

  const original = createMemo(() => editableYaml(saved()));
  const dirty = () => source() !== original();
  const plan = createMemo(() => {
    if (!dirty()) return { steps: [], error: null };
    try {
      const document = parseAgentConfigurationYaml(source());
      return { steps: planAgentConfiguration(configurationClient, saved(), document).map((step) => step.label), error: null };
    } catch (caught) {
      return { steps: [], error: caught instanceof Error ? caught.message : "This isn't valid YAML." };
    }
  });
  const state = createMemo(() => editorState(source(), original(), plan()));
  const diff = createMemo(() => (showDiff() && dirty() ? lineDiff(original(), source()) : []));
  const canSave = () => state().kind === "changes" && !busy() && !interrupted();

  // Keep the draft when the section unmounts; drop it once it matches what's saved.
  createEffect(() => {
    if (dirty() || interrupted()) drafts.set(agentId, { snapshot: saved(), source: source() });
    else drafts.delete(agentId);
  });
  const beforeUnload = (event: BeforeUnloadEvent) => {
    if (!dirty() && !busy()) return;
    event.preventDefault();
  };
  window.addEventListener("beforeunload", beforeUnload);
  onCleanup(() => window.removeEventListener("beforeunload", beforeUnload));

  const refreshEverything = async () => {
    const companyId = company().id;
    client.setQueryData(queryKeys.agentConfiguration(companyId, agentId), saved());
    const prefixes = new Set(["tools", "chat-endpoints", "secrets", "secret-proposals"]);
    await Promise.all([
      refreshAgent(client, companyId, agentId),
      client.invalidateQueries({ predicate: (each) => prefixes.has(String(each.queryKey[0])) && each.queryKey[1] === companyId }),
    ]);
  };

  const adopt = (snapshot: AgentConfigurationSnapshot) => {
    setSaved(snapshot);
    setSource(editableYaml(snapshot));
    setError(null);
    setInterrupted(null);
    setShowDiff(false);
  };

  const save = async () => {
    if (!canSave()) return;
    let document;
    try {
      document = parseAgentConfigurationYaml(source());
    } catch (caught) {
      setError(failure(caught, "This isn't valid YAML."));
      return;
    }
    setBusy("save");
    setProgress("");
    setError(null);
    try {
      const next = await saveAgentConfiguration(
        configurationClient,
        saved(),
        document,
        (receipt) => setReceipts((list) => [...list, receipt]),
        (label) => setProgress(label),
      );
      adopt(next);
      const warnings = next.agent.configurationWarnings ?? [];
      pushToast({
        tone: warnings.length ? "warn" : "success",
        title: `Saved ${props.agent.name}'s configuration`,
        body: warnings.length ? warnings.map((warning) => warning.message).join("\n") : undefined,
      });
    } catch (caught) {
      if (caught instanceof ConfigurationSaveInterrupted) setInterrupted(caught);
      else setError(failure(caught, "Couldn't save the configuration."));
    } finally {
      setBusy(null);
      setProgress("");
      await refreshEverything();
    }
  };

  const reload = async () => {
    if (busy()) return;
    setBusy("reload");
    try {
      adopt(await loadAgentConfiguration(configurationClient, agentId, company().id));
      drafts.delete(agentId);
      await refreshEverything();
    } catch (caught) {
      setError(failure(caught, "Couldn't reload the configuration."));
    } finally {
      setBusy(null);
    }
  };

  const statusText = () => {
    if (busy() === "save") return `Saving${progress() ? `: ${progress()}` : ""}…`;
    if (busy() === "reload") return "Loading the saved configuration…";
    if (interrupted()) return "Reload before saving again";
    const current = state();
    if (current.kind === "no-op") return "No changes to save";
    if (current.kind === "invalid") return "Can't be saved yet";
    if (current.kind === "changes") return current.steps.length === 1 ? "1 change to save" : `${current.steps.length} changes to save`;
    return "Saved";
  };

  return (
    <>
      <Show when={receipts().length > 0}>
        <SettingsCard title="Created in this save" description="Copy each key now. Its token isn't shown again once you leave this page.">
          <ul class="adv-receipts">
            <For each={receipts()}>
              {(receipt) => (
                <li class="adv-receipt">
                  <b>{receipt.label}</b>
                  <Show when={receipt.token} fallback={<code class="mono adv-id">{receipt.id}</code>}>
                    {(token) => (
                      <div class="ag-token">
                        <code class="mono">{token()}</code>
                        <Button
                          size="compact"
                          icon={<Copy size={14} aria-hidden="true" />}
                          onClick={() => void navigator.clipboard?.writeText(token()).then(() => pushToast({ tone: "success", title: "Copied the key" }))}
                        >
                          Copy
                        </Button>
                      </div>
                    )}
                  </Show>
                </li>
              )}
            </For>
          </ul>
        </SettingsCard>
      </Show>

      <section class="card adv-card" aria-label="Agent configuration">
        <header class="adv-head">
          <span class="mono adv-kind">paperclip/v1 · Agent</span>
          <span class="adv-rev" title={saved().core.configurationRevision}>
            revision <span class="mono">{saved().core.configurationRevision.slice(0, 8)}</span>
          </span>
          <Show when={restored && dirty()}>
            <span class="ag-chip">draft kept</span>
          </Show>
        </header>
        <YamlEditor
          value={source()}
          readOnly={busy() !== null}
          label={`${props.agent.name}'s configuration as YAML`}
          onChange={(value) => {
            setSource(value);
            setError(null);
          }}
          onSave={() => void save()}
        />
        <footer class="cfoot adv-foot">
          <Button variant="quiet" size="compact" icon={<RotateCcw size={14} aria-hidden="true" />} disabled={busy() !== null} onClick={() => void reload()}>
            Reload saved
          </Button>
          <div class="ps-foot-end">
            <span class="adv-status" role="status">
              {statusText()}
            </span>
            <Button variant="primary" size="compact" disabled={!canSave()} onClick={() => void save()}>
              {busy() === "save" ? "Saving…" : "Save changes"}
            </Button>
          </div>
        </footer>
      </section>

      <Show when={interrupted()}>
        {(stopped) => (
          <section class="card adv-alert" role="alert">
            <h3 class="disp">The save stopped part-way</h3>
            <p>
              <b>{stopped().step}</b> failed: {stopped().reason}
            </p>
            <Show when={stopped().completed.length > 0} fallback={<p>Nothing before it was saved.</p>}>
              <p>These went through and stay saved:</p>
              <ul>
                <For each={stopped().completed}>{(label) => <li>{label}</li>}</For>
              </ul>
            </Show>
            <p>Steps after it weren't tried. Reload the saved configuration, then make the rest of your changes again.</p>
            <div>
              <Button size="compact" variant="primary" icon={<RotateCcw size={14} aria-hidden="true" />} disabled={busy() !== null} onClick={() => void reload()}>
                Reload saved
              </Button>
            </div>
          </section>
        )}
      </Show>

      <Show when={error()}>
        <section class="card adv-alert" role="alert">
          <h3 class="disp">Nothing was saved</h3>
          <p class="adv-pre">{error()}</p>
        </section>
      </Show>

      <Show when={state().kind === "invalid" && state()}>
        {(invalid) => (
          <section class="card adv-alert" role="alert">
            <h3 class="disp">This can't be saved yet</h3>
            <p class="adv-pre">{(invalid() as { message: string }).message}</p>
          </section>
        )}
      </Show>

      <Show when={state().kind === "changes" && !interrupted() && (state() as { steps: string[] }).steps}>
        {(steps) => (
          <SettingsCard
            title={steps().length === 1 ? "1 change to save" : `${steps().length} changes to save`}
            description="A save runs these in this order, each through its own settings. If one fails, the ones before it stay saved."
          >
            <ol class="adv-steps">
              <For each={steps()}>
                {(label, index) => (
                  <li>
                    <span class="adv-step-n mono">{index() + 1}</span>
                    <span>{label}</span>
                  </li>
                )}
              </For>
            </ol>
            <div class="adv-diff-toggle">
              <Button
                size="compact"
                variant="quiet"
                icon={showDiff() ? <ListOrdered size={14} aria-hidden="true" /> : <FileDiff size={14} aria-hidden="true" />}
                aria-expanded={showDiff()}
                onClick={() => setShowDiff((shown) => !shown)}
              >
                {showDiff() ? "Hide the text changes" : "Show the text changes"}
              </Button>
              <Show when={showDiff()}>
                <span class="adv-diff-summary">{diffSummary(diff())}</span>
              </Show>
            </div>
            <Show when={showDiff()}>
              <div class="ag-diff mono adv-diff">
                <For each={diffHunks(diff())}>
                  {(line) =>
                    line === null ? (
                      <div class="ag-diff-gap">…</div>
                    ) : (
                      <div class="ag-diff-line" data-kind={line.kind}>
                        <span>{line.kind === "add" ? "+" : line.kind === "remove" ? "−" : ""}</span>
                        <span>{line.text}</span>
                      </div>
                    )
                  }
                </For>
              </div>
            </Show>
          </SettingsCard>
        )}
      </Show>

      <Reference snapshot={saved()} />
    </>
  );
}

/** The editor, loaded on first use; plain text until then, or if it can't load. */
function YamlEditor(props: { value: string; readOnly: boolean; label: string; onChange: (value: string) => void; onSave: () => void }) {
  let host!: HTMLDivElement;
  const [editor, setEditor] = createSignal<YamlEditorHandle | null>(null);
  const [failed, setFailed] = createSignal(false);
  let cancelled = false;
  import("./cm-yaml-editor")
    .then((cm) => {
      if (cancelled) return;
      setEditor(
        cm.createYamlEditor(host, {
          value: untrack(() => props.value),
          label: props.label,
          readOnly: untrack(() => props.readOnly),
          onChange: (value) => props.onChange(value),
          onSave: () => props.onSave(),
        }),
      );
    })
    .catch(() => setFailed(true));
  onCleanup(() => {
    cancelled = true;
    editor()?.destroy();
  });
  createEffect(on([editor, () => props.value], ([view, value]) => view?.setValue(value)));
  createEffect(on([editor, () => props.readOnly], ([view, readOnly]) => view?.setReadOnly(readOnly)));
  return (
    <div class="adv-editor">
      <div ref={host} class="adv-editor-host" hidden={!editor()} />
      <Show when={!editor()}>
        <textarea
          class="adv-editor-plain mono"
          aria-label={props.label}
          spellcheck={false}
          readOnly={props.readOnly || !failed()}
          value={props.value}
          onInput={(event) => props.onChange(event.currentTarget.value)}
        />
      </Show>
    </div>
  );
}

/** What the document can hold, with the ids its operations refer to. */
function Reference(props: { snapshot: AgentConfigurationSnapshot }) {
  const keys = () => props.snapshot.keys.filter((key) => !key.revokedAt);
  const revisions = () => props.snapshot.revisions.slice(0, 5);
  const proposals = () => props.snapshot.proposals.filter((proposal) => proposal.target?.id === props.snapshot.agent.id || proposal.proposedBy.id === props.snapshot.agent.id);
  return (
    <details class="card adv-reference">
      <summary class="disp">What the document can hold</summary>
      <div class="adv-reference-body">
        <dl class="adv-terms">
          <dt class="mono">name, role, title, icon, appearance, reportsTo, capabilities, budgetMonthlyCents, metadata</dt>
          <dd>The profile.</dd>
          <dt class="mono">adapterType, adapterConfig, runtimeConfig, defaultEnvironmentId</dt>
          <dd>The harness, its settings (replaced as written), and how and where it runs. Secret values show as references, never in full.</dd>
          <dt class="mono">instructions</dt>
          <dd>
            Where the files live (<span class="mono">mode</span>, <span class="mono">rootPath</span>, <span class="mono">entryFile</span>). Add{" "}
            <span class="mono">files: {"{"}path: text{"}"}</span> to write a file, or <span class="mono">path: null</span> to remove one.
          </dd>
          <dt class="mono">skills</dt>
          <dd>
            Skill keys; <span class="mono">{"{key, versionId}"}</span> pins a version.
          </dd>
          <dt class="mono">tools</dt>
          <dd>
            Installed <span class="mono">connections</span>, bound <span class="mono">profiles</span> (by <span class="mono">profileKey</span>) and this agent's own{" "}
            <span class="mono">policies</span>.
          </dd>
          <dt class="mono">channels, channelOperations</dt>
          <dd>Its chat channels' settings and resources; create, set up or remove channels and revoke linked identities.</dd>
          <dt class="mono">permissions</dt>
          <dd>Creating agents and skills, assigning tasks, the trust preset.</dd>
          <dt class="mono">secrets</dt>
          <dd>
            <span class="mono">create</span> (with <span class="mono">bind.env</span> and <span class="mono">bind.api</span>), <span class="mono">rotate</span>,{" "}
            <span class="mono">update</span>, and decisions on <span class="mono">proposals</span>. Values are sent once and never shown again.
          </dd>
          <dt class="mono">apiKeys</dt>
          <dd>
            <span class="mono">create</span> by name, <span class="mono">revoke</span> by id.
          </dd>
          <dt class="mono">revisions.restore</dt>
          <dd>Puts back an earlier configuration. Save it on its own.</dd>
        </dl>
        <Show when={keys().length || revisions().length || proposals().length}>
          <div class="adv-ids">
            <Show when={keys().length}>
              <h4>Active API keys</h4>
              <ul>
                <For each={keys()}>
                  {(key) => (
                    <li>
                      {key.name} <code class="mono adv-id">{key.id}</code>
                    </li>
                  )}
                </For>
              </ul>
            </Show>
            <Show when={revisions().length}>
              <h4>Recent revisions</h4>
              <ul>
                <For each={revisions()}>
                  {(revision) => (
                    <li>
                      {new Date(revision.createdAt).toLocaleString()} · {revision.changedKeys.join(", ") || "no fields"}{" "}
                      <code class="mono adv-id">{revision.id}</code>
                    </li>
                  )}
                </For>
              </ul>
            </Show>
            <Show when={proposals().length}>
              <h4>Pending secret proposals</h4>
              <ul>
                <For each={proposals()}>
                  {(proposal) => (
                    <li>
                      {proposal.proposedName ?? proposal.secretName ?? proposal.proposedKey ?? "Secret"} <code class="mono adv-id">{proposal.id}</code>
                    </li>
                  )}
                </For>
              </ul>
            </Show>
          </div>
        </Show>
      </div>
    </details>
  );
}
