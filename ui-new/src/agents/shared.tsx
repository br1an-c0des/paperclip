import type { AgentDetail } from "@paperclipai/shared";
import { createQuery, useQueryClient, type QueryClient } from "@tanstack/solid-query";
import { createSignal, onCleanup, Show, type JSX } from "solid-js";
import { agentsApi } from "@/api/agents";
import { queryKeys } from "@/api/queryKeys";
import { useCompany } from "@/lib/company";
import { failure, type SaveState } from "@/projects/settings/shared";
import { Switch } from "@/ui/Switch";
import { harnessType } from "./agent-model";

/*
 * What the agent settings sections share: saving an agent patch with its state and refreshing
 * everything that shows the agent, and the section title block (board 26's `.sec-title`). The save
 * status line and errors are the project settings' (projects/settings/shared.tsx).
 */

export { CardNote, FootError, failure, SaveStatus } from "@/projects/settings/shared";

/** A settings row whose control is one switch, at the row's end like the other rows' controls. */
export function SwitchRow(props: {
  label: string;
  help: JSX.Element;
  checked: boolean;
  disabled?: boolean;
  onChange: (value: boolean) => void;
  children?: JSX.Element;
}) {
  return (
    <div class="frow ag-frow-switch">
      <div class="flabel">
        {props.label}
        <span class="fhelp">{props.help}</span>
        <Show when={props.children}>
          <div class="ag-frow-extra">{props.children}</div>
        </Show>
      </div>
      <div class="ag-switch-cell">
        <Switch checked={props.checked} disabled={props.disabled} onChange={props.onChange} label={props.label} labelHidden />
      </div>
    </div>
  );
}

/** Refreshes the agent (its page and every part of it) and the company's agent list (nav, menus). */
export function refreshAgent(client: QueryClient, companyId: string, agentId: string) {
  return Promise.all([
    client.invalidateQueries({ queryKey: queryKeys.agents.detail(agentId) }),
    client.invalidateQueries({ queryKey: queryKeys.agents.list(companyId) }),
  ]);
}

/**
 * Runs agent changes and tracks the latest: Saving, then Saved for a moment, or the server's error,
 * which stays until the next change. Each change refreshes the agent afterwards. Resolves true when
 * it worked.
 */
export function useAgentSaver(agent: () => AgentDetail) {
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
      await refreshAgent(client, company().id, agent().id);
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
  /** `PATCH /agents/:id`; a null patch is nothing to save. */
  const save = (patch: Record<string, unknown> | null) =>
    patch ? run(() => agentsApi.update(agent().id, patch, company().id)) : Promise.resolve(true);
  return { run, save, state, error };
}

/**
 * The registered harnesses with the runners each supports where the agent runs (`GET /adapters`
 * for its environment), and the agent's own harness among them.
 */
export function useAdapters(agent: () => AgentDetail) {
  const company = useCompany();
  const query = createQuery(() => ({
    queryKey: queryKeys.agents.adapters(company().id, agent().defaultEnvironmentId ?? null),
    queryFn: ({ signal }) => agentsApi.adapters(company().id, agent().defaultEnvironmentId ?? null, signal),
    staleTime: 60_000,
  }));
  const harness = () => {
    const type = harnessType(agent().adapterType, agent().adapterConfig as Record<string, unknown>);
    return query.data?.find((adapter) => adapter.type === type);
  };
  return { query, harness };
}

/** A section's title and purpose, above its cards (board 26). */
export function SectionTitle(props: { title: JSX.Element; children?: JSX.Element; aside?: JSX.Element }) {
  return (
    <div class="ag-sec-title">
      <div>
        <h2 class="disp">{props.title}</h2>
        <Show when={props.children}>
          <p>{props.children}</p>
        </Show>
      </div>
      <Show when={props.aside}>
        <div class="ag-sec-aside">{props.aside}</div>
      </Show>
    </div>
  );
}

/** A dashed card listing what a section will hold, for sections the API or this slice doesn't cover yet (board 26's outline). */
export function OutlineCard(props: { rows: { name: string; text: string }[]; was: string; note?: JSX.Element }) {
  return (
    <section class="ag-outline" aria-label="Planned contents">
      <div class="ag-outline-head">
        <span class="ag-outline-tag">Coming next</span>
        {props.note ?? "Not built yet. This section will hold:"}
      </div>
      <ul>
        {props.rows.map((row) => (
          <li>
            <span>{row.name}</span>
            <span>{row.text}</span>
          </li>
        ))}
      </ul>
      <div class="ag-outline-was">In the classic UI: {props.was}</div>
    </section>
  );
}

/** "Oct 18", or "Oct 18, 2025" in another year. */
export function shortDate(value: string | Date | null | undefined) {
  if (!value) return "";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "";
  return date.toLocaleDateString(undefined, { month: "short", day: "numeric", year: date.getFullYear() === new Date().getFullYear() ? undefined : "numeric" });
}

/** "Oct 18, 4:12 pm". */
export function dateTime(value: string | Date | null | undefined) {
  if (!value) return "";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "";
  return `${shortDate(date)}, ${date.toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" })}`;
}
