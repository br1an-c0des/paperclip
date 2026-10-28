import { useQueryClient } from "@tanstack/solid-query";
import { createSignal, onCleanup, Show, type JSX } from "solid-js";
import { companiesApi, type CompanyPatch } from "@/api/companies";
import { queryKeys } from "@/api/queryKeys";
import { useCompany } from "@/lib/company";
import { failure, type SaveState } from "@/projects/settings/shared";

/*
 * What company settings' sections share. The save status line, footer errors and `failure` are the
 * project settings' (projects/settings/shared.tsx); the section title, switch rows and outline
 * cards are the agent settings' (agents/shared.tsx), so the three settings pages read alike.
 */

export { CardNote, FootError, failure, SaveStatus } from "@/projects/settings/shared";
export { OutlineCard, SectionTitle, SwitchRow, shortDate, dateTime } from "@/agents/shared";

/**
 * Runs changes and tracks the latest: Saving, then Saved for a moment, or the server's error, which
 * stays until the next change. `refresh` runs after each change that worked. Resolves true when it
 * worked.
 */
export function useRunner(refresh: () => Promise<unknown>) {
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
      await refresh();
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

/** Saves `PATCH /companies/:id` and refreshes everything company-shaped (nav, header, this page). */
export function useCompanySaver() {
  const client = useQueryClient();
  const company = useCompany();
  const runner = useRunner(() => client.invalidateQueries({ queryKey: queryKeys.companies.all }));
  const save = (patch: CompanyPatch | null, fallback?: string) =>
    patch ? runner.run(() => companiesApi.update(company().id, patch), fallback) : Promise.resolve(true);
  return { ...runner, save };
}

/** A card whose header has a title, a note and actions at its end (board 22's People and Invites). */
export function CardHead(props: { id?: string; title: JSX.Element; note?: JSX.Element; actions?: JSX.Element }) {
  return (
    <header class="chead cs-chead">
      <div class="cs-chead-text">
        <h3 class="disp" id={props.id}>
          {props.title}
        </h3>
        <Show when={props.note}>
          <p>{props.note}</p>
        </Show>
      </div>
      <Show when={props.actions}>
        <div class="cs-chead-actions">{props.actions}</div>
      </Show>
    </header>
  );
}

/** A list or loading note inside a card. */
export function CardNoteLine(props: { children: JSX.Element; alert?: boolean }) {
  return (
    <p class="cs-note" role={props.alert ? "alert" : undefined}>
      {props.children}
    </p>
  );
}

/** Copies text, reporting whether the browser let it. */
export async function copyText(text: string) {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    return false;
  }
}
