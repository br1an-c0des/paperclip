import type { SkillSource, SkillSourceDiscovery } from "@paperclipai/shared";
import { A, useNavigate } from "@solidjs/router";
import { createQuery, useQueryClient } from "@tanstack/solid-query";
import { Check, ExternalLink, GitBranch, Plus, RefreshCw } from "lucide-solid";
import { createEffect, createMemo, createSignal, For, Match, Show, Switch } from "solid-js";
import { queryKeys } from "@/api/queryKeys";
import { skillsApi } from "@/api/skills";
import { useCompany } from "@/lib/company";
import { Button } from "@/ui/Button";
import { Dialog } from "@/ui/Dialog";
import { Field, TextInput } from "@/ui/Field";
import { TonePill } from "@/ui/Status";
import { pushToast } from "@/ui/Toast";
import { failureText, useRefreshSkills } from "./queries";
import { whenLabel } from "./SkillLibrary";
import { repositoryProblem, repositoryUrl, syncLabel } from "./skills-model";

/*
 * Skill sources (`/:prefix/skills/sources`): the Git repositories the library imports skills from
 * (`GET /companies/:id/skill-sources`). Each shows its branch, how its sync stands, and the skills
 * it brought in; Sync now reads it again (`POST …/:id/refresh`) and Remove disconnects it, keeping
 * its skills as copies or deleting them (`DELETE …/:id`).
 *
 * Add a source reads a repository first (`POST …/discover`) and lists the skills in it; the chosen
 * ones are imported from that exact commit (`POST …/skill-sources`). Private repositories need a
 * GitHub connection, which is set up under Apps; adopting a project's repository, choosing a
 * connection, changing the branch or the selection later, and automatic updates are still in the
 * old UI.
 */

export function SkillSources(props: { sourceId: string | null }) {
  const company = useCompany();
  const sources = createQuery(() => ({
    queryKey: queryKeys.skills.sources(company().id),
    queryFn: ({ signal }) => skillsApi.sources(company().id, signal),
  }));
  const [adding, setAdding] = createSignal(false);
  const [removing, setRemoving] = createSignal<SkillSource | null>(null);

  createEffect(() => {
    const id = props.sourceId;
    if (id && sources.data) requestAnimationFrame(() => document.getElementById(`source-${id}`)?.scrollIntoView({ block: "nearest" }));
  });

  return (
    <section class="act-section" aria-label="Skill sources">
      <div class="act-toolbar">
        <span class="org-muted">Repositories the library imports skills from. Their skills stay in step with the branch you pick.</span>
        <div class="act-toolbar-end">
          <Button variant="primary" size="compact" icon={<Plus size={14} stroke-width={2.2} aria-hidden="true" />} onClick={() => setAdding(true)}>
            Add a source
          </Button>
        </div>
      </div>
      <section class="card act-card" aria-label="Sources">
        <Switch>
          <Match when={sources.isPending}>
            <p class="org-empty">Loading sources…</p>
          </Match>
          <Match when={sources.isError}>
            <p class="org-empty">Couldn't load the sources. {sources.error instanceof Error ? sources.error.message : ""}</p>
          </Match>
          <Match when={(sources.data ?? []).length === 0}>
            <div class="org-empty">
              <p>No sources yet. Add a GitHub repository to import the skills in it.</p>
            </div>
          </Match>
        </Switch>
        <ul class="act-list">
          <For each={sources.data ?? []}>{(source) => <SourceRow source={source} selected={props.sourceId === source.id} onRemove={() => setRemoving(source)} />}</For>
        </ul>
      </section>
      <AddSourceDialog open={adding()} onOpenChange={setAdding} />
      <RemoveSourceDialog source={removing()} onClose={() => setRemoving(null)} />
    </section>
  );
}

