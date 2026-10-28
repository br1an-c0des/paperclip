import type { CompanySkillDetail, CompanySkillVersion } from "@paperclipai/shared";
import { A, useNavigate } from "@solidjs/router";
import { createQuery, useQueryClient } from "@tanstack/solid-query";
import { ArrowLeft, FilePlus, FileText, History, Plus, Save, Trash2 } from "lucide-solid";
import { createEffect, createMemo, createSignal, For, Match, on, Show, Switch } from "solid-js";
import { queryKeys } from "@/api/queryKeys";
import { skillsApi } from "@/api/skills";
import { ConfirmDialog } from "@/documents/ConfirmDialog";
import { MarkdownEditor } from "@/documents/MarkdownEditor";
import { useCompany } from "@/lib/company";
import { Button, buttonClass } from "@/ui/Button";
import { Dialog } from "@/ui/Dialog";
import { Field, TextArea, TextInput } from "@/ui/Field";
import { TonePill } from "@/ui/Status";
import { pushToast } from "@/ui/Toast";
import { failureText, useRefreshSkills, useSkillDetail, useSkillList, useSkillVersions } from "./queries";
import { OriginPill, whenLabel } from "./SkillLibrary";
import { createPayload, draftProblem, newFileProblem, skillOrigin, slugFor, sortedFiles, versionName, type SkillDraft } from "./skills-model";

/*
 * The Studio (`/:prefix/skills/studio`): skills written in this company.
 *
 * - Home lists the authored skills and starts a new one.
 * - New skill (`/studio/new`) takes a name, slug, description and categories and creates the skill
 *   with a starting SKILL.md (`POST /companies/:id/skills`).
 * - A skill (`/studio/:skillId`) edits its files: SKILL.md and any others, in the document editor,
 *   saved with Save or Ctrl/Cmd+S (`PATCH …/files`; the server keeps a version of each change). New
 *   files and deleting them (`DELETE …/files`). "Save version" names the current files as a version
 *   (`POST …/versions`); Restore writes an earlier version's files back and saves that as a new
 *   version, as the old Studio does. Deleting the skill removes it from every agent.
 *
 * Bundled and imported skills are read-only here. Not ported: test runs and their inputs and
 * templates (they run a real agent), forking, folders, sharing, and the version diff.
 */

export function StudioHome() {
  const company = useCompany();
  const base = () => `/${company().issuePrefix}/skills`;
  const skills = useSkillList();
  const authored = createMemo(() =>
    (skills.data ?? []).filter((skill) => skillOrigin(skill) === "authored").sort((a, b) => new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime()),
  );
  return (
    <section class="act-section" aria-label="Studio">
      <div class="act-toolbar">
        <span class="org-muted">Skills written here. Bundled and imported skills are read-only; their source keeps them up to date.</span>
        <div class="act-toolbar-end">
          <A class={buttonClass({ variant: "primary", size: "compact" })} href={`${base()}/studio/new`}>
            <Plus size={14} stroke-width={2.2} aria-hidden="true" />
            New skill
          </A>
        </div>
      </div>
      <section class="card act-card" aria-label="Authored skills">
        <Switch>
          <Match when={skills.isPending}>
            <p class="org-empty">Loading…</p>
          </Match>
          <Match when={authored().length === 0}>
            <p class="org-empty">No skills written here yet. Start one with New skill.</p>
          </Match>
        </Switch>
        <ul class="act-list">
          <For each={authored()}>
            {(skill) => (
              <li>
                <A class="sk-row" href={`${base()}/studio/${skill.id}`}>
                  <span class="sk-row-main">
                    <span class="org-strong org-ellipsis">{skill.name}</span>
                    <span class="org-muted sk-row-desc">{skill.description ?? skill.slug}</span>
                  </span>
                  <span class="org-muted sk-row-num">{skill.attachedAgentCount === 0 ? "No agents" : `${skill.attachedAgentCount} ${skill.attachedAgentCount === 1 ? "agent" : "agents"}`}</span>
                  <span class="org-muted sk-row-num">Edited {whenLabel(skill.updatedAt)}</span>
                </A>
              </li>
            )}
          </For>
        </ul>
      </section>
    </section>
  );
}

