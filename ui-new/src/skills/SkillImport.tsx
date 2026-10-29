import type { CompanySkillProjectBrowseResult, CompanySkillProjectScanCandidate, CompanySkillProjectScanResult, Project } from "@paperclipai/shared";
import { A, useNavigate } from "@solidjs/router";
import { ArrowLeft, Check, FileText, Folder, FolderOpen, FolderSearch, Sparkles } from "lucide-solid";
import { createMemo, createSignal, For, Match, onMount, Show, Switch } from "solid-js";
import { skillsApi } from "@/api/skills";
import { useCompany } from "@/lib/company";
import { useProjectsQuery } from "@/lib/company-data";
import { Button } from "@/ui/Button";
import { Dialog } from "@/ui/Dialog";
import { Field, TextInput } from "@/ui/Field";
import { TonePill } from "@/ui/Status";
import { pushToast } from "@/ui/Toast";
import { failureText, useRefreshSkills } from "./queries";
import { candidateStatus, conflictSlug, importProblem, scanKey, selectableCandidate, skillFolderOf, slugProblem, type ScanSelection } from "./skills-model";

/*
 * Bringing skills into the library from elsewhere (the old library's "Add" menu):
 *
 * - Import from a path or URL (`POST /companies/:id/skills/import`): a folder on the server, a GitHub
 *   address, a skills.sh link or a URL to a SKILL.md. Repositories that should stay in step belong
 *   under Sources instead.
 * - Scan a project (`POST …/skills/scan-projects`): pick a project, preview the skill folders in its
 *   workspaces, and import the picked ones. A skill whose name is taken is imported under another
 *   name. Browse (`POST …/skills/browse-project`) walks a workspace's folders to add one the scan
 *   missed. Imported project skills stay references to the workspace's files.
 */