function SourceRow(props: { source: SkillSource; selected: boolean; onRemove: () => void }) {
  const company = useCompany();
  const client = useQueryClient();
  const refreshSkills = useRefreshSkills();
  const [syncing, setSyncing] = createSignal(false);
  const imported = () => props.source.entries.filter((entry) => entry.skillId);
  const failing = () => Boolean(props.source.lastError);

  const sync = async () => {
    setSyncing(true);
    try {
      const result = await skillsApi.syncSource(company().id, props.source.id);
      void client.invalidateQueries({ queryKey: queryKeys.skills.sources(company().id) });
      refreshSkills();
      const changed = result.imported.length + result.updated.length;
      pushToast({ tone: "success", title: `Synced ${props.source.fullName}`, body: changed === 0 ? "Nothing changed." : `${result.imported.length} new, ${result.updated.length} updated.` });
    } catch (error) {
      pushToast({ tone: "error", title: `Couldn't sync ${props.source.fullName}`, body: failureText(error, "") });
    } finally {
      setSyncing(false);
    }
  };

  return (
    <li id={`source-${props.source.id}`} class="sk-source" classList={{ "sk-source--selected": props.selected }}>
      <div class="sk-source-main">
        <div class="org-row">
          <GitBranch size={15} aria-hidden="true" />
          <span class="org-strong">{props.source.fullName}</span>
          <span class="mono org-muted">{props.source.trackingRef === "HEAD" ? "default branch" : props.source.trackingRef}</span>
          <TonePill tone={failing() ? "red" : props.source.syncState === "refreshing" ? "run" : "green"} compact>
            {syncLabel(props.source)}
          </TonePill>
          <Show when={props.source.accessScope === "projects"}>
            <TonePill tone="amber" compact>
              Some projects only
            </TonePill>
          </Show>
        </div>
        <span class="org-muted">
          {imported().length} {imported().length === 1 ? "skill" : "skills"} imported
          <Show when={props.source.lastSuccessAt}>{(at) => <> · synced {whenLabel(at() as unknown as string)}</>}</Show>
          <Show when={props.source.lastScanCommit}>
            {(commit) => (
              <>
                {" "}
                at <span class="mono">{commit().slice(0, 7)}</span>
              </>
            )}
          </Show>
        </span>
        <Show when={props.source.lastError}>
          <p class="sk-error" role="alert">
            {props.source.lastError}
          </p>
        </Show>
        <Show when={imported().length > 0}>
          <ul class="sk-chips">
            <For each={imported()}>
              {(entry) => (
                <li>
                  <A class="sk-chip" href={`/${company().issuePrefix}/skills/${entry.skillId}`}>
                    {entry.name}
                  </A>
                </li>
              )}
            </For>
          </ul>
        </Show>
      </div>
      <div class="sk-source-actions">
        <a class="org-link" href={props.source.repositoryUrl} target="_blank" rel="noreferrer">
          Repository <ExternalLink size={12} aria-hidden="true" />
        </a>
        <Button size="compact" icon={<RefreshCw size={14} aria-hidden="true" />} disabled={syncing()} onClick={() => void sync()}>
          {syncing() ? "Syncing…" : "Sync now"}
        </Button>
        <Button size="compact" variant="danger" onClick={props.onRemove}>
          Remove
        </Button>
      </div>
    </li>
  );
}

