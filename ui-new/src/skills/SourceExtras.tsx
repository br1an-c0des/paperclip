import type { ProjectSkillRepository, SkillSource, SkillSourceCandidate, SkillSourceDiscovery } from "@paperclipai/shared";
import { createQuery, useQueryClient } from "@tanstack/solid-query";
import { Check, Eye, FolderGit2 } from "lucide-solid";
import { createEffect, createMemo, createSignal, For, Match, on, Show, Switch } from "solid-js";
import { queryKeys } from "@/api/queryKeys";
import { skillsApi } from "@/api/skills";
import { CodeView } from "@/files/CodeView";
import { useCompany } from "@/lib/company";
import { Button } from "@/ui/Button";
import { Dialog } from "@/ui/Dialog";
import { Field, TextInput } from "@/ui/Field";
import { Markdown } from "@/ui/Markdown";
import { TonePill } from "@/ui/Status";
import { Switch as Toggle } from "@/ui/Switch";
import { pushToast } from "@/ui/Toast";
import { failureText, useRefreshSkills } from "./queries";
import { branchLabel } from "./skills-model";

/*
 * The rest of the old Sources page, beside SkillSources.tsx:
 *
 * - A candidate list with checkboxes and a file preview (`POST …/skill-sources/preview`), shared by
 *   Add a source and Choose skills.
 * - Source settings (`PATCH …/:id/settings`): automatic updates, importing new skills as they
 *   appear, and the branch it follows (`GET …/:id/branches`; any name can be typed).
 * - Choose skills (`POST …/discover` again, then `PATCH …/:id`): which of the repository's skills
 *   are imported.
 * - Project repositories (`GET …/project-repositories`, `POST …/adopt-project`): repositories of
 *   project workspaces that aren't sources yet, imported for that project only.
 */

export function CandidateList(props: {
  discovery: SkillSourceDiscovery;
  picked: ReadonlySet<string>;
  onToggle: (path: string) => void;
}) {
  const [previewing, setPreviewing] = createSignal<SkillSourceCandidate | null>(null);
  return (
    <>
      <ul class="sk-candidates">
        <For each={props.discovery.candidates}>
          {(candidate) => (
            <li class="sk-candidate-row">
              <button type="button" role="checkbox" class="sk-candidate" aria-checked={props.picked.has(candidate.path)} disabled={Boolean(candidate.error)} onClick={() => props.onToggle(candidate.path)}>
                <span class="org-cbox" aria-hidden="true">
                  <Show when={props.picked.has(candidate.path)}>
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
              <Show when={!candidate.error}>
                <Button size="compact" variant="icon" ghost icon={<Eye size={14} aria-hidden="true" />} aria-label={`Preview ${candidate.name}`} title="Preview SKILL.md" onClick={() => setPreviewing(candidate)} />
              </Show>
            </li>
          )}
        </For>
      </ul>
      <PreviewDialog discovery={props.discovery} candidate={previewing()} onClose={() => setPreviewing(null)} />
    </>
  );
}

