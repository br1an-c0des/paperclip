import type { ChatExecutionDefaults } from "@paperclipai/shared";
import { createQuery } from "@tanstack/solid-query";
import { createEffect, createMemo, createSignal, createUniqueId, For, on, Show } from "solid-js";
import { chatEndpointsApi } from "@/api/chat-endpoints";
import { queryKeys } from "@/api/queryKeys";
import { useCompany } from "@/lib/company";
import { useProjectsQuery } from "@/lib/company-data";
import { Button } from "@/ui/Button";
import { failureText } from "../shared";
import { defaultsPayload, projectKey, withProject, withWorkspace, workspaceChoices, workspaceKey } from "./task-defaults-model";
import "./ChatExtras.css";

/*
 * Task defaults (the old UI's ChatExecutionDefaults): the project and workspace a new conversation's
 * task gets. On the endpoint they apply to every channel; on one channel or repository (`resource`)
 * they override the endpoint's. Existing tasks keep theirs.
 */

export function TaskDefaults(props: {
  value: ChatExecutionDefaults | null | undefined;
  resource?: boolean;
  onSave: (defaults: ChatExecutionDefaults | null) => Promise<unknown>;
}) {
  const company = useCompany();
  const id = createUniqueId();
  const projects = useProjectsQuery();
  const workspaces = createQuery(() => ({
    queryKey: [...queryKeys.chatEndpoints.all(company().id), "task-workspaces"],
    queryFn: ({ signal }) => chatEndpointsApi.taskWorkspaces(company().id, signal),
    staleTime: 30_000,
  }));
  const [draft, setDraft] = createSignal<ChatExecutionDefaults>(props.value ?? {});
  const [pending, setPending] = createSignal(false);
  const [error, setError] = createSignal<string | null>(null);
  const [saved, setSaved] = createSignal(false);
  createEffect(on(() => JSON.stringify(props.value ?? {}), () => setDraft(props.value ?? {}), { defer: true }));
  const choices = createMemo(() => workspaceChoices(projects.data ?? [], workspaces.data ?? []));
  const dirty = () => JSON.stringify(draft()) !== JSON.stringify(props.value ?? {});
  const change = (next: ChatExecutionDefaults) => {
    setDraft(next);
    setSaved(false);
    setError(null);
  };
  const save = async () => {
    setPending(true);
    setError(null);
    try {
      await props.onSave(defaultsPayload(draft()));
      setSaved(true);
    } catch (cause) {
      setError(failureText(cause, "Couldn't save the task defaults."));
    } finally {
      setPending(false);
    }
  };
  const missingProject = () => {
    const current = draft().projectId;
    return current && !(projects.data ?? []).some((project) => project.id === current) ? current : null;
  };

  return (
    <form
      class="ch-defaults"
      onSubmit={(event) => {
        event.preventDefault();
        if (dirty() && !pending()) void save();
      }}
    >
      <Show when={projects.isError || workspaces.isError}>
        <p class="cx-note cx-note--error" role="alert">
          Couldn't load the projects or workspaces.
        </p>
      </Show>
      <div class="ch-grid">
        <label class="field-stack" for={`${id}-project`}>
          <span class="field-label">Project</span>
          <select
            id={`${id}-project`}
            class="input"
            value={projectKey(draft())}
            disabled={pending() || projects.isPending}
            onChange={(event) => change(withProject(draft(), event.currentTarget.value))}
          >
            <option value="inherit">{props.resource ? "Use the connection's default" : "Use the task's default"}</option>
            <option value="none">No project</option>
            <Show when={missingProject()}>{(projectId) => <option value={projectId()}>Saved project (unavailable)</option>}</Show>
            <For each={projects.data ?? []}>{(project) => <option value={project.id}>{project.name}</option>}</For>
          </select>
        </label>
        <label class="field-stack" for={`${id}-workspace`}>
          <span class="field-label">Workspace</span>
          <select
            id={`${id}-workspace`}
            class="input"
            value={workspaceKey(draft().workspace)}
            disabled={pending() || projects.isPending || workspaces.isPending}
            onChange={(event) => change(withWorkspace(draft(), event.currentTarget.value, choices()))}
          >
            <option value="inherit">{props.resource ? "Use the connection's default" : "Use the project's or task's default"}</option>
            <Show when={props.resource || workspaceKey(draft().workspace) === "clear"}>
              <option value="clear">Use the project's or task's default</option>
            </Show>
            <option value="task">Task files, in a separate folder</option>
            <Show when={draft().workspace && !choices().has(workspaceKey(draft().workspace))}>
              <option value={workspaceKey(draft().workspace)}>Saved workspace (unavailable)</option>
            </Show>
            <For each={(projects.data ?? []).filter((project) => project.workspaces?.length)}>
              {(project) => (
                <optgroup label={project.name}>
                  <For each={project.workspaces}>
                    {(source) => (
                      <>
                        <option value={`source:${source.id}:managed_isolated`}>{source.name}, isolated checkout</option>
                        <option value={`source:${source.id}:shared`}>{source.name}, shared folder</option>
                      </>
                    )}
                  </For>
                </optgroup>
              )}
            </For>
            <Show when={(workspaces.data?.length ?? 0) > 0}>
              <optgroup label="Existing workspaces">
                <For each={workspaces.data}>{(workspace) => <option value={`existing:${workspace.id}`}>{workspace.name}</option>}</For>
              </optgroup>
            </Show>
          </select>
        </label>
      </div>
      <p class="cx-static">Access to the project and workspace is checked for each task. A shared folder must also be allowed by the agent's settings.</p>
      <Show when={error()}>
        <p class="cx-note cx-note--error" role="alert">
          {error()}
        </p>
      </Show>
      <div class="cx-actions">
        <Show when={dirty()} fallback={<span class="cx-static" role="status">{saved() ? "Saved for new tasks." : ""}</span>}>
          <Button variant="quiet" disabled={pending()} onClick={() => change(props.value ?? {})}>
            Cancel
          </Button>
        </Show>
        <Button type="submit" size="compact" variant="primary" disabled={!dirty() || pending()}>
          {pending() ? "Saving…" : "Save defaults"}
        </Button>
      </div>
    </form>
  );
}