export function NewSkill() {
  const company = useCompany();
  const navigate = useNavigate();
  const refreshSkills = useRefreshSkills();
  const skills = useSkillList();
  const [draft, setDraft] = createSignal<SkillDraft>({ name: "", slug: "", description: "", categories: "" });
  const [slugEdited, setSlugEdited] = createSignal(false);
  const [busy, setBusy] = createSignal(false);
  const [error, setError] = createSignal<string | null>(null);
  const [tried, setTried] = createSignal(false);
  const problem = () => draftProblem(draft(), skills.data ?? []);
  const patch = (next: Partial<SkillDraft>) => setDraft((current) => ({ ...current, ...next }));

  const create = async () => {
    setTried(true);
    if (problem()) return;
    setBusy(true);
    setError(null);
    try {
      const skill = await skillsApi.create(company().id, createPayload(draft()));
      refreshSkills();
      pushToast({ tone: "success", title: `Created ${skill.name}`, body: "Write its instructions in SKILL.md." });
      navigate(`/${company().issuePrefix}/skills/studio/${skill.id}`, { replace: true });
    } catch (caught) {
      setError(failureText(caught, "Couldn't create the skill."));
    } finally {
      setBusy(false);
    }
  };

  return (
    <section class="card sk-new" aria-labelledby="sk-new-h">
      <header class="chead">
        <h3 class="disp" id="sk-new-h">
          New skill
        </h3>
        <p>A skill is a folder of instructions (SKILL.md) and any files they refer to. Once it exists, turn it on for agents in their Skills settings.</p>
      </header>
      <div class="sk-form">
        <Field label="Name" for="sk-name" error={tried() && problem() ? problem()! : undefined}>
          <TextInput
            id="sk-name"
            value={draft().name}
            placeholder="Release notes"
            autofocus
            onInput={(event) => patch({ name: event.currentTarget.value, ...(slugEdited() ? {} : { slug: slugFor(event.currentTarget.value) }) })}
          />
        </Field>
        <Field label="Slug" for="sk-slug" help="The skill's folder name, which agents see.">
          <TextInput
            id="sk-slug"
            class="mono"
            value={draft().slug}
            placeholder="release-notes"
            onInput={(event) => {
              setSlugEdited(true);
              patch({ slug: event.currentTarget.value });
            }}
          />
        </Field>
        <Field label="Description" for="sk-desc" help="When agents should use it. Agents read this to decide.">
          <TextArea id="sk-desc" rows={3} value={draft().description} onInput={(event) => patch({ description: event.currentTarget.value })} />
        </Field>
        <Field label="Categories" for="sk-cats" help="Optional, separated by commas.">
          <TextInput id="sk-cats" value={draft().categories} placeholder="Writing, Docs" onInput={(event) => patch({ categories: event.currentTarget.value })} />
        </Field>
        <Show when={error()}>
          <p class="field-error" role="alert">
            {error()}
          </p>
        </Show>
      </div>
      <footer class="cfoot">
        <A class={buttonClass({ variant: "quiet" })} href={`/${company().issuePrefix}/skills/studio`}>
          Cancel
        </A>
        <Button variant="primary" disabled={busy()} onClick={() => void create()}>
          {busy() ? "Creating…" : "Create skill"}
        </Button>
      </footer>
    </section>
  );
}

