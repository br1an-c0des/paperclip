import type { Project } from "@paperclipai/shared";
import { useQueryClient, type QueryClient } from "@tanstack/solid-query";
import { Check, LoaderCircle } from "lucide-solid";
import { createSignal, Match, onCleanup, Show, Switch, type JSX } from "solid-js";
import { projectsApi } from "@/api/projects";
import { queryKeys } from "@/api/queryKeys";
import { useCompany } from "@/lib/company";
import type { Patch } from "./settings-model";

/*
 * What the settings sections share: saving a project patch with its state, refreshing everything that
 * shows the project, and the small status line a card shows while it saves.
 */

export type SaveState = "idle" | "saving" | "saved" | "error";

export function failure(caught: unknown, fallback: string) {
  return caught instanceof Error && caught.message ? caught.message : fallback;
}

/** Refreshes the project list (nav, dashboard, this page) and any single-project query. */
export function refreshProject(client: QueryClient, companyId: string) {
  return Promise.all([
    client.invalidateQueries({ queryKey: queryKeys.projects.all(companyId) }),
    client.invalidateQueries({ queryKey: ["projects", "detail"] }),
  ]);
}

/**
 * Runs project changes and tracks the latest: Saving, then Saved for a moment, or the server's error,
 * which stays until the next change. Each change refreshes the project afterwards. Resolves true when
 * it worked.
 */
export function useSaveRunner() {
  const client = useQueryClient();
  const company = useCompany();
  const [state, setState] = createSignal<SaveState>("idle");
  const [error, setError] = createSignal<string | null>(null);
  let latest = 0;
  let timer: number | undefined;
  onCleanup(() => window.clearTimeout(timer));

  const run = async (work: () => Promise<unknown>, fallback = "Couldn't save the change."): Promise<boolean> => {
    const id = ++latest;
    window.clearTimeout(timer);
    setState("saving");
    setError(null);
    try {
      await work();
      await refreshProject(client, company().id);
      if (id === latest) {
        setState("saved");
        timer = window.setTimeout(() => setState("idle"), 1800);
      }
      return true;
    } catch (caught) {
      if (id === latest) {
        setState("error");
        setError(failure(caught, fallback));
      }
      return false;
    }
  };

  return { run, state, error };
}

/** A save runner for `PATCH /projects/:id`; a null patch is nothing to save. */
export function useProjectSaver(project: () => Project) {
  const runner = useSaveRunner();
  const save = (patch: Patch | null) => (patch ? runner.run(() => projectsApi.update(project().id, patch)) : Promise.resolve(true));
  return { ...runner, save };
}

/** "Saving…", "Saved", or the error, beside a card's description. */
export function SaveStatus(props: { state: SaveState; error: string | null }) {
  return (
    <Switch>
      <Match when={props.state === "saving"}>
        <span class="ps-save" role="status">
          <LoaderCircle size={13} class="ps-spin" aria-hidden="true" />
          Saving…
        </span>
      </Match>
      <Match when={props.state === "saved"}>
        <span class="ps-save ps-save--ok" role="status">
          <Check size={13} aria-hidden="true" />
          Saved
        </span>
      </Match>
      <Match when={props.state === "error" && props.error}>
        <span class="ps-save ps-save--error" role="alert">
          {props.error}
        </span>
      </Match>
    </Switch>
  );
}

/** A card description with the save status after it. */
export function CardNote(props: { children: JSX.Element; state?: SaveState; error?: string | null }) {
  return (
    <>
      {props.children}
      <Show when={props.state}>
        {(state) => <SaveStatus state={state()} error={props.error ?? null} />}
      </Show>
    </>
  );
}

/** A footer error from an explicit save, the way New task shows one. */
export function FootError(props: { message: string | null }) {
  return (
    <Show when={props.message}>
      <span class="nt-error ps-foot-error" role="alert">
        {props.message}
      </span>
    </Show>
  );
}
