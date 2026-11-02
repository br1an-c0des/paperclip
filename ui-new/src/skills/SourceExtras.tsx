import type { ProjectSkillRepository, SkillSource, SkillSourceCandidate, SkillSourceDiscovery, SkillSourceDiscoveryRequest, SkillSourceScanProgress } from "@paperclipai/shared";
import { createQuery, useQueryClient } from "@tanstack/solid-query";
import { Check, Eye, FolderGit2 } from "lucide-solid";
import { createEffect, createMemo, createSignal, For, Match, on, onCleanup, Show, Switch } from "solid-js";
import { ApiError } from "@/api/client";
import { queryKeys } from "@/api/queryKeys";
import { skillsApi, StreamUnavailableError } from "@/api/skills";
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
import { allConnections, connectionChoices, scanFraction, scanProgressLine, type ConnectionChoice } from "./skill-settings-model";
import { branchLabel } from "./skills-model";

/*
 * The rest of the old Sources page, beside SkillSources.tsx:
 *
 * - A candidate list with checkboxes and a file preview (`POST …/skill-sources/preview`), shared by
 *   Add a source and Choose skills.
 * - Source settings (`PATCH …/:id/settings`): automatic updates, importing new skills as they
 *   appear, the GitHub connection whose access reads it (from `GET …/repositories`), and the branch
 *   it follows (`GET …/:id/branches`, read through the chosen connection; any name can be typed).
 *   A source failing for its connection opens here.
 * - Choose skills (`POST …/discover` again, streamed, then `PATCH …/:id`): which of the
 *   repository's skills are imported.
 * - Streamed scans (`useStreamedScan`): progress and the skills found while a repository is read.
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
  const [connection, setConnection] = createSignal<string | null>(null);
  const branches = createQuery(() => ({
    queryKey: [...queryKeys.skills.sourceBranches(company().id, props.source?.id ?? ""), connection() ?? ""],
    queryFn: ({ signal }) => skillsApi.branches(company().id, props.source!.id, signal, connection()),
    enabled: props.source !== null,
    retry: false,
  }));
  const repositories = createQuery(() => ({
    queryKey: queryKeys.skills.repositories(company().id),
    queryFn: ({ signal }) => skillsApi.repositories(company().id, signal),
    enabled: props.source !== null,
    retry: false,
    staleTime: 60_000,
  }));
  // The connections that list this repository; when none do (a private one the list misses), any of the person's.
  const connections = createMemo((): ConnectionChoice[] => {
    const source = props.source;
    if (!source) return [];
    const matching = connectionChoices(repositories.data, source.repositoryUrl);
    const list = matching.length ? matching : allConnections(repositories.data);
    return source.connectionId && !list.some((entry) => entry.id === source.connectionId) ? [{ id: source.connectionId, name: "The current connection" }, ...list] : list;
  });
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
        setConnection(source.connectionId);
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
        ...(connection() !== source.connectionId ? { connectionId: connection() } : {}),
      });
      void client.invalidateQueries({ queryKey: queryKeys.skills.sources(company().id) });
      refresh();
      pushToast({ tone: "success", title: `Saved ${source.fullName}` });
      props.onClose();
    } catch (caught) {
      const code = caught instanceof ApiError ? (caught.body as { code?: string } | null)?.code : undefined;
      if (code === "skill_source_settings_changed") {
        void client.invalidateQueries({ queryKey: queryKeys.skills.sources(company().id) });
        setError("This source changed meanwhile. Close and open its settings again, then save.");
      } else if (code === "skill_source_ref_unavailable") {
        setError(`${failureText(caught, "")} Pick a branch this connection can read.`);
      } else {
        setError(failureText(caught, "Couldn't save the settings."));
      }
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
        <Show when={connections().length > 0} fallback={<Show when={repositories.isSuccess}><p class="org-muted">No GitHub connection can read it. Connect GitHub under Apps; public repositories work without one.</p></Show>}>
          <ConnectionField
            id="sk-source-connection"
            choices={connections()}
            value={connection()}
            onChange={setConnection}
            help={props.source?.lastError && props.source.repairAction === "connection" ? "Its last sync failed reading the repository. Pick a connection that can read it." : undefined}
          />
        </Show>
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
  const live = useStreamedScan();
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
        if (!source) return live.cancel();
        setLoading(true);
        try {
          const discovery = await live.scan({
            repositoryUrl: source.repositoryUrl,
            trackingRef: source.trackingRef,
            connectionId: source.connectionId,
            packageMode: source.packageMode,
          });
          if (!discovery) return;
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
          <ScanProgress progress={live.progress()} found={live.found()} />
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

// ---------------------------------------------------------------------------------------------
// Streamed scans

type FoundSkill = Pick<SkillSourceCandidate, "path" | "name" | "description" | "fileCount" | "error">;

/**
 * A repository scan with live progress (`POST …/discover` as NDJSON), as the old Sources page runs
 * it: how far the download and the checks are, and the last few skills found. A server that
 * doesn't stream gets the plain scan. A package whose skills reach outside their folders is read
 * again in repository mode, so shared files come along. Closing the dialog cancels the scan.
 */
