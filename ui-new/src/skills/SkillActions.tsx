import type { CompanySkillDetail, CompanySkillVersion } from "@paperclipai/shared";
import { useNavigate } from "@solidjs/router";
import { createQuery, useQueryClient } from "@tanstack/solid-query";
import { Check, Download, FileText, GitFork, Star } from "lucide-solid";
import { createEffect, createMemo, createSignal, For, Match, on, Show, Switch } from "solid-js";
import { queryKeys } from "@/api/queryKeys";
import { skillsApi } from "@/api/skills";
import { diffCounts, lineDiff } from "@/documents/document-model";
import { useCompany } from "@/lib/company";
import { Button } from "@/ui/Button";
import { Dialog } from "@/ui/Dialog";
import { Field, TextInput } from "@/ui/Field";
import { TonePill } from "@/ui/Status";
import { pushToast } from "@/ui/Toast";
import { failureText, useRefreshSkills, useSkillUpdateStatus } from "./queries";
import { comparedPaths, compareSelection, fileChange, slugFor, updateLine, versionName } from "./skills-model";
import "@/documents/DocumentView.css";

/*
 * What a skill's detail can do beyond showing it (the old library's skill page):
 *
 * - Star it (`POST|DELETE …/star`); the count is the company's.
 * - Fork it (`GET …/fork-precheck`, `POST …/fork`): an editable copy authored here, optionally moving
 *   the agents that use the original onto the copy. The copy opens in the Studio.
 * - Updates (`GET …/update-status`, `POST …/install-update`) for skills from a source, the catalog or
 *   a URL: whether a newer version is out, why it's held, and installing it.
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

/** Update status for skills that come from somewhere; nothing for authored ones. */
export function UpdateBlock(props: { skill: Pick<CompanySkillDetail, "id" | "name"> }) {
  const company = useCompany();
  const client = useQueryClient();
  const refresh = useRefreshSkills();
  const status = useSkillUpdateStatus(() => props.skill.id);
  const line = createMemo(() => updateLine(status.data));
  const [installing, setInstalling] = createSignal(false);

  const install = async () => {
    setInstalling(true);
    try {
      await skillsApi.installUpdate(company().id, props.skill.id);
      refresh(props.skill.id);
      void client.invalidateQueries({ queryKey: queryKeys.skills.updateStatus(company().id, props.skill.id) });
      pushToast({ tone: "success", title: `Updated ${props.skill.name}`, body: "Agents using it get the new version on their next run." });
    } catch (error) {
      pushToast({ tone: "error", title: "Couldn't install the update", body: failureText(error, "") });
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
              <Show when={current().canInstall}>
                <Button size="compact" variant="primary" icon={<Download size={14} aria-hidden="true" />} disabled={installing()} onClick={() => void install()}>
                  {installing() ? "Installing…" : "Install update"}
                </Button>
              </Show>
            </div>
          )}
        </Match>
      </Switch>
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
  versions: readonly CompanySkillVersion[];
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

  const before = () => sorted().find((version) => version.id === beforeId()) ?? null;
  const after = () => sorted().find((version) => version.id === afterId()) ?? null;
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
        <Show when={after()} fallback={<p class="org-muted">This skill has no saved versions to compare.</p>}>
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
            <Show when={before()?.id !== after()?.id} fallback={<p class="org-muted">Both sides are the same version.</p>}>
              <VersionDiff before={content(before())} after={content(after())} beforeLabel={before() ? versionName(before()!) : "Nothing"} afterLabel={versionName(after()!)} />
            </Show>
          </div>
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