export function SkillStudio(props: { skillId: string }) {
  const company = useCompany();
  const base = () => `/${company().issuePrefix}/skills`;
  const detail = useSkillDetail(() => props.skillId);
  return (
    <Switch>
      <Match when={detail.isPending}>
        <section class="card act-card">
          <p class="org-empty">Loading the skill…</p>
        </section>
      </Match>
      <Match when={detail.isError}>
        <section class="card act-card">
          <p class="org-empty">Couldn't load this skill. {detail.error instanceof Error ? detail.error.message : ""}</p>
        </section>
      </Match>
      <Match when={detail.data && (!detail.data.editable || skillOrigin(detail.data) !== "authored") ? detail.data : null}>
        {(skill) => (
          <section class="card act-card">
            <div class="org-empty">
              <p>
                {skill().name} is {skillOrigin(skill()) === "bundled" ? "bundled with Paperclip" : "imported"}, so it's read-only here. {skill().editableReason ?? ""}
              </p>
              <A class={buttonClass({ size: "compact" })} href={`${base()}/${skill().id}`}>
                Open in the library
              </A>
            </div>
          </section>
        )}
      </Match>
      <Match when={detail.data}>{(skill) => <StudioEditor skill={skill()} />}</Match>
    </Switch>
  );
}

function StudioEditor(props: { skill: CompanySkillDetail }) {
  const company = useCompany();
  const base = () => `/${company().issuePrefix}/skills`;
  const navigate = useNavigate();
  const client = useQueryClient();
  const refreshSkills = useRefreshSkills();
  const versions = useSkillVersions(() => props.skill.id);
  const files = createMemo(() => sortedFiles(props.skill.fileInventory));
  const [path, setPath] = createSignal("SKILL.md");
  const [draft, setDraft] = createSignal<string | null>(null);
  const [saving, setSaving] = createSignal(false);
  const [pendingPath, setPendingPath] = createSignal<string | null>(null);
  const [newFileOpen, setNewFileOpen] = createSignal(false);
  const [versionOpen, setVersionOpen] = createSignal(false);
  const [deleteFileOpen, setDeleteFileOpen] = createSignal(false);
  const [deleteSkillOpen, setDeleteSkillOpen] = createSignal(false);
  const [restoring, setRestoring] = createSignal<CompanySkillVersion | null>(null);

  // A new file starts empty: there's nothing on the server until it's saved.
  const isNew = () => !props.skill.fileInventory.some((entry) => entry.path === path());
  const file = createQuery(() => ({
    queryKey: queryKeys.skills.file(company().id, props.skill.id, path()),
    queryFn: ({ signal }) => skillsApi.file(company().id, props.skill.id, path(), signal),
    enabled: !isNew(),
  }));
  const saved = () => file.data?.content ?? "";
  createEffect(on(path, () => setDraft(null)));
  const text = () => draft() ?? saved();
  const dirty = () => draft() !== null && draft() !== saved();
  const binary = () => file.data?.encoding === "base64";

  const refresh = () => {
    refreshSkills(props.skill.id);
    void client.invalidateQueries({ queryKey: queryKeys.skills.detail(company().id, props.skill.id) });
  };

  const save = async () => {
    if (!dirty() && !isNew()) return;
    setSaving(true);
    try {
      const result = await skillsApi.saveFile(company().id, props.skill.id, path(), text(), file.data ? { executable: file.data.executable } : {});
      // The draft stays: once the cache has the saved text it matches, and clearing it now would show
      // the cached text from before the save for a moment (and the editor would take it up).
      client.setQueryData(queryKeys.skills.file(company().id, props.skill.id, path()), result);
      refresh();
      pushToast({ tone: "success", title: `Saved ${path()}` });
    } catch (error) {
      pushToast({ tone: "error", title: `Couldn't save ${path()}`, body: failureText(error, "") });
    } finally {
      setSaving(false);
    }
  };

  const open = (next: string) => {
    if (next === path()) return;
    if (dirty()) setPendingPath(next);
    else setPath(next);
  };

  const deleteFile = async () => {
    try {
      await skillsApi.deleteFile(company().id, props.skill.id, path());
      pushToast({ tone: "success", title: `Deleted ${path()}` });
      setPath("SKILL.md");
      refresh();
    } catch (error) {
      pushToast({ tone: "error", title: `Couldn't delete ${path()}`, body: failureText(error, "") });
    }
  };

  const deleteSkill = async () => {
    try {
      await skillsApi.remove(company().id, props.skill.id);
      pushToast({ tone: "success", title: `Deleted ${props.skill.name}` });
      refreshSkills();
      navigate(`${base()}/studio`, { replace: true });
    } catch (error) {
      pushToast({ tone: "error", title: `Couldn't delete ${props.skill.name}`, body: failureText(error, "") });
    }
  };

  const restore = async (version: CompanySkillVersion) => {
    try {
      for (const entry of version.fileInventory) {
        await skillsApi.saveFile(company().id, props.skill.id, entry.path, entry.content, { encoding: entry.encoding, executable: entry.executable ?? false });
      }
      await skillsApi.createVersion(company().id, props.skill.id, `Restore of v${version.revisionNumber}`);
      setDraft(null);
      void client.invalidateQueries({ queryKey: queryKeys.skills.detail(company().id, props.skill.id) });
      refreshSkills();
      pushToast({ tone: "success", title: `Restored v${version.revisionNumber}`, body: "Saved as a new version." });
    } catch (error) {
      pushToast({ tone: "error", title: `Couldn't restore v${version.revisionNumber}`, body: failureText(error, "") });
    }
  };

  return (
    <div class="sk-studio">
      <header class="card sk-studio-head">
        <A class={buttonClass({ variant: "icon", size: "compact", ghost: true })} href={`${base()}/studio`} aria-label="Back to the Studio">
          <ArrowLeft size={15} aria-hidden="true" />
        </A>
        <div class="sk-detail-title">
          <h2 class="disp">{props.skill.name}</h2>
          <div class="org-row">
            <OriginPill origin="authored" />
            <span class="org-muted">
              {props.skill.currentVersion ? versionName(props.skill.currentVersion) : "No version yet"} ·{" "}
              {props.skill.attachedAgentCount === 0 ? "no agents use it" : `${props.skill.attachedAgentCount} ${props.skill.attachedAgentCount === 1 ? "agent uses" : "agents use"} it`}
            </span>
          </div>
        </div>
        <div class="org-push org-row">
          <A class={buttonClass({ size: "compact", variant: "quiet" })} href={`${base()}/${props.skill.id}`}>
            In the library
          </A>
          <Button size="compact" icon={<History size={14} aria-hidden="true" />} onClick={() => setVersionOpen(true)}>
            Save version
          </Button>
          <Button size="compact" variant="danger" icon={<Trash2 size={14} aria-hidden="true" />} onClick={() => setDeleteSkillOpen(true)}>
            Delete
          </Button>
        </div>
      </header>

      <div class="sk-studio-body">
        <aside class="card sk-studio-files" aria-label="Files">
          <div class="org-card-row">
            <h3 class="sk-block-head">Files</h3>
            <button type="button" class={`${buttonClass({ variant: "icon", size: "compact", ghost: true })} org-push`} aria-label="New file" onClick={() => setNewFileOpen(true)}>
              <FilePlus size={15} aria-hidden="true" />
            </button>
          </div>
          <ul class="sk-files">
            <For each={files()}>
              {(entry) => (
                <li>
                  <button type="button" class="sk-file" aria-current={entry.path === path() ? "true" : undefined} onClick={() => open(entry.path)}>
                    <FileText size={14} aria-hidden="true" />
                    <span class="mono org-ellipsis">{entry.path}</span>
                  </button>
                </li>
              )}
            </For>
            <Show when={isNew()}>
              <li>
                <button type="button" class="sk-file" aria-current="true">
                  <FileText size={14} aria-hidden="true" />
                  <span class="mono org-ellipsis">{path()}</span>
                  <span class="org-muted">new</span>
                </button>
              </li>
            </Show>
          </ul>

          <div class="org-card-row sk-versions-head">
            <h3 class="sk-block-head">Versions</h3>
          </div>
          <Show when={(versions.data ?? []).length > 0} fallback={<p class="org-muted">{versions.isPending ? "Loading…" : "None yet."}</p>}>
            <ul class="sk-versions">
              <For each={(versions.data ?? []).slice(0, 12)}>
                {(version) => (
                  <li>
                    <span class="sk-version-text">
                      <span class="org-strong org-ellipsis">{versionName(version)}</span>
                      <span class="org-muted">{whenLabel(version.createdAt)}</span>
                    </span>
                    <Show
                      when={version.id !== props.skill.currentVersionId}
                      fallback={
                        <TonePill tone="green" compact>
                          Current
                        </TonePill>
                      }
                    >
                      <button type="button" class="act-linkish" onClick={() => setRestoring(version)}>
                        Restore
                      </button>
                    </Show>
                  </li>
                )}
              </For>
            </ul>
          </Show>
        </aside>

        <section class="card sk-editor" aria-label={path()}>
          <div class="sk-editor-head">
            <span class="mono org-strong org-ellipsis">{path()}</span>
            <Show when={dirty()}>
              <TonePill tone="amber" compact>
                Unsaved
              </TonePill>
            </Show>
            <div class="org-push org-row">
              <Show when={path() !== "SKILL.md" && !isNew()}>
                <Button size="compact" variant="quiet" onClick={() => setDeleteFileOpen(true)}>
                  Delete file
                </Button>
              </Show>
              <Show when={isNew()}>
                <Button size="compact" variant="quiet" onClick={() => setPath("SKILL.md")}>
                  Discard
                </Button>
              </Show>
              <Button size="compact" variant="primary" icon={<Save size={14} aria-hidden="true" />} disabled={(!dirty() && !isNew()) || saving() || binary()} onClick={() => void save()}>
                {saving() ? "Saving…" : "Save"}
              </Button>
            </div>
          </div>
          <Switch>
            <Match when={!isNew() && file.isPending}>
              <p class="org-muted sk-editor-note">Loading…</p>
            </Match>
            <Match when={!isNew() && file.isError}>
              <p class="org-muted sk-editor-note" role="alert">
                Couldn't open the file. {file.error instanceof Error ? file.error.message : ""}
              </p>
            </Match>
            <Match when={binary()}>
              <p class="org-muted sk-editor-note">This file isn't text, so it can't be edited here.</p>
            </Match>
            <Match when={isNew() || file.data}>
              <Show when={path()} keyed>
                {(current) => <MarkdownEditor value={text()} onChange={setDraft} onSave={() => void save()} label={`Edit ${current}`} autofocus={isNew()} />}
              </Show>
            </Match>
          </Switch>
        </section>
      </div>

      <NewFileDialog
        open={newFileOpen()}
        onOpenChange={setNewFileOpen}
        existing={props.skill.fileInventory}
        onCreate={(next) => {
          setNewFileOpen(false);
          open(next);
        }}
      />
      <SaveVersionDialog open={versionOpen()} onOpenChange={setVersionOpen} skillId={props.skill.id} dirty={dirty()} />
      <ConfirmDialog
        open={pendingPath() !== null}
        onOpenChange={(value) => !value && setPendingPath(null)}
        title="Leave without saving?"
        body={`Your changes to ${path()} haven't been saved.`}
        confirmLabel="Discard changes"
        danger
        onConfirm={() => {
          const next = pendingPath();
          setDraft(null);
          setPendingPath(null);
          if (next) setPath(next);
        }}
      />
      <ConfirmDialog open={deleteFileOpen()} onOpenChange={setDeleteFileOpen} title={`Delete ${path()}?`} body="Earlier versions keep it; agents get the skill without it from the next run." confirmLabel="Delete file" danger onConfirm={deleteFile} />
      <ConfirmDialog
        open={deleteSkillOpen()}
        onOpenChange={setDeleteSkillOpen}
        title={`Delete ${props.skill.name}?`}
        body={
          props.skill.attachedAgentCount > 0
            ? `${props.skill.attachedAgentCount} ${props.skill.attachedAgentCount === 1 ? "agent uses" : "agents use"} it and will lose it. This can't be undone.`
            : "No agent uses it. This can't be undone."
        }
        confirmLabel="Delete skill"
        danger
        onConfirm={deleteSkill}
      />
      <ConfirmDialog
        open={restoring() !== null}
        onOpenChange={(value) => !value && setRestoring(null)}
        title={`Restore v${restoring()?.revisionNumber ?? ""}?`}
        body="Its files are written back over the current ones and saved as a new version. Files added since stay."
        confirmLabel="Restore"
        onConfirm={async () => {
          const version = restoring();
          if (version) await restore(version);
        }}
      />
    </div>
  );
}