export function useStreamedScan() {
  const company = useCompany();
  const [progress, setProgress] = createSignal<SkillSourceScanProgress | null>(null);
  const [found, setFound] = createSignal<FoundSkill[]>([]);
  const [scanning, setScanning] = createSignal(false);
  let controller: AbortController | null = null;
  onCleanup(() => controller?.abort());

  const once = async (input: SkillSourceDiscoveryRequest, signal: AbortSignal) => {
    try {
      return await skillsApi.discoverStream(
        company().id,
        input,
        (update) => {
          if (signal.aborted) return;
          if (update.type === "progress") setProgress(update);
          else setFound((current) => [...current.filter((skill) => skill.path !== update.candidate.path), update.candidate].slice(-5));
        },
        signal,
      );
    } catch (error) {
      if (error instanceof StreamUnavailableError) return skillsApi.discover(company().id, input);
      throw error;
    }
  };

  const scan = async (input: SkillSourceDiscoveryRequest): Promise<SkillSourceDiscovery | null> => {
    controller?.abort();
    const current = new AbortController();
    controller = current;
    setProgress(null);
    setFound([]);
    setScanning(true);
    try {
      let result = await once(input, current.signal);
      if ((input.packageMode ?? "skills") === "skills" && needsRepositoryMode(result)) {
        setFound([]);
        result = await once({ ...input, packageMode: "repository" }, current.signal);
      }
      return controller === current ? result : null;
    } catch (error) {
      if (current.signal.aborted) return null;
      throw error;
    } finally {
      if (controller === current) setScanning(false);
    }
  };

  const cancel = () => {
    controller?.abort();
    controller = null;
    setScanning(false);
  };

  return { scan, cancel, progress, found, scanning };
}

/** Whether a scanned skill links files outside its own folder, which repository mode brings along. */
export function needsRepositoryMode(discovery: Pick<SkillSourceDiscovery, "candidates">) {
  return discovery.candidates.some((candidate) => candidate.inspection?.references.some((reference) => reference.kind === "outside_package"));
}

/** The scan's progress line, a meter while it has a fraction, and the skills found so far. */
export function ScanProgress(props: { progress: SkillSourceScanProgress | null; found: readonly FoundSkill[] }) {
  const fraction = () => scanFraction(props.progress);
  return (
    <div class="sk-scan" role="status" aria-live="polite">
      <p class="org-muted">{scanProgressLine(props.progress)}</p>
      <Show when={fraction() !== null}>
        <div class="sk-meter" role="progressbar" aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.round((fraction() ?? 0) * 100)} aria-label="Scan progress">
          <span style={{ width: `${Math.round((fraction() ?? 0) * 100)}%` }} />
        </div>
      </Show>
      <Show when={props.found.length > 0}>
        <ul class="sk-scan-found">
          <For each={props.found}>
            {(skill) => (
              <li>
                <span class="org-strong">{skill.name}</span> <span class="mono org-muted">{skill.path || "/"}</span>
                <Show when={skill.error}>
                  <span class="sk-error"> {skill.error}</span>
                </Show>
              </li>
            )}
          </For>
        </ul>
      </Show>
    </div>
  );
}

/** A choice of GitHub connection, when more than one can read the repository (or none is known). */
export function ConnectionField(props: {
  id: string;
  choices: readonly ConnectionChoice[];
  value: string | null;
  onChange: (id: string | null) => void;
  /** Offer "Let Paperclip choose" (a new source); a saved one keeps a connection. */
  automatic?: boolean;
  help?: string;
  disabled?: boolean;
}) {
  return (
    <Field label="GitHub connection" for={props.id} help={props.help ?? "Whose access reads the repository. Manage connections under Apps."}>
      <select id={props.id} class="input" value={props.value ?? ""} disabled={props.disabled} onChange={(event) => props.onChange(event.currentTarget.value || null)}>
        <Show when={props.automatic || !props.value}>
          <option value="">{props.automatic ? "Let Paperclip choose" : "None chosen"}</option>
        </Show>
        <For each={props.choices}>{(choice) => <option value={choice.id}>{choice.name}</option>}</For>
      </select>
    </Field>
  );
}