function AddSourceDialog(props: { open: boolean; onOpenChange: (open: boolean) => void }) {
  const company = useCompany();
  const client = useQueryClient();
  const navigate = useNavigate();
  const refreshSkills = useRefreshSkills();
  const [url, setUrl] = createSignal("");
  const [branch, setBranch] = createSignal("");
  const [scanning, setScanning] = createSignal(false);
  const [importing, setImporting] = createSignal(false);
  const [error, setError] = createSignal<string | null>(null);
  const [found, setFound] = createSignal<SkillSourceDiscovery | null>(null);
  const [picked, setPicked] = createSignal<ReadonlySet<string>>(new Set());
  const problem = () => (url().trim() ? repositoryProblem(url()) : null);
  const usable = createMemo(() => (found()?.candidates ?? []).filter((candidate) => !candidate.error));

  const reset = () => {
    setUrl("");
    setBranch("");
    setError(null);
    setFound(null);
    setPicked(new Set<string>());
  };
  const close = (open: boolean) => {
    props.onOpenChange(open);
    if (!open) reset();
  };

  const scan = async () => {
    if (repositoryProblem(url())) return;
    setScanning(true);
    setError(null);
    try {
      const discovery = await skillsApi.discover(company().id, { repositoryUrl: repositoryUrl(url()), trackingRef: branch().trim() || undefined });
      setFound(discovery);
      setPicked(new Set(discovery.candidates.filter((candidate) => !candidate.error).map((candidate) => candidate.path)));
    } catch (caught) {
      setError(failureText(caught, "Couldn't read that repository."));
    } finally {
      setScanning(false);
    }
  };

  const add = async () => {
    const discovery = found();
    if (!discovery || picked().size === 0) return;
    setImporting(true);
    setError(null);
    try {
      const result = await skillsApi.addSource(company().id, {
        repositoryUrl: discovery.repositoryUrl,
        trackingRef: discovery.trackingRef,
        connectionId: discovery.connectionId ?? undefined,
        commitSha: discovery.commitSha,
        selectedPaths: [...picked()],
        packageMode: discovery.packageMode,
      });
      void client.invalidateQueries({ queryKey: queryKeys.skills.sources(company().id) });
      refreshSkills();
      pushToast({ tone: "success", title: `Added ${discovery.fullName}`, body: `${result.imported.length} ${result.imported.length === 1 ? "skill" : "skills"} imported.` });
      close(false);
      navigate(`/${company().issuePrefix}/skills/sources/${result.source.id}`);
    } catch (caught) {
      setError(failureText(caught, "Couldn't add the source."));
    } finally {
      setImporting(false);
    }
  };

  const toggle = (path: string) =>
    setPicked((current) => {
      const next = new Set(current);
      if (next.has(path)) next.delete(path);
      else next.add(path);
      return next;
    });

  return (
    <Dialog
      open={props.open}
      onOpenChange={close}
      width={640}
      title="Add a source"
      description="A GitHub repository with skills in it (folders with a SKILL.md). Paperclip reads it, then imports the skills you pick."
      footer={
        <div class="org-dialog-foot">
          <Button variant="quiet" onClick={() => close(false)} disabled={scanning() || importing()}>
            Cancel
          </Button>
          <Show
            when={found()}
            fallback={
              <Button variant="primary" disabled={!url().trim() || Boolean(problem()) || scanning()} onClick={() => void scan()}>
                {scanning() ? "Reading the repository…" : "Find skills"}
              </Button>
            }
          >
            <Button variant="primary" disabled={picked().size === 0 || importing()} onClick={() => void add()}>
              {importing() ? "Importing…" : `Import ${picked().size} ${picked().size === 1 ? "skill" : "skills"}`}
            </Button>
          </Show>
        </div>
      }
    >
      <div class="sk-form">
        <Show
          when={found()}
          fallback={
            <>
              <Field label="Repository" for="sk-source-url" error={problem() ?? undefined} help="github.com/owner/repo, or just owner/repo.">
                <TextInput
                  id="sk-source-url"
                  value={url()}
                  placeholder="github.com/owner/repo"
                  invalid={Boolean(problem())}
                  onInput={(event) => setUrl(event.currentTarget.value)}
                  onKeyDown={(event) => event.key === "Enter" && void scan()}
                />
              </Field>
              <Field label="Branch" for="sk-source-branch" help="Leave empty for the repository's default branch.">
                <TextInput id="sk-source-branch" value={branch()} placeholder="main" onInput={(event) => setBranch(event.currentTarget.value)} />
              </Field>
            </>
          }
        >
          {(discovery) => (
            <>
              <p class="org-muted">
                <b class="org-strong">{discovery().fullName}</b> at <span class="mono">{discovery().commitSha.slice(0, 7)}</span> ({discovery().trackingRef === "HEAD" ? "default branch" : discovery().trackingRef}):{" "}
                {discovery().candidates.length} {discovery().candidates.length === 1 ? "skill" : "skills"} found.{" "}
                <button type="button" class="act-linkish" onClick={() => setFound(null)}>
                  Change
                </button>
              </p>
              <For each={discovery().warnings}>{(warning) => <p class="sk-warning">{warning}</p>}</For>
              <Show when={usable().length > 1}>
                <div class="org-row">
                  <button type="button" class="act-linkish" onClick={() => setPicked(new Set(usable().map((candidate) => candidate.path)))}>
                    Pick all
                  </button>
                  <button type="button" class="act-linkish" onClick={() => setPicked(new Set<string>())}>
                    Pick none
                  </button>
                </div>
              </Show>
              <ul class="sk-candidates">
                <For each={discovery().candidates}>
                  {(candidate) => (
                    <li>
                      <button
                        type="button"
                        role="checkbox"
                        class="sk-candidate"
                        aria-checked={picked().has(candidate.path)}
                        disabled={Boolean(candidate.error)}
                        onClick={() => toggle(candidate.path)}
                      >
                        <span class="org-cbox" aria-hidden="true">
                          <Show when={picked().has(candidate.path)}>
                            <Check size={11} stroke-width={3.2} />
                          </Show>
                        </span>
                        <span class="sk-candidate-text">
                          <span class="org-strong">{candidate.name}</span>
                          <span class="mono org-muted">
                            {candidate.path || "/"} · {candidate.fileCount} {candidate.fileCount === 1 ? "file" : "files"}
                          </span>
                          <Show when={candidate.description}>
                            <span class="org-muted sk-clamp">{candidate.description}</span>
                          </Show>
                          <Show when={candidate.error}>
                            <span class="sk-error">{candidate.error}</span>
                          </Show>
                          <For each={candidate.warnings}>{(warning) => <span class="sk-warning">{warning}</span>}</For>
                        </span>
                      </button>
                    </li>
                  )}
                </For>
              </ul>
            </>
          )}
        </Show>
        <Show when={error()}>
          <p class="field-error" role="alert">
            {error()}
          </p>
        </Show>
      </div>
    </Dialog>
  );
}