function NewFileDialog(props: { open: boolean; onOpenChange: (open: boolean) => void; existing: readonly { path: string }[]; onCreate: (path: string) => void }) {
  const [value, setValue] = createSignal("");
  const [tried, setTried] = createSignal(false);
  const problem = () => newFileProblem(value(), props.existing);
  const submit = () => {
    setTried(true);
    if (problem()) return;
    props.onCreate(value().trim().replace(/^\.?\/+/, ""));
    setValue("");
    setTried(false);
  };
  return (
    <Dialog
      open={props.open}
      onOpenChange={props.onOpenChange}
      width={460}
      title="New file"
      description="It's saved with the skill when you first save it."
      footer={
        <div class="org-dialog-foot">
          <Button variant="quiet" onClick={() => props.onOpenChange(false)}>
            Cancel
          </Button>
          <Button variant="primary" onClick={submit}>
            Create
          </Button>
        </div>
      }
    >
      <Field label="Path" for="sk-file-path" help="Relative to the skill's folder, like references/style.md." error={tried() && problem() ? problem()! : undefined}>
        <TextInput id="sk-file-path" class="mono" value={value()} placeholder="references/notes.md" onInput={(event) => setValue(event.currentTarget.value)} onKeyDown={(event) => event.key === "Enter" && submit()} />
      </Field>
    </Dialog>
  );
}

