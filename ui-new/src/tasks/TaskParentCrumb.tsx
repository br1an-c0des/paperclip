import { createQuery } from "@tanstack/solid-query";
import { Lock } from "lucide-solid";
import { Show } from "solid-js";
import { issuePath, issuesApi } from "@/api/issues";
import { queryKeys } from "@/api/queryKeys";
import { useCompany } from "@/lib/company";
import { crumbLabel, parentCrumb } from "./parent-crumb";
import "./TaskParentCrumb.css";

/*
 * The parent task before the identifier in the task panel's and modal's header (U104,
 * parent-crumb.ts). It reads the open task's detail, the query its sections share. Following it
 * opens the parent as the header's own task opens (`onOpenTask`: in the panel or modal, in place),
 * and a modifier click still opens the address in a new tab. It shows the parent's title alone, with
 * no task number, at every width (U128, #20804); a private parent is a lock reading "Private", with
 * no link.
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
            aria-label={crumbLabel(parent())}
            onClick={(event) => {
              if (event.metaKey || event.ctrlKey || event.shiftKey || event.altKey || event.button !== 0) return;
              event.preventDefault();
              props.onOpenTask({ id: parent().id, identifier: parent().identifier });
            }}
          >
            <span class="tparent-title">{parent().label}</span>
          </a>
        )}
      </Show>
      <Show when={locked()}>
        {(parent) => (
          <span class="tparent-locked" data-testid="locked-relation" role="img" title="Private: you don't have access" aria-label={crumbLabel(parent())}>
            <Lock size={12} aria-hidden="true" />
            <span aria-hidden="true">Private</span>
          </span>
        )}
      </Show>
      <span class="tparent-sep" aria-hidden="true">
        /
      </span>
    </Show>
  );
}