function RemoveSourceDialog(props: { source: SkillSource | null; onClose: () => void }) {
  const company = useCompany();
  const client = useQueryClient();
  const refreshSkills = useRefreshSkills();
  const [keep, setKeep] = createSignal<"copy" | "delete">("copy");
  const [busy, setBusy] = createSignal(false);
  const count = () => props.source?.entries.filter((entry) => entry.skillId).length ?? 0;

  const remove = async () => {
    const source = props.source;
    if (!source) return;
    setBusy(true);
    try {
      const result = await skillsApi.removeSource(company().id, source.id, { revision: source.revision, skills: keep() });
      void client.invalidateQueries({ queryKey: queryKeys.skills.sources(company().id) });
      refreshSkills();
      pushToast({
        tone: "success",
        title: `Removed ${source.fullName}`,
        body: result.copiedCount ? `${result.copiedCount} skills kept as copies.` : result.deletedCount ? `${result.deletedCount} skills deleted.` : undefined,
      });
      props.onClose();
    } catch (error) {
      pushToast({ tone: "error", title: "Couldn't remove the source", body: failureText(error, "") });
    } finally {
      setBusy(false);
    }
  };

  return (
    <Dialog
      open={props.source !== null}
      onOpenChange={(open) => !open && props.onClose()}
      width={480}
      title={`Remove ${props.source?.fullName ?? "the source"}?`}
      description="Paperclip stops following this repository."
      hideClose
      footer={
        <div class="org-dialog-foot">
          <Button variant="quiet" onClick={props.onClose} disabled={busy()}>
            Cancel
          </Button>
          <Button variant="danger" onClick={() => void remove()} disabled={busy()}>
            {busy() ? "Removing…" : "Remove source"}
          </Button>
        </div>
      }
    >
      <Show when={count() > 0} fallback={<p class="org-muted">No skills came from it.</p>}>
        <div class="sk-options" role="radiogroup" aria-label="Its skills">
          <button type="button" role="radio" class="sk-option" aria-checked={keep() === "copy"} onClick={() => setKeep("copy")}>
            <b>Keep its {count()} skills as copies</b>
            <span class="org-muted">Agents keep using them; they no longer update from the repository.</span>
          </button>
          <button type="button" role="radio" class="sk-option" aria-checked={keep() === "delete"} onClick={() => setKeep("delete")}>
            <b>Delete its {count()} skills</b>
            <span class="org-muted">Agents using them lose them.</span>
          </button>
        </div>
      </Show>
    </Dialog>
  );
}