function SaveVersionDialog(props: { open: boolean; onOpenChange: (open: boolean) => void; skillId: string; dirty: boolean }) {
  const company = useCompany();
  const client = useQueryClient();
  const refreshSkills = useRefreshSkills();
  const [label, setLabel] = createSignal("");
  const [busy, setBusy] = createSignal(false);
  const save = async () => {
    setBusy(true);
    try {
      const version = await skillsApi.createVersion(company().id, props.skillId, label().trim() || null);
      void client.invalidateQueries({ queryKey: queryKeys.skills.detail(company().id, props.skillId) });
      refreshSkills();
      pushToast({ tone: "success", title: `Saved ${versionName(version)}` });
      setLabel("");
      props.onOpenChange(false);
    } catch (error) {
      pushToast({ tone: "error", title: "Couldn't save the version", body: failureText(error, "") });
    } finally {
      setBusy(false);
    }
  };
  return (
    <Dialog
      open={props.open}
      onOpenChange={props.onOpenChange}
      width={460}
      title="Save version"
      description="Names the skill's files as they are now, so agents can be pinned to it and you can come back to it."
      footer={
        <div class="org-dialog-foot">
          <Button variant="quiet" onClick={() => props.onOpenChange(false)} disabled={busy()}>
            Cancel
          </Button>
          <Button variant="primary" onClick={() => void save()} disabled={busy()}>
            {busy() ? "Saving…" : "Save version"}
          </Button>
        </div>
      }
    >
      <Show when={props.dirty}>
        <p class="sk-warning">The open file has unsaved changes; they aren't part of the version until you save the file.</p>
      </Show>
      <Field label="Label" for="sk-version-label" help="Optional, like “Adds the style guide”.">
        <TextInput id="sk-version-label" value={label()} onInput={(event) => setLabel(event.currentTarget.value)} onKeyDown={(event) => event.key === "Enter" && void save()} />
      </Field>
    </Dialog>
  );
}
