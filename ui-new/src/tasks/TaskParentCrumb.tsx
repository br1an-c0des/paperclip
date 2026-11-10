import { createQuery } from "@tanstack/solid-query";
import { Lock } from "lucide-solid";
import { Show } from "solid-js";
import { issuePath, issuesApi } from "@/api/issues";
import { queryKeys } from "@/api/queryKeys";
import { useCompany } from "@/lib/company";
import { parentCrumb, parentLabel } from "./parent-crumb";
import "./TaskParentCrumb.css";

/*
 * The parent task before the identifier in the task panel's and modal's header (U104,
 * parent-crumb.ts). It reads the open task's detail, the query its sections share. Following it
 * opens the parent as the header's own task opens (`onOpenTask`: in the panel or modal, in place),
 * and a modifier click still opens the address in a new tab. A private parent is a lock with its
 * number, and no link. On a phone the number is left out to give the title room.
 */

export function TaskParentCrumb(props: { taskId: string; onOpenTask: (task: { id: string; identifier: string | null }) => void }) {
  const company = useCompany();
  const task = createQuery(() => ({
    queryKey: queryKeys.issues.detail(props.taskId),
    queryFn: ({ signal }) => issuesApi.get(props.taskId, signal),
  }));
  const crumb = () => parentCrumb(task.data?.id === props.taskId ? task.data : undefined);
  const link = () => {
    const found = crumb();
    return found?.kind === "link" ? found : null;
  };
  const locked = () => {
    const found = crumb();
    return found?.kind === "locked" ? found : null;
  };

  return (
    <Show when={crumb()}>
      <Show when={link()}>
        {(parent) => (
          <a
            class="tparent"
            href={issuePath(company().issuePrefix, parent())}
            title={parent().title}
            aria-label={parentLabel(parent())}
            onClick={(event) => {
              if (event.metaKey || event.ctrlKey || event.shiftKey || event.altKey || event.button !== 0) return;
              event.preventDefault();
              props.onOpenTask({ id: parent().id, identifier: parent().identifier });
            }}
          >
            <Show when={parent().identifier}>
              <span class="mono tparent-id">{parent().identifier}</span>
            </Show>
            <span class="tparent-title">{parent().label}</span>
          </a>
        )}
      </Show>
      <Show when={locked()}>
        {(parent) => (
          <span class="tparent-locked mono" data-testid="locked-relation" role="img" title="Private: you don't have access" aria-label={parentLabel(parent())}>
            <Lock size={12} aria-hidden="true" />
            <span class="tparent-locked-id" aria-hidden="true">
              {parent().identifier ?? "Private"}
            </span>
            <span class="tparent-locked-phone" aria-hidden="true">
              Private
            </span>
          </span>
        )}
      </Show>
      <span class="tparent-sep" aria-hidden="true">
        /
      </span>
    </Show>
  );
}
