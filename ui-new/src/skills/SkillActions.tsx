import type { CompanySkillAuditResult, CompanySkillDetail, CompanySkillVersion, CompanySkillVersionSummary } from "@paperclipai/shared";
import { useNavigate } from "@solidjs/router";
import { createQuery, useQueryClient } from "@tanstack/solid-query";
import { Check, Download, FileText, GitFork, RotateCcw, Star } from "lucide-solid";
import { createEffect, createMemo, createSignal, For, Match, on, Show, Switch } from "solid-js";
import { createStore } from "solid-js/store";
import { ApiError } from "@/api/client";
import { queryKeys } from "@/api/queryKeys";
import { skillsApi } from "@/api/skills";
import { ConfirmDialog } from "@/documents/ConfirmDialog";
import { diffCounts, lineDiff } from "@/documents/document-model";
import { useCompany } from "@/lib/company";
import { Button } from "@/ui/Button";
import { Dialog } from "@/ui/Dialog";
import { Field, TextArea, TextInput } from "@/ui/Field";
import { Segmented } from "@/ui/Segmented";
import { TonePill } from "@/ui/Status";
import { pushToast } from "@/ui/Toast";
import { failureText, useRefreshSkills, useSkillUpdateStatus, useSkillVersion } from "./queries";
import {
  auditDrift,
  auditLine,
  auditVerdict,
  canForceInstall,
  canRename,
  canReset,
  renameRequest,
  settingsDraft,
  settingsPatch,
  settingsProblem,
  SHARING_OPTIONS,
  type SkillSettingsDraft,
} from "./skill-settings-model";
import { comparedPaths, compareSelection, fileChange, slugFor, updateLine, versionName } from "./skills-model";
import "@/documents/DocumentView.css";

/*
 * What a skill's detail can do beyond showing it (the old library's skill page):
 *
 * - Star it (`POST|DELETE …/star`); the count is the company's.
 * - Fork it (`GET …/fork-precheck`, `POST …/fork`): an editable copy authored here, optionally moving
 *   the agents that use the original onto the copy. The copy opens in the Studio.
 * - Updates (`GET …/update-status`, `POST …/install-update`) for skills from a source, the catalog or
 *   a URL: whether a newer version is out, why it's held, and installing it (anyway, with `force`,
 *   when it's held for edits made here). A catalog skill resets to the catalog's files.
 * - Settings (`PATCH …`, `POST …/rename`): name, description, tagline, categories, author,
 *   homepage, icon, colour and who sees it (skill-settings-model.ts).
 * - The safety check (`POST …/audit`).
 * - Compare versions: two of the skill's versions side by side, file by file, as a line diff. The
 *   versions list carries each version's files, so nothing more is fetched.
 */

export function StarButton(props: { skill: Pick<CompanySkillDetail, "id" | "starCount" | "starredByCurrentActor"> }) {
  const company = useCompany();
  const refresh = useRefreshSkills();
  const [busy, setBusy] = createSignal(false);
  const toggle = async () => {
    setBusy(true);
    try {
      if (props.skill.starredByCurrentActor) await skillsApi.unstar(company().id, props.skill.id);
      else await skillsApi.star(company().id, props.skill.id);
      refresh(props.skill.id);
    } catch (error) {
      pushToast({ tone: "error", title: "Couldn't change the star", body: failureText(error, "") });
    } finally {
      setBusy(false);
    }
  };
  return (
    <Button
      size="compact"
      variant="quiet"
      class="sk-star"
      classList={{ "sk-star--on": props.skill.starredByCurrentActor }}
      aria-pressed={props.skill.starredByCurrentActor}
      aria-label={props.skill.starredByCurrentActor ? "Remove your star" : "Star this skill"}
      title={props.skill.starredByCurrentActor ? "Remove your star" : "Star this skill"}
      disabled={busy()}
      icon={<Star size={14} aria-hidden="true" />}
      onClick={() => void toggle()}
    >
      {props.skill.starCount}
    </Button>
  );
}