function PreviewDialog(props: { discovery: SkillSourceDiscovery; candidate: SkillSourceCandidate | null; onClose: () => void }) {
  const company = useCompany();
  const files = () => props.candidate?.inspection?.files.map((file) => file.path) ?? ["SKILL.md"];
  const [path, setPath] = createSignal("SKILL.md");
  createEffect(on(() => props.candidate, () => setPath("SKILL.md")));
  // In repository mode the paths are the repository's; otherwise they're inside the skill's folder.
  const filePath = () => (props.discovery.packageMode === "repository" && props.candidate?.path ? `${props.candidate.path}/${path()}` : path());
  const preview = createQuery(() => ({
    queryKey: ["skill-sources", company().id, "preview", props.discovery.commitSha, props.candidate?.path ?? "", filePath()],
    queryFn: () =>
      skillsApi.preview(company().id, {
        repositoryUrl: props.discovery.repositoryUrl,
        trackingRef: props.discovery.trackingRef,
        connectionId: props.discovery.connectionId ?? undefined,
        packageMode: props.discovery.packageMode,
        commitSha: props.discovery.commitSha,
        skillPath: props.candidate!.path,
        filePath: filePath(),
      }),
    enabled: props.candidate !== null,
    staleTime: Infinity,
  }));
  return (
    <Dialog open={props.candidate !== null} onOpenChange={(open) => !open && props.onClose()} width={820} title={props.candidate?.name ?? ""} description={`${props.discovery.fullName} at ${props.discovery.commitSha.slice(0, 7)}`}>
      <Show when={files().length > 1}>
        <label class="act-date sk-preview-pick">
          <span>File</span>
          <select class="input" value={path()} onChange={(event) => setPath(event.currentTarget.value)}>
            <For each={files()}>{(entry) => <option value={entry}>{entry}</option>}</For>
          </select>
        </label>
      </Show>
      <Switch>
        <Match when={preview.isPending}>
          <p class="org-muted">Loading…</p>
        </Match>
        <Match when={preview.isError}>
          <p class="org-muted" role="alert">
            Couldn't read the file. {failureText(preview.error, "")}
          </p>
        </Match>
        <Match when={preview.data?.content == null}>
          <p class="org-muted">This file isn't text, so it can't be shown here.</p>
        </Match>
        <Match when={preview.data}>
          {(data) => (
            <div class="sk-file-view">
              <Show when={/\.md$/i.test(data().file.path)} fallback={<CodeView value={data().content ?? ""} filename={data().file.path} label={data().file.path} />}>
                <Markdown source={data().content ?? ""} />
              </Show>
              <Show when={data().truncated}>
                <p class="org-muted">Only the start of the file is shown.</p>
              </Show>
            </div>
          )}
        </Match>
      </Switch>
    </Dialog>
  );
}

