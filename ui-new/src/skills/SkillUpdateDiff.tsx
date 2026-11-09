import type { SkillSourceUpdateDiffFile } from "@paperclipai/shared";
import { createQuery } from "@tanstack/solid-query";
import { createMemo, For, Match, Show, Switch } from "solid-js";
import { queryKeys } from "@/api/queryKeys";
import { skillsApi } from "@/api/skills";
import { useCompany } from "@/lib/company";
import { Button } from "@/ui/Button";
import { Dialog } from "@/ui/Dialog";
import { failureText } from "./queries";
import { CHANGE_LABEL, diffView, fileNote, parsePatch, revisionRange } from "./skill-update-diff";

/*
 * "What changed" beside Install update (U88): the pending update file by file, from
 * `GET …/skills/:id/update-diff`, asked for only while the dialog is open. Lines added and removed
 * take the patch colours the task thread uses for diff blocks (--green-*, --red-*, --run-* for hunk
 * headers); each file's lines scroll sideways inside their own box, so long lines never widen the
 * page. On a phone the dialog is a full-screen sheet.
 */

export function UpdateDiffDialog(props: { open: boolean; onOpenChange: (open: boolean) => void; skill: { id: string; name: string } }) {
  const company = useCompany();
  const diff = createQuery(() => ({
    queryKey: queryKeys.skills.updateDiff(company().id, props.skill.id),
    queryFn: ({ signal }) => skillsApi.updateDiff(company().id, props.skill.id, signal),
    enabled: props.open,
    staleTime: 60_000,
    retry: false,
  }));
  const view = createMemo(() => (diff.data ? diffView(diff.data) : null));
  const files = () => {
    const current = view();
    return current?.kind === "files" ? current : null;
  };
  const message = () => {
    const current = view();
    return current && current.kind !== "files" ? current.text : null;
  };

  return (
    <Dialog
      open={props.open}
      onOpenChange={props.onOpenChange}
      width={1000}
      title="What changed"
      description={[props.skill.name, revisionRange(diff.data)].filter(Boolean).join(" · ")}
    >
      <div class="sk-whatchanged">
        <Switch>
          <Match when={diff.isPending}>
            <p class="org-muted">Comparing the installed revision with the latest one on GitHub…</p>
          </Match>
          <Match when={diff.isError}>
            <div class="sk-whatchanged-error" role="alert">
              <p class="org-muted">Couldn't compare the revisions. {failureText(diff.error, "")}</p>
              <Button size="compact" disabled={diff.isFetching} onClick={() => void diff.refetch()}>
                {diff.isFetching ? "Trying…" : "Try again"}
              </Button>
            </div>
          </Match>
          <Match when={files()}>
            {(current) => (
              <>
                <p class="sk-whatchanged-sum">
                  {current().summary}: <span class="sk-patch-add">+{current().added}</span> <span class="sk-patch-del">−{current().removed}</span>
                </p>
                <Show when={current().truncated}>
                  <p class="sk-warning">{current().truncated}</p>
                </Show>
                <For each={diff.data?.files ?? []}>{(file) => <FilePatch file={file} open={(diff.data?.files.length ?? 0) <= 8} />}</For>
              </>
            )}
          </Match>
          <Match when={message()}>{(text) => <p class="org-muted">{text()}</p>}</Match>
        </Switch>
      </div>
    </Dialog>
  );
}

/** One file: its path, what happened to it, and its lines. Opens collapsed when the update is long. */
function FilePatch(props: { file: SkillSourceUpdateDiffFile; open: boolean }) {
  const patch = createMemo(() => parsePatch(props.file.diff));
  const note = () => fileNote(props.file);
  return (
    <details class="sk-patch-file" open={props.open}>
      <summary class="sk-patch-head">
        <span class="mono sk-patch-path">{props.file.path}</span>
        <span class="sk-change" data-change={props.file.change}>
          {CHANGE_LABEL[props.file.change]}
        </span>
        <Show when={patch().added + patch().removed > 0}>
          <span class="sk-patch-counts">
            <span class="sk-patch-add">+{patch().added}</span> <span class="sk-patch-del">−{patch().removed}</span>
          </span>
        </Show>
      </summary>
      <Show when={note()}>
        <p class="org-muted sk-patch-note">{note()}</p>
      </Show>
      <Show when={patch().rows.length}>
        <div class="sk-patch mono" tabindex="0" role="region" aria-label={`Lines changed in ${props.file.path}`}>
          {/* As wide as the longest line, so every row's colour reaches the scrolled-to edge. */}
          <div class="sk-patch-rows" role="table" aria-label={`Changes to ${props.file.path}`}>
            <For each={patch().rows}>
              {(row) => (
                <div class="sk-patch-row" data-kind={row.kind} role="row">
                  <span class="sk-patch-num" role="cell">
                    {row.oldLine ?? ""}
                  </span>
                  <span class="sk-patch-num" role="cell">
                    {row.newLine ?? ""}
                  </span>
                  <span class="sk-patch-sign" role="cell" aria-label={row.kind === "add" ? "added" : row.kind === "remove" ? "removed" : undefined}>
                    {row.kind === "add" ? "+" : row.kind === "remove" ? "−" : ""}
                  </span>
                  <span class="sk-patch-text" role="cell">
                    {row.text || " "}
                  </span>
                </div>
              )}
            </For>
          </div>
        </div>
      </Show>
    </details>
  );
}