/**
 * Update status for skills that come from somewhere; nothing for authored ones. An update held for
 * edits made here can be installed anyway, discarding them; a catalog skill can also be reset to
 * the catalog's files.
 */
export function UpdateBlock(props: { skill: Pick<CompanySkillDetail, "id" | "name" | "sourceType" | "currentVersionId"> }) {
  const company = useCompany();
  const client = useQueryClient();
  const refresh = useRefreshSkills();
  const status = useSkillUpdateStatus(() => props.skill.id);
  const line = createMemo(() => updateLine(status.data));
  const [installing, setInstalling] = createSignal(false);
  const [forcing, setForcing] = createSignal(false);
  const [resetting, setResetting] = createSignal(false);

  const install = async (force = false) => {
    setInstalling(true);
    try {
      await skillsApi.installUpdate(company().id, props.skill.id, { force });
      refresh(props.skill.id);
      void client.invalidateQueries({ queryKey: queryKeys.skills.updateStatus(company().id, props.skill.id) });
      pushToast({ tone: "success", title: `Updated ${props.skill.name}`, body: "Agents using it get the new version on their next run." });
    } catch (error) {
      pushToast({ tone: "error", title: "Couldn't install the update", body: failureText(error, "") });
      if (force) throw error;
    } finally {
      setInstalling(false);
    }
  };

  return (
    <section class="sk-block" aria-labelledby="sk-updates-h">
      <h3 class="sk-block-head" id="sk-updates-h">
        Updates
      </h3>
      <Switch>
        <Match when={status.isPending}>
          <p class="org-muted">Checking…</p>
        </Match>
        <Match when={status.isError}>
          <p class="org-muted">Couldn't check for updates. {failureText(status.error, "")}</p>
        </Match>
        <Match when={line()}>
          {(current) => (
            <div class="sk-update" data-tone={current().tone}>
              <p>
                <Show when={current().tone === "available"}>
                  <TonePill tone="cyan" compact>
                    Update
                  </TonePill>{" "}
                </Show>
                <Show when={current().tone === "held"}>
                  <TonePill tone="amber" compact>
                    Held
                  </TonePill>{" "}
                </Show>
                {current().text}
              </p>
              <div class="org-row">
                <Show when={current().canInstall && !canForceInstall(status.data)}>
                  <Button size="compact" variant="primary" icon={<Download size={14} aria-hidden="true" />} disabled={installing()} onClick={() => void install()}>
                    {installing() ? "Installing…" : "Install update"}
                  </Button>
                </Show>
                <Show when={canForceInstall(status.data)}>
                  <Button size="compact" variant="danger" icon={<Download size={14} aria-hidden="true" />} disabled={installing()} onClick={() => setForcing(true)}>
                    Install anyway…
                  </Button>
                </Show>
                <Show when={canReset(props.skill)}>
                  <Button size="compact" icon={<RotateCcw size={14} aria-hidden="true" />} disabled={installing()} onClick={() => setResetting(true)}>
                    Reset to catalog…
                  </Button>
                </Show>
              </div>
            </div>
          )}
        </Match>
      </Switch>
      <ConfirmDialog
        open={forcing()}
        onOpenChange={setForcing}
        title={`Install the update to ${props.skill.name}?`}
        body="It was edited here since it was installed. Installing the update replaces those edits with the new version; saved versions stay in its history."
        confirmLabel="Discard edits and install"
        danger
        onConfirm={() => install(true)}
      />
      <ResetDialog open={resetting()} onOpenChange={setResetting} skill={props.skill} modified={!!status.data?.userModifiedAt || status.data?.updateHoldReason === "local_modifications"} />
    </section>
  );
}