export function SourceSettingsDialog(props: { source: SkillSource | null; onClose: () => void }) {
  const company = useCompany();
  const client = useQueryClient();
  const refresh = useRefreshSkills();
  const branches = createQuery(() => ({
    queryKey: queryKeys.skills.sourceBranches(company().id, props.source?.id ?? ""),
    queryFn: ({ signal }) => skillsApi.branches(company().id, props.source!.id, signal),
    enabled: props.source !== null,
    retry: false,
  }));
  const [automatic, setAutomatic] = createSignal(true);
  const [importNew, setImportNew] = createSignal(false);
  const [branch, setBranch] = createSignal("HEAD");
  const [busy, setBusy] = createSignal(false);
  const [error, setError] = createSignal<string | null>(null);

  createEffect(
    on(
      () => props.source?.id,
      () => {
        const source = props.source;
        if (!source) return;
        setAutomatic(source.automaticUpdates ?? true);
        setImportNew(source.importNewSkills ?? false);
        setBranch(source.trackingRef);
        setError(null);
      },
    ),
  );

  const save = async () => {
    const source = props.source;
    if (!source) return;
    setBusy(true);
    setError(null);
    try {
      const ref = branch().trim() || "HEAD";
      await skillsApi.sourceSettings(company().id, source.id, {
        revision: source.revision,
        automaticUpdates: automatic(),
        importNewSkills: importNew(),
        ...(ref !== source.trackingRef ? { trackingRef: ref } : {}),
      });
      void client.invalidateQueries({ queryKey: queryKeys.skills.sources(company().id) });
      refresh();
      pushToast({ tone: "success", title: `Saved ${source.fullName}` });
      props.onClose();
    } catch (caught) {
      setError(failureText(caught, "Couldn't save the settings."));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Dialog
      open={props.source !== null}
      onOpenChange={(open) => !open && props.onClose()}
      width={520}
      title={`${props.source?.fullName ?? "Source"} settings`}
      footer={
        <div class="org-dialog-foot">
          <Button variant="quiet" onClick={props.onClose} disabled={busy()}>
            Cancel
          </Button>
          <Button variant="primary" onClick={() => void save()} disabled={busy()}>
            {busy() ? "Saving…" : "Save"}
          </Button>
        </div>
      }
    >
      <div class="sk-form">
        <Toggle checked={automatic()} onChange={setAutomatic} label="Update automatically" description="Install new commits on the branch as they land. Off, use Sync now." />
        <Toggle checked={importNew()} onChange={setImportNew} label="Import new skills" description="Skills added to the repository later are imported too, not just offered." />
        <Field label="Branch" for="sk-source-branch-set" help={branches.data ? `Default: ${branches.data.defaultBranch}. Pinned agent versions stay as they are.` : "HEAD follows the repository's default branch."}>
          <TextInput id="sk-source-branch-set" list="sk-source-branches" value={branch()} onInput={(event) => setBranch(event.currentTarget.value)} />
          <datalist id="sk-source-branches">
            <option value="HEAD">default branch</option>
            <For each={branches.data?.branches ?? []}>{(entry) => <option value={entry.name}>{entry.isDefault ? "default" : ""}</option>}</For>
          </datalist>
        </Field>
        <Show when={branches.isError}>
          <p class="org-muted">Couldn't list the branches ({failureText(branches.error, "")}); type one.</p>
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

export function ChooseSkillsDialog(props: { source: SkillSource | null; onClose: () => void }) {
  const company = useCompany();
  const client = useQueryClient();
  const refresh = useRefreshSkills();
  const [found, setFound] = createSignal<SkillSourceDiscovery | null>(null);
  const [picked, setPicked] = createSignal<ReadonlySet<string>>(new Set());
  const [loading, setLoading] = createSignal(false);
  const [busy, setBusy] = createSignal(false);
  const [error, setError] = createSignal<string | null>(null);

  createEffect(
    on(
      () => props.source?.id,
      async () => {
        const source = props.source;
        setFound(null);
        setError(null);
        if (!source) return;
        setLoading(true);
        try {
          const discovery = await skillsApi.discover(company().id, {
            repositoryUrl: source.repositoryUrl,
            trackingRef: source.trackingRef,
            connectionId: source.connectionId,
            packageMode: source.packageMode,
          });
          setFound(discovery);
          setPicked(new Set(source.entries.filter((entry) => entry.selection === "selected").map((entry) => entry.path)));
        } catch (caught) {
          setError(failureText(caught, "Couldn't read the repository."));
        } finally {
          setLoading(false);
        }
      },
    ),
  );

  const toggle = (path: string) =>
    setPicked((current) => {
      const next = new Set(current);
      if (next.has(path)) next.delete(path);
      else next.add(path);
      return next;
    });

  const save = async () => {
    const source = props.source;
    const discovery = found();
    if (!source || !discovery) return;
    setBusy(true);
    setError(null);
    try {
      const result = await skillsApi.selectSource(company().id, source.id, {
        revision: source.revision,
        packageMode: discovery.packageMode,
        selectedPaths: [...picked()],
        excludedFolders: source.excludedFolders,
        connectionId: source.connectionId,
      });
      void client.invalidateQueries({ queryKey: queryKeys.skills.sources(company().id) });
      refresh();
      pushToast({ tone: "success", title: `Updated ${source.fullName}`, body: `${result.imported.length} new, ${result.updated.length} updated.` });
      props.onClose();
    } catch (caught) {
      setError(failureText(caught, "Couldn't save the selection."));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Dialog
      open={props.source !== null}
      onOpenChange={(open) => !open && props.onClose()}
      width={640}
      title={`Skills from ${props.source?.fullName ?? "the source"}`}
      description="Picked skills are imported; unpicking one removes it from the library."
      footer={
        <div class="org-dialog-foot">
          <Button variant="quiet" onClick={props.onClose} disabled={busy()}>
            Cancel
          </Button>
          <Button variant="primary" onClick={() => void save()} disabled={busy() || !found()}>
            {busy() ? "Saving…" : `Keep ${picked().size} ${picked().size === 1 ? "skill" : "skills"}`}
          </Button>
        </div>
      }
    >
      <div class="sk-form">
        <Show when={loading()}>
          <p class="org-muted">Reading the repository…</p>
        </Show>
        <Show when={found()}>
          {(discovery) => (
            <>
              <p class="org-muted">
                {discovery().candidates.length} {discovery().candidates.length === 1 ? "skill" : "skills"} at <span class="mono">{discovery().commitSha.slice(0, 7)}</span> ({branchLabel(discovery().trackingRef)}).
              </p>
              <CandidateList discovery={discovery()} picked={picked()} onToggle={toggle} />
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

/** Repositories of project workspaces that aren't a source yet, one row per repository and branch. */
export function ProjectRepositories() {
  const company = useCompany();
  const client = useQueryClient();
  const refresh = useRefreshSkills();
  const repos = createQuery(() => ({
    queryKey: queryKeys.skills.projectRepositories(company().id),
    queryFn: ({ signal }) => skillsApi.projectRepositories(company().id, signal),
    refetchInterval: (query) => (query.state.data?.some((repo) => repo.status === "pending") ? 5_000 : false),
  }));
  const groups = createMemo(() => groupRepositories(repos.data ?? []));
  const [adopting, setAdopting] = createSignal<string | null>(null);

  const adopt = async (group: RepoGroup) => {
    setAdopting(group.key);
    try {
      for (const repo of group.repos.filter((entry) => entry.status === "available" || entry.status === "error")) await skillsApi.adoptProject(company().id, repo.workspaceId);
      void client.invalidateQueries({ queryKey: queryKeys.skills.projectRepositories(company().id) });
      void client.invalidateQueries({ queryKey: queryKeys.skills.sources(company().id) });
      refresh();
      pushToast({ tone: "success", title: `Importing skills from ${group.name}`, body: `For ${group.repos.map((repo) => repo.projectName).join(", ")}.` });
    } catch (error) {
      pushToast({ tone: "error", title: "Couldn't import from the project", body: failureText(error, "") });
    } finally {
      setAdopting(null);
    }
  };

  return (
    <Show when={groups().length > 0}>
      <section class="card act-card" aria-labelledby="sk-project-repos-h">
        <div class="org-card-row sk-pad">
          <h2 class="disp" id="sk-project-repos-h">
            From your projects
          </h2>
          <span class="org-muted org-push">Skills stay limited to the project</span>
        </div>
        <ul class="act-list">
          <For each={groups()}>
            {(group) => (
              <li class="sk-source">
                <div class="sk-source-main">
                  <div class="org-row">
                    <FolderGit2 size={15} aria-hidden="true" />
                    <span class="org-strong">{group.name}</span>
                    <span class="mono org-muted">{branchLabel(group.trackingRef)}</span>
                    <Show when={group.repos.some((repo) => repo.status === "pending")}>
                      <TonePill tone="run" compact>
                        Importing
                      </TonePill>
                    </Show>
                    <Show when={group.repos.some((repo) => repo.status === "error")}>
                      <TonePill tone="red" compact>
                        Failed
                      </TonePill>
                    </Show>
                  </div>
                  <span class="org-muted">{group.repos.map((repo) => repo.projectName).join(", ")}</span>
                  <For each={group.repos.filter((repo) => repo.lastError)}>{(repo) => <p class="sk-error">{repo.lastError}</p>}</For>
                </div>
                <div class="sk-source-actions">
                  <Button size="compact" disabled={adopting() !== null || group.repos.every((repo) => repo.status === "pending")} onClick={() => void adopt(group)}>
                    {adopting() === group.key ? "Starting…" : "Import its skills"}
                  </Button>
                </div>
              </li>
            )}
          </For>
        </ul>
      </section>
    </Show>
  );
}

type RepoGroup = { key: string; name: string; trackingRef: string; repos: ProjectSkillRepository[] };

/** Project workspaces that aren't sources, grouped by repository and branch. */
export function groupRepositories(repos: readonly ProjectSkillRepository[]): RepoGroup[] {
  const groups = new Map<string, RepoGroup>();
  for (const repo of repos) {
    if (repo.sourceId || repo.status === "ready") continue;
    const key = `${repo.repositoryUrl.toLowerCase()}#${repo.trackingRef}`;
    const name = repo.repositoryUrl.replace(/^https?:\/\/(www\.)?github\.com\//i, "").replace(/\.git$/, "");
    const group = groups.get(key) ?? { key, name, trackingRef: repo.trackingRef, repos: [] };
    group.repos.push(repo);
    groups.set(key, group);
  }
  return [...groups.values()].sort((a, b) => a.name.localeCompare(b.name));
}