export function ImportDialog(props: { open: boolean; onOpenChange: (open: boolean) => void }) {
  const company = useCompany();
  const navigate = useNavigate();
  const refresh = useRefreshSkills();
  const [from, setFrom] = createSignal("");
  const [busy, setBusy] = createSignal(false);
  const [error, setError] = createSignal<string | null>(null);
  const problem = () => (from().trim() ? importProblem(from()) : null);

  const close = (open: boolean) => {
    props.onOpenChange(open);
    if (!open) {
      setFrom("");
      setError(null);
    }
  };

  const run = async () => {
    if (importProblem(from()) || busy()) return;
    setBusy(true);
    setError(null);
    try {
      const result = await skillsApi.importFrom(company().id, from().trim());
      refresh();
      const count = result.imported.length;
      pushToast({
        tone: count > 0 ? "success" : "info",
        title: count > 0 ? `Imported ${count} ${count === 1 ? "skill" : "skills"}` : "Nothing new to import",
        body: result.warnings[0] ?? (count > 0 ? result.imported.map((skill) => skill.name).join(", ") : undefined),
      });
      close(false);
      if (count === 1) navigate(`/${company().issuePrefix}/skills/${result.imported[0]!.id}`);
    } catch (caught) {
      setError(failureText(caught, "Couldn't import from there."));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Dialog
      open={props.open}
      onOpenChange={close}
      width={560}
      title="Import from a path or URL"
      description="A folder with a SKILL.md, or a repository with several. Paperclip copies the skills in; to keep a repository's skills up to date, add it under Sources."
      footer={
        <div class="org-dialog-foot">
          <Button variant="quiet" onClick={() => close(false)} disabled={busy()}>
            Cancel
          </Button>
          <Button variant="primary" disabled={!from().trim() || Boolean(problem()) || busy()} onClick={() => void run()}>
            {busy() ? "Importing…" : "Import"}
          </Button>
        </div>
      }
    >
      <div class="sk-form">
        <Field
          label="Path or address"
          for="sk-import-from"
          error={problem() ?? error() ?? undefined}
          help="Examples: /home/me/skills/review, github.com/owner/repo/tree/main/skills/review, owner/repo, https://skills.sh/…"
        >
          <TextInput
            id="sk-import-from"
            value={from()}
            placeholder="github.com/owner/repo"
            invalid={Boolean(problem())}
            onInput={(event) => setFrom(event.currentTarget.value)}
            onKeyDown={(event) => event.key === "Enter" && void run()}
          />
        </Field>
      </div>
    </Dialog>
  );
}

type Step = "pick" | "select" | "browse" | "done";

export function ScanProjectsDialog(props: { open: boolean; onOpenChange: (open: boolean) => void }) {
  const company = useCompany();
  const refresh = useRefreshSkills();
  const projects = useProjectsQuery();
  const [step, setStep] = createSignal<Step>("pick");
  const [project, setProject] = createSignal<Project | null>(null);
  const [scan, setScan] = createSignal<CompanySkillProjectScanResult | null>(null);
  const [picked, setPicked] = createSignal<ReadonlyMap<string, ScanSelection>>(new Map());
  const [busy, setBusy] = createSignal(false);
  const [error, setError] = createSignal<string | null>(null);
  const [done, setDone] = createSignal<CompanySkillProjectScanResult | null>(null);

  const withWorkspaces = createMemo(() => (projects.data ?? []).filter((entry) => !entry.archivedAt && entry.workspaces.length > 0));
  const candidates = () => scan()?.candidates ?? [];
  const invalid = () => [...picked().values()].some((selection) => slugProblem(selection.slug));

  const reset = () => {
    setStep("pick");
    setProject(null);
    setScan(null);
    setPicked(new Map());
    setError(null);
    setDone(null);
  };
  const close = (open: boolean) => {
    props.onOpenChange(open);
    if (!open) reset();
  };

  const preview = async (chosen: Project) => {
    setProject(chosen);
    setBusy(true);
    setError(null);
    try {
      const result = await skillsApi.scanProjects(company().id, { projectIds: [chosen.id], mode: "preview" });
      setScan(result);
      setPicked(new Map());
      setStep("select");
    } catch (caught) {
      setError(failureText(caught, "Couldn't scan the project."));
    } finally {
      setBusy(false);
    }
  };

  const toggle = (candidate: CompanySkillProjectScanCandidate) => {
    if (!selectableCandidate(candidate)) return;
    setPicked((current) => {
      const next = new Map(current);
      const key = scanKey(candidate.workspaceId, candidate.relativePath);
      if (next.has(key)) next.delete(key);
      else next.set(key, { workspaceId: candidate.workspaceId, path: candidate.relativePath, ...(candidate.status === "conflict" ? { slug: conflictSlug(candidate) } : {}) });
      return next;
    });
  };

  const rename = (candidate: CompanySkillProjectScanCandidate, slug: string) =>
    setPicked((current) => {
      const key = scanKey(candidate.workspaceId, candidate.relativePath);
      const found = current.get(key);
      if (!found) return current;
      return new Map(current).set(key, { ...found, slug });
    });

  const importPicked = async () => {
    const chosen = project();
    if (!chosen || picked().size === 0 || invalid()) return;
    setBusy(true);
    setError(null);
    try {
      const result = await skillsApi.scanProjects(company().id, { projectIds: [chosen.id], mode: "import", selection: [...picked().values()] });
      refresh();
      setDone(result);
      setStep("done");
      pushToast({
        tone: result.imported.length > 0 ? "success" : "info",
        title: result.imported.length > 0 ? `Imported ${result.imported.length} ${result.imported.length === 1 ? "skill" : "skills"}` : "Nothing imported",
        body: `From ${chosen.name}.`,
      });
    } catch (caught) {
      setError(failureText(caught, "Couldn't import the skills."));
    } finally {
      setBusy(false);
    }
  };

  /** A folder picked while browsing: preview just it, and pick it when it's a usable skill. */
  const addBrowsed = async (workspaceId: string, path: string) => {
    const chosen = project();
    if (!chosen) return;
    const folder = skillFolderOf(path);
    setBusy(true);
    setError(null);
    try {
      const result = await skillsApi.scanProjects(company().id, { projectIds: [chosen.id], mode: "preview", selection: [{ workspaceId, path: folder }] });
      const found = result.candidates.find((entry) => entry.workspaceId === workspaceId && entry.relativePath === folder);
      if (!found || !selectableCandidate(found)) {
        setError(found?.status === "already_imported" ? "That skill is already in the library." : (found?.reason ?? "That folder has no usable SKILL.md."));
        return;
      }
      setScan((current) => {
        const known = current?.candidates.some((entry) => entry.workspaceId === workspaceId && entry.relativePath === folder);
        return current ? { ...current, candidates: known ? current.candidates : [...current.candidates, found] } : result;
      });
      setPicked((current) => new Map(current).set(scanKey(workspaceId, folder), { workspaceId, path: folder, ...(found.status === "conflict" ? { slug: conflictSlug(found) } : {}) }));
      setStep("select");
    } catch (caught) {
      setError(failureText(caught, "Couldn't read that folder."));
    } finally {
      setBusy(false);
    }
  };

  const footer = () => (
    <div class="org-dialog-foot">
      <Switch>
        <Match when={step() === "select"}>
          <Button variant="quiet" icon={<ArrowLeft size={14} aria-hidden="true" />} onClick={() => setStep("pick")} disabled={busy()}>
            Projects
          </Button>
          <Button variant="primary" disabled={picked().size === 0 || invalid() || busy()} onClick={() => void importPicked()}>
            {busy() ? "Importing…" : `Import ${picked().size} ${picked().size === 1 ? "skill" : "skills"}`}
          </Button>
        </Match>
        <Match when={step() === "browse"}>
          <Button variant="quiet" icon={<ArrowLeft size={14} aria-hidden="true" />} onClick={() => setStep("select")} disabled={busy()}>
            Back to the scan
          </Button>
        </Match>
        <Match when={true}>
          <Button variant="quiet" onClick={() => close(false)}>
            {step() === "done" ? "Done" : "Cancel"}
          </Button>
        </Match>
      </Switch>
    </div>
  );

  return (
    <Dialog
      open={props.open}
      onOpenChange={close}
      width={680}
      title={project() && step() !== "pick" ? `Skills in ${project()!.name}` : "Scan a project for skills"}
      description="Skill folders (with a SKILL.md) in a project's workspaces. Imported skills keep reading the workspace's files."
      footer={footer()}
    >
      <div class="sk-form">
        <Switch>
          <Match when={step() === "pick"}>
            <Switch>
              <Match when={projects.isPending}>
                <p class="org-muted">Loading projects…</p>
              </Match>
              <Match when={withWorkspaces().length === 0}>
                <p class="org-muted">No project has a workspace to scan yet. Give a project a code folder or repository first.</p>
              </Match>
            </Switch>
            <ul class="sk-candidates">
              <For each={withWorkspaces()}>
                {(entry) => (
                  <li>
                    <button type="button" class="sk-candidate" disabled={busy()} onClick={() => void preview(entry)}>
                      <FolderSearch size={15} aria-hidden="true" />
                      <span class="sk-candidate-text">
                        <span class="org-strong">{entry.name}</span>
                        <span class="org-muted">
                          {entry.workspaces.length === 1 ? entry.workspaces[0]!.name : `${entry.workspaces.length} workspaces`}
                        </span>
                      </span>
                      <Show when={busy() && project()?.id === entry.id}>
                        <span class="org-muted org-push">Scanning…</span>
                      </Show>
                    </button>
                  </li>
                )}
              </For>
            </ul>
          </Match>

          <Match when={step() === "select" && scan()}>
            {(result) => (
              <>
                <p class="org-muted">
                  {result().scannedWorkspaces} {result().scannedWorkspaces === 1 ? "workspace" : "workspaces"} scanned, {candidates().length} {candidates().length === 1 ? "skill" : "skills"} found.{" "}
                  <button type="button" class="act-linkish" onClick={() => setStep("browse")}>
                    Browse for a folder
                  </button>
                </p>
                <For each={result().warnings}>{(warning) => <p class="sk-warning">{warning}</p>}</For>
                <For each={result().skipped}>
                  {(skipped) => (
                    <p class="sk-warning">
                      {skipped.workspaceName ?? skipped.projectName ?? "A workspace"}: {skipped.reason}
                    </p>
                  )}
                </For>
                <ul class="sk-candidates">
                  <For each={candidates()}>
                    {(candidate) => {
                      const key = () => scanKey(candidate.workspaceId, candidate.relativePath);
                      const selection = () => picked().get(key());
                      return (
                        <li>
                          <button
                            type="button"
                            role="checkbox"
                            class="sk-candidate"
                            aria-checked={Boolean(selection())}
                            disabled={!selectableCandidate(candidate)}
                            onClick={() => toggle(candidate)}
                          >
                            <span class="org-cbox" aria-hidden="true">
                              <Show when={selection()}>
                                <Check size={11} stroke-width={3.2} />
                              </Show>
                            </span>
                            <span class="sk-candidate-text">
                              <span class="org-row">
                                <span class="org-strong">{candidate.name}</span>
                                <TonePill tone={candidate.status === "new" ? "green" : candidate.status === "conflict" ? "amber" : "violet"} compact>
                                  {candidateStatus(candidate)}
                                </TonePill>
                              </span>
                              <span class="mono org-muted">
                                {candidate.workspaceName} · {candidate.relativePath || "/"}
                              </span>
                              <Show when={candidate.description}>
                                <span class="org-muted sk-clamp">{candidate.description}</span>
                              </Show>
                              <Show when={candidate.reason}>
                                <span class="sk-warning">{candidate.reason}</span>
                              </Show>
                            </span>
                          </button>
                          <Show when={selection()?.slug !== undefined}>
                            <div class="sk-rename">
                              <Field label="Import as" for={`sk-scan-${key()}`} error={slugProblem(selection()!.slug) ?? undefined}>
                                <TextInput id={`sk-scan-${key()}`} value={selection()!.slug ?? ""} onInput={(event) => rename(candidate, event.currentTarget.value)} />
                              </Field>
                            </div>
                          </Show>
                        </li>
                      );
                    }}
                  </For>
                </ul>
              </>
            )}
          </Match>

          <Match when={step() === "browse" && project()}>
            {(chosen) => <ProjectBrowser project={chosen()} busy={busy()} onPick={(workspaceId, path) => void addBrowsed(workspaceId, path)} />}
          </Match>

          <Match when={step() === "done" && done()}>
            {(result) => (
              <>
                <p>
                  <Sparkles size={14} aria-hidden="true" /> {result().imported.length} imported
                  {result().updated.length > 0 ? `, ${result().updated.length} updated` : ""}
                  {result().conflicts.length > 0 ? `, ${result().conflicts.length} left out because the name is taken` : ""}.
                </p>
                <ul class="sk-chips">
                  <For each={result().imported}>
                    {(skill) => (
                      <li>
                        <A class="sk-chip" href={`/${company().issuePrefix}/skills/${skill.id}`} onClick={() => close(false)}>
                          {skill.name}
                        </A>
                      </li>
                    )}
                  </For>
                </ul>
              </>
            )}
          </Match>
        </Switch>
        <Show when={error()}>
          <p class="field-error" role="alert">
            {error()}
          </p>
        </Show>
      </div>
    </Dialog>
  );
}

/** Walks one workspace's folders; skill folders are marked and can be added. */
function ProjectBrowser(props: { project: Project; busy: boolean; onPick: (workspaceId: string, path: string) => void }) {
  const company = useCompany();
  const [workspaceId, setWorkspaceId] = createSignal(props.project.workspaces.find((workspace) => workspace.isPrimary)?.id ?? props.project.workspaces[0]?.id ?? "");
  const [listing, setListing] = createSignal<CompanySkillProjectBrowseResult | null>(null);
  const [loading, setLoading] = createSignal(false);
  const [error, setError] = createSignal<string | null>(null);

  const open = async (path: string | null) => {
    setLoading(true);
    setError(null);
    try {
      setListing(await skillsApi.browseProject(company().id, { projectId: props.project.id, workspaceId: workspaceId(), path }));
    } catch (caught) {
      setError(failureText(caught, "Couldn't open that folder."));
    } finally {
      setLoading(false);
    }
  };
  onMount(() => void open(null));

  return (
    <div class="sk-browse">
      <Show when={props.project.workspaces.length > 1}>
        <label class="act-date">
          <span>Workspace</span>
          <select
            class="input"
            value={workspaceId()}
            onChange={(event) => {
              setWorkspaceId(event.currentTarget.value);
              void open(null);
            }}
          >
            <For each={props.project.workspaces}>{(workspace) => <option value={workspace.id}>{workspace.name}</option>}</For>
          </select>
        </label>
      </Show>
      <Show when={listing()}>
        {(current) => (
          <>
            <p class="mono org-muted sk-browse-path">
              {current().workspaceName}/{current().path || ""}
            </p>
            <ul class="sk-files sk-browse-list">
              <Show when={current().parentPath !== null}>
                <li>
                  <button type="button" class="sk-file" disabled={loading()} onClick={() => void open(current().parentPath)}>
                    <ArrowLeft size={14} aria-hidden="true" />
                    <span>Up a folder</span>
                  </button>
                </li>
              </Show>
              <For each={current().entries}>
                {(entry) => (
                  <li class="sk-browse-entry">
                    <button
                      type="button"
                      class="sk-file"
                      disabled={loading() || entry.kind === "file"}
                      onClick={() => entry.kind === "directory" && void open(entry.path)}
                    >
                      <Show when={entry.kind === "directory"} fallback={<FileText size={14} aria-hidden="true" />}>
                        <Show when={entry.isSkill} fallback={<Folder size={14} aria-hidden="true" />}>
                          <FolderOpen size={14} aria-hidden="true" />
                        </Show>
                      </Show>
                      <span class="mono org-ellipsis">{entry.name}</span>
                      <Show when={entry.isSkill}>
                        <TonePill tone="green" compact>
                          Skill
                        </TonePill>
                      </Show>
                    </button>
                    <Show when={entry.isSkill}>
                      <Button size="compact" disabled={props.busy} onClick={() => props.onPick(current().workspaceId, entry.path)}>
                        Add
                      </Button>
                    </Show>
                  </li>
                )}
              </For>
            </ul>
            <Show when={current().truncated}>
              <p class="org-muted">Only the first entries are shown.</p>
            </Show>
          </>
        )}
      </Show>
      <Show when={loading() && !listing()}>
        <p class="org-muted">Loading…</p>
      </Show>
      <Show when={error()}>
        <p class="field-error" role="alert">
          {error()}
        </p>
      </Show>
    </div>
  );
}