export function ForkDialog(props: { open: boolean; onOpenChange: (open: boolean) => void; skill: Pick<CompanySkillDetail, "id" | "name" | "slug"> }) {
  const company = useCompany();
  const navigate = useNavigate();
  const refresh = useRefreshSkills();
  const precheck = createQuery(() => ({
    queryKey: queryKeys.skills.forkPrecheck(company().id, props.skill.id),
    queryFn: ({ signal }) => skillsApi.forkPrecheck(company().id, props.skill.id, signal),
    enabled: props.open,
  }));
  const [name, setName] = createSignal("");
  const [moving, setMoving] = createSignal<ReadonlySet<string>>(new Set());
  const [busy, setBusy] = createSignal(false);
  const [error, setError] = createSignal<string | null>(null);

  createEffect(
    on(
      () => props.open,
      (open) => {
        if (!open) return;
        setName(`${props.skill.name} (fork)`);
        setMoving(new Set<string>());
        setError(null);
      },
    ),
  );

  const toggle = (agentId: string) =>
    setMoving((current) => {
      const next = new Set(current);
      if (next.has(agentId)) next.delete(agentId);
      else next.add(agentId);
      return next;
    });

  const fork = async () => {
    setBusy(true);
    setError(null);
    try {
      const clean = name().trim();
      const result = await skillsApi.fork(company().id, props.skill.id, {
        name: clean || null,
        slug: clean ? slugFor(clean) || null : null,
        reassignAgentIds: [...moving()],
      });
      refresh(props.skill.id);
      pushToast({
        tone: "success",
        title: `Forked ${props.skill.name}`,
        body: result.reassignments.length ? `${result.reassignments.length} ${result.reassignments.length === 1 ? "agent now uses" : "agents now use"} the copy.` : "Edit the copy in the Studio.",
      });
      props.onOpenChange(false);
      navigate(`/${company().issuePrefix}/skills/studio/${result.skill.id}`);
    } catch (caught) {
      setError(failureText(caught, "Couldn't fork the skill."));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Dialog
      open={props.open}
      onOpenChange={props.onOpenChange}
      width={520}
      title={`Fork ${props.skill.name}`}
      description="An editable copy, authored here. The original keeps updating from its source; the copy doesn't."
      footer={
        <div class="org-dialog-foot">
          <Button variant="quiet" onClick={() => props.onOpenChange(false)} disabled={busy()}>
            Cancel
          </Button>
          <Button variant="primary" icon={<GitFork size={14} aria-hidden="true" />} disabled={busy() || !name().trim()} onClick={() => void fork()}>
            {busy() ? "Forking…" : "Fork"}
          </Button>
        </div>
      }
    >
      <div class="sk-form">
        <Field label="Name" for="sk-fork-name" help={name().trim() ? `Saved as ${slugFor(name()) || "…"}` : undefined}>
          <TextInput id="sk-fork-name" value={name()} onInput={(event) => setName(event.currentTarget.value)} />
        </Field>
        <Switch>
          <Match when={precheck.isPending}>
            <p class="org-muted">Checking who uses it…</p>
          </Match>
          <Match when={precheck.data}>
            {(data) => (
              <>
                <Show when={data().existingForks.length > 0}>
                  <p class="sk-warning">
                    Already forked as {data().existingForks.map((fork) => fork.name).join(", ")}. Another copy is fine, but you may want to edit one of those instead.
                  </p>
                </Show>
                <Show when={data().usedByAgents.length > 0} fallback={<p class="org-muted">No agent uses the original.</p>}>
                  <p class="org-muted">Move these agents onto the copy (they stop using the original):</p>
                  <ul class="sk-candidates">
                    <For each={data().usedByAgents}>
                      {(agent) => (
                        <li>
                          <button type="button" role="checkbox" class="sk-candidate" aria-checked={moving().has(agent.id)} onClick={() => toggle(agent.id)}>
                            <span class="org-cbox" aria-hidden="true">
                              <Show when={moving().has(agent.id)}>
                                <Check size={11} stroke-width={3.2} />
                              </Show>
                            </span>
                            <span class="sk-candidate-text">
                              <span class="org-strong">{agent.name}</span>
                            </span>
                          </button>
                        </li>
                      )}
                    </For>
                  </ul>
                </Show>
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

/** Two versions of a skill side by side. Opens on `targetId` against the version before it. */
export function CompareVersionsDialog(props: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  skillName: string;
  versions: readonly CompanySkillVersionSummary[];
  targetId?: string | null;
}) {
  const sorted = createMemo(() => [...props.versions].sort((a, b) => b.revisionNumber - a.revisionNumber));
  const [beforeId, setBeforeId] = createSignal<string | null>(null);
  const [afterId, setAfterId] = createSignal<string | null>(null);
  const [path, setPath] = createSignal("SKILL.md");

  createEffect(
    on(
      () => props.open,
      (open) => {
        if (!open) return;
        const picked = compareSelection(props.versions, props.targetId);
        setBeforeId(picked.before);
        setAfterId(picked.after);
        setPath("SKILL.md");
      },
    ),
  );

  // The list names the files only; each side's contents come from its own version read.
  const skillId = () => props.versions[0]?.companySkillId ?? null;
  const beforeQuery = useSkillVersion(skillId, () => (props.open ? beforeId() : null));
  const afterQuery = useSkillVersion(skillId, () => (props.open ? afterId() : null));
  const before = () => (beforeId() ? (beforeQuery.data ?? null) : null);
  const after = () => (afterId() ? (afterQuery.data ?? null) : null);
  const paths = createMemo(() => comparedPaths(before(), after()));
  const current = () => (paths().includes(path()) ? path() : (paths()[0] ?? "SKILL.md"));
  const content = (version: CompanySkillVersion | null) => version?.fileInventory.find((file) => file.path === current())?.content ?? "";

  return (
    <Dialog open={props.open} onOpenChange={props.onOpenChange} width={1000} title="Compare versions" description={props.skillName}>
      <div class="sk-compare">
        <div class="sk-compare-picks">
          <label class="act-date">
            <span>Older</span>
            <select class="input" value={beforeId() ?? ""} onChange={(event) => setBeforeId(event.currentTarget.value || null)}>
              <option value="">Nothing (an empty skill)</option>
              <For each={sorted()}>{(version) => <option value={version.id}>{versionName(version)}</option>}</For>
            </select>
          </label>
          <label class="act-date">
            <span>Newer</span>
            <select class="input" value={afterId() ?? ""} onChange={(event) => setAfterId(event.currentTarget.value || null)}>
              <For each={sorted()}>{(version) => <option value={version.id}>{versionName(version)}</option>}</For>
            </select>
          </label>
        </div>
        <Show when={afterId()} fallback={<p class="org-muted">This skill has no saved versions to compare.</p>}>
          <Show when={beforeQuery.error ?? afterQuery.error}>
            {(error) => <p class="org-muted" role="alert">{failureText(error(), "Couldn't load the versions.")}</p>}
          </Show>
          <Show when={after() && (!beforeId() || before())} fallback={<Show when={!(beforeQuery.error ?? afterQuery.error)}><p class="org-muted">Loading the versions…</p></Show>}>
          <div class="sk-compare-body">
            <ul class="sk-files sk-compare-files" aria-label="Files">
              <For each={paths()}>
                {(entry) => {
                  const change = () => fileChange(before(), after(), entry);
                  return (
                    <li>
                      <button type="button" class="sk-file" aria-current={current() === entry ? "true" : undefined} onClick={() => setPath(entry)}>
                        <FileText size={14} aria-hidden="true" />
                        <span class="mono org-ellipsis">{entry}</span>
                        <Show when={change() !== "same"}>
                          <span class="sk-change" data-change={change()}>
                            {change()}
                          </span>
                        </Show>
                      </button>
                    </li>
                  );
                }}
              </For>
            </ul>
            <Show when={beforeId() !== afterId()} fallback={<p class="org-muted">Both sides are the same version.</p>}>
              <VersionDiff before={content(before())} after={content(after())} beforeLabel={before() ? versionName(before()!) : "Nothing"} afterLabel={versionName(after()!)} />
            </Show>
          </div>
          </Show>
        </Show>
      </div>
    </Dialog>
  );
}

/** A line diff in the document history's style (DocumentView.css). */
function VersionDiff(props: { before: string; after: string; beforeLabel: string; afterLabel: string }) {
  const rows = createMemo(() => lineDiff(props.before, props.after));
  const counts = createMemo(() => diffCounts(rows()));
  return (
    <div class="dv-diff sk-diff">
      <p class="org-muted dv-diff-legend">
        {props.beforeLabel} → {props.afterLabel}: <span class="dv-diff-add">+{counts().added}</span> <span class="dv-diff-del">−{counts().removed}</span>
      </p>
      <Show when={counts().added + counts().removed > 0} fallback={<p class="org-muted">No differences in this file.</p>}>
        <div class="dv-diff-rows mono" role="table" aria-label="Line differences">
          <For each={rows()}>
            {(row) => (
              <div class="dv-diff-row" data-kind={row.kind} role="row">
                <span class="dv-diff-num" role="cell">
                  {row.oldLine ?? ""}
                </span>
                <span class="dv-diff-num" role="cell">
                  {row.newLine ?? ""}
                </span>
                <span class="dv-diff-sign" role="cell" aria-label={row.kind === "added" ? "added" : row.kind === "removed" ? "removed" : undefined}>
                  {row.kind === "added" ? "+" : row.kind === "removed" ? "−" : " "}
                </span>
                <span class="dv-diff-text" role="cell">
                  {row.text || " "}
                </span>
              </div>
            )}
          </For>
        </div>
      </Show>
    </div>
  );
}

/**
 * A skill's settings: its name (skills written here only; agents move to the new key), what the
 * library shows about it, and who sees it. One rename and one `PATCH` at most, each only when
 * something it covers changed.
 */
export function SkillSettingsDialog(props: { open: boolean; onOpenChange: (open: boolean) => void; skill: CompanySkillDetail }) {
  const company = useCompany();
  const refresh = useRefreshSkills();
  const [draft, setDraft] = createStore<SkillSettingsDraft>(settingsDraft(props.skill));
  const [busy, setBusy] = createSignal(false);
  const [error, setError] = createSignal<string | null>(null);
  const renamable = () => canRename(props.skill);

  createEffect(
    on(
      () => props.open,
      (open) => {
        if (!open) return;
        setDraft(settingsDraft(props.skill));
        setError(null);
      },
    ),
  );

  const problem = () => settingsProblem(draft);
  const save = async () => {
    if (problem()) return setError(problem());
    setBusy(true);
    setError(null);
    const rename = renamable() ? renameRequest(props.skill, draft) : null;
    const patch = settingsPatch(props.skill, draft);
    try {
      let moved = 0;
      if (rename) {
        const result = await skillsApi.rename(company().id, props.skill.id, rename);
        moved = result.reassignments.length;
      }
      if (patch) await skillsApi.update(company().id, props.skill.id, patch);
      refresh(props.skill.id);
      pushToast({
        tone: "success",
        title: rename ? `Renamed to ${rename.name}` : `Saved ${props.skill.name}`,
        body: moved ? `${moved} ${moved === 1 ? "agent now uses" : "agents now use"} the new name.` : patch?.sharingScope === "private" ? "Only you see it in the library now." : undefined,
      });
      props.onOpenChange(false);
    } catch (caught) {
      const stale = caught instanceof ApiError && caught.status === 409;
      setError(stale ? `${failureText(caught, "")} Close this and open it again to start from the saved skill.` : failureText(caught, "Couldn't save the settings."));
    } finally {
      setBusy(false);
    }
  };

  const field = (key: keyof Omit<SkillSettingsDraft, "sharingScope">) => ({
    value: draft[key],
    disabled: busy(),
    onInput: (event: InputEvent & { currentTarget: HTMLInputElement | HTMLTextAreaElement }) => setDraft(key, event.currentTarget.value),
  });

  return (
    <Dialog
      open={props.open}
      onOpenChange={props.onOpenChange}
      width={560}
      title={`${props.skill.name} settings`}
      description="How the library shows it, and who sees it."
      footer={
        <div class="org-dialog-foot">
          <Show when={error()}>
            <span class="field-error sk-foot-error" role="alert">
              {error()}
            </span>
          </Show>
          <Button variant="quiet" onClick={() => props.onOpenChange(false)} disabled={busy()}>
            Cancel
          </Button>
          <Button variant="primary" disabled={busy() || (!settingsPatch(props.skill, draft) && !(renamable() && renameRequest(props.skill, draft)))} onClick={() => void save()}>
            {busy() ? "Saving…" : "Save"}
          </Button>
        </div>
      }
    >
      <div class="sk-form">
        <Field
          label="Name"
          for="sk-set-name"
          help={
            renamable()
              ? draft.name.trim() && draft.name.trim() !== props.skill.name
                ? `Saved as ${slugFor(draft.name) || "…"}. Agents using it move to the new name.`
                : undefined
              : "Only skills written here can be renamed. Fork it for a copy you can name."
          }
        >
          <TextInput id="sk-set-name" {...field("name")} disabled={busy() || !renamable()} />
        </Field>
        <Field label="Description" for="sk-set-desc" help="What it's for. Agents read this to decide when to use it.">
          <TextArea id="sk-set-desc" rows={3} {...field("description")} />
        </Field>
        <Field label="Tagline" for="sk-set-tagline" help={`A short line for the library. ${draft.tagline.trim().length}/120`}>
          <TextInput id="sk-set-tagline" {...field("tagline")} invalid={draft.tagline.trim().length > 120} />
        </Field>
        <Field label="Categories" for="sk-set-categories" help="Separated by commas, such as engineering, review.">
          <TextInput id="sk-set-categories" {...field("categories")} />
        </Field>
        <div class="sk-form-pair">
          <Field label="Author" for="sk-set-author">
            <TextInput id="sk-set-author" {...field("authorName")} />
          </Field>
          <Field label="Homepage" for="sk-set-home">
            <TextInput id="sk-set-home" type="url" placeholder="https://" {...field("homepageUrl")} />
          </Field>
          <Field label="Icon" for="sk-set-icon" help="An image address.">
            <TextInput id="sk-set-icon" type="url" placeholder="https://" {...field("iconUrl")} />
          </Field>
          <Field label="Colour" for="sk-set-color" help="Any CSS colour, such as #6f5cf6.">
            <div class="org-row">
              <Show when={draft.color.trim()}>
                <span class="sk-swatch" style={{ background: draft.color.trim() }} aria-hidden="true" />
              </Show>
              <TextInput id="sk-set-color" class="mono" {...field("color")} />
            </div>
          </Field>
        </div>
        <Show when={!props.skill.accessSourceId} fallback={<p class="org-muted">It came with a project's repository, so only that project's agents see it.</p>}>
          <div class="field-stack">
            <span class="field-label">Who sees it</span>
            <Segmented label="Who sees it" options={SHARING_OPTIONS} value={draft.sharingScope} onChange={(value) => setDraft("sharingScope", value)} />
            <span class="fhelp">{SHARING_OPTIONS.find((option) => option.value === draft.sharingScope)?.help}</span>
          </div>
        </Show>
      </div>
    </Dialog>
  );
}

/**
 * The safety check (`POST …/audit`): what the scan finds in the installed files (scripts,
 * executables, links outside the skill), and whether they've changed since the origin. The last
 * verdict comes with the update check; Check now records a new one.
 */
export function AuditBlock(props: { skill: Pick<CompanySkillDetail, "id" | "name"> }) {
  const company = useCompany();
  const client = useQueryClient();
  const status = useSkillUpdateStatus(() => props.skill.id);
  const [result, setResult] = createSignal<CompanySkillAuditResult | null>(null);
  const [busy, setBusy] = createSignal(false);
  const [error, setError] = createSignal<string | null>(null);
  // The detail refetches after each change; only a different skill clears the result.
  const skillId = createMemo(() => props.skill.id);
  createEffect(on(skillId, () => (setResult(null), setError(null)), { defer: true }));
  const verdict = () => result()?.verdict ?? status.data?.auditVerdict ?? null;

  const run = async () => {
    setBusy(true);
    setError(null);
    try {
      setResult(await skillsApi.audit(company().id, props.skill.id));
      void client.invalidateQueries({ queryKey: queryKeys.skills.updateStatus(company().id, props.skill.id) });
    } catch (caught) {
      setError(failureText(caught, "Couldn't run the check."));
    } finally {
      setBusy(false);
    }
  };

  return (
    <section class="sk-block" aria-labelledby="sk-audit-h">
      <div class="sk-versions-head">
        <h3 class="sk-block-head" id="sk-audit-h">
          Safety check
        </h3>
        <button type="button" class="act-linkish" disabled={busy()} onClick={() => void run()}>
          {busy() ? "Checking…" : "Check now"}
        </button>
      </div>
      <Show
        when={verdict()}
        fallback={<p class="org-muted">{error() ?? (status.isPending ? "Loading…" : "Not checked yet. The check scans its files for scripts, executables and links outside the skill.")}</p>}
      >
        {(current) => (
          <>
            <p>
              <TonePill tone={auditVerdict(current()).tone} compact>
                {auditVerdict(current()).label}
              </TonePill>{" "}
              <Show when={result()} fallback={<span class="org-muted">{(status.data?.auditCodes ?? []).length ? (status.data?.auditCodes ?? []).join(", ") : "From the last check."}</span>}>
                {(fresh) => (
                  <span class="org-muted">
                    {auditLine(fresh())}
                    {auditDrift(fresh()) ? " Its files differ from the origin's." : ""}
                  </span>
                )}
              </Show>
            </p>
            <Show when={result()?.findings.length}>
              <ul class="sk-findings">
                <For each={result()!.findings}>
                  {(finding) => (
                    <li data-severity={finding.severity}>
                      <span>{finding.message}</span>
                      <Show when={finding.path}>
                        <span class="mono org-muted">{finding.path}</span>
                      </Show>
                    </li>
                  )}
                </For>
              </ul>
            </Show>
            <Show when={error()}>
              <p class="sk-error" role="alert">
                {error()}
              </p>
            </Show>
          </>
        )}
      </Show>
    </section>
  );
}

/** Reset a catalog skill to the catalog's files (`POST …/reset`); edits are discarded only when confirmed. */
export function ResetDialog(props: { open: boolean; onOpenChange: (open: boolean) => void; skill: Pick<CompanySkillDetail, "id" | "name" | "currentVersionId">; modified: boolean }) {
  const company = useCompany();
  const client = useQueryClient();
  const refresh = useRefreshSkills();
  const [busy, setBusy] = createSignal(false);
  const [error, setError] = createSignal<string | null>(null);
  createEffect(on(() => props.open, () => setError(null)));

  const reset = async () => {
    setBusy(true);
    setError(null);
    try {
      await skillsApi.reset(company().id, props.skill.id, { force: props.modified, expectedVersionId: props.skill.currentVersionId });
      refresh(props.skill.id);
      void client.invalidateQueries({ queryKey: queryKeys.skills.updateStatus(company().id, props.skill.id) });
      void client.invalidateQueries({ queryKey: queryKeys.skills.versions(company().id, props.skill.id) });
      pushToast({ tone: "success", title: `Reset ${props.skill.name}`, body: "It has the catalog's files again." });
      props.onOpenChange(false);
    } catch (caught) {
      setError(failureText(caught, "Couldn't reset the skill."));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Dialog
      open={props.open}
      onOpenChange={props.onOpenChange}
      width={460}
      title={`Reset ${props.skill.name}?`}
      description="It goes back to the files the catalog installed."
      hideClose
      footer={
        <div class="org-dialog-foot">
          <Button variant="quiet" onClick={() => props.onOpenChange(false)} disabled={busy()}>
            Cancel
          </Button>
          <Button variant={props.modified ? "danger" : "primary"} disabled={busy()} onClick={() => void reset()}>
            {busy() ? "Resetting…" : props.modified ? "Discard edits and reset" : "Reset"}
          </Button>
        </div>
      }
    >
      <div class="sk-form">
        <p class="org-muted">
          {props.modified ? "It was edited here since it was installed; those edits are lost. Saved versions stay in its history." : "Nothing here changed since it was installed, so nothing is lost."}
        </p>
        <Show when={error()}>
          <p class="field-error" role="alert">
            {error()}
          </p>
        </Show>
      </div>
    </Dialog>
  );
}
