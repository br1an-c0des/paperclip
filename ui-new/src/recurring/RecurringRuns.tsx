import type { RoutineDetail, RoutineVariable } from "@paperclipai/shared";
import { createQuery, useQueryClient } from "@tanstack/solid-query";
import { Braces, CalendarClock, Check, ChevronDown, Play, Webhook } from "lucide-solid";
import { createMemo, createSignal, For, Show, type JSX } from "solid-js";
import { activeAgents } from "@/api/agents";
import { issuePath } from "@/api/issues";
import { queryKeys } from "@/api/queryKeys";
import { routinesApi } from "@/api/routines";
import { useCompany } from "@/lib/company";
import { useAgentsQuery } from "@/lib/company-data";
import { AgentAvatar } from "@/ui/Avatar";
import { Button } from "@/ui/Button";
import { TextArea, TextInput } from "@/ui/Field";
import { Menu } from "@/ui/Menu";
import { Segmented } from "@/ui/Segmented";
import { Capsule } from "@/ui/Status";
import { pushToast } from "@/ui/Toast";
import { refreshRecurring } from "./queries";
import { filterRuns, RUN_SOURCE_LABEL, runOutcome, type RunFilter, type RunSource } from "./recurring-model";
import { formatFire } from "./schedule";

/*
 * The recurring task's runs (board R3): each run's time, what started it (schedule, webhook, API,
 * Run now) and how it turned out: the task it made and that task's status, or skipped, added to the
 * open one, or failed with the reason. A filter for all runs, the ones that made a task, and the
 * ones that didn't. Run now takes the inputs and who to assign (`POST /routines/:id/run`).
 */

const SOURCE_ICON: Record<RunSource, () => JSX.Element> = {
  schedule: () => <CalendarClock size={14} aria-hidden="true" />,
  webhook: () => <Webhook size={14} aria-hidden="true" />,
  api: () => <Braces size={14} aria-hidden="true" />,
  manual: () => <Play size={14} aria-hidden="true" />,
};

const PAGE = 50;

export function RecurringRuns(props: { routine: RoutineDetail; onOpenTask: (task: { id: string; identifier: string | null }) => void }) {
  const company = useCompany();
  const [limit, setLimit] = createSignal(PAGE);
  const [filter, setFilter] = createSignal<RunFilter>("all");
  const runs = createQuery(() => ({
    queryKey: [...queryKeys.routines.runs(props.routine.id), limit()],
    queryFn: ({ signal }) => routinesApi.runs(props.routine.id, limit(), signal),
    placeholderData: (previous) => previous,
  }));
  const all = () => runs.data ?? [];
  const shown = createMemo(() => filterRuns(all(), filter()));
  const made = () => filterRuns(all(), "task").length;

  return (
    <>
      <div class="tsec-head">
        <h2 class="disp">Runs</h2>
        <span class="rpn-head-title">{props.routine.title}</span>
      </div>
      <div class="tsec-scroll">
        <Segmented
          label="Show runs"
          options={[
            { value: "all", label: `All ${all().length}` },
            { value: "task", label: `Created a task ${made()}` },
            { value: "none", label: `No task ${all().length - made()}` },
          ]}
          value={filter()}
          onChange={setFilter}
        />
        <Show when={runs.data} fallback={<p class="tsec-muted">{runs.isError ? `The runs couldn't be loaded: ${(runs.error as Error).message}` : "Loading runs…"}</p>}>
          <Show when={shown().length > 0} fallback={<p class="tsec-muted">{all().length === 0 ? "No runs yet. Run now starts one." : "No runs match."}</p>}>
            <ol class="rpn-runs" aria-label="Runs">
              <For each={shown()}>
                {(run) => {
                  const outcome = () => runOutcome(run);
                  const source = () => (run.source in RUN_SOURCE_LABEL ? (run.source as RunSource) : "api");
                  return (
                    <li class="rpn-run-row">
                      <span class="rpn-run-when">{formatFire(run.triggeredAt)}</span>
                      <span class="rpn-run-source">
                        {SOURCE_ICON[source()]()}
                        {RUN_SOURCE_LABEL[source()]}
                      </span>
                      <span class="rpn-run-out" data-tone={outcome().tone}>
                        <Capsule gradient={outcome().gradient} size="row" live={outcome().live} />
                        <Show when={outcome().task?.identifier && run.status !== "coalesced"}>
                          <a
                            class="mono rv-id"
                            href={issuePath(company().issuePrefix, outcome().task!)}
                            onClick={(event) => {
                              if (event.metaKey || event.ctrlKey || event.shiftKey || event.button !== 0) return;
                              event.preventDefault();
                              props.onOpenTask(outcome().task!);
                            }}
                          >
                            {outcome().task!.identifier}
                          </a>
                        </Show>
                        <span>{outcome().label}</span>
                      </span>
                    </li>
                  );
                }}
              </For>
            </ol>
          </Show>
          <Show when={all().length >= limit()}>
            <Button ghost size="compact" class="rpn-older" disabled={runs.isFetching} onClick={() => setLimit(limit() + PAGE)}>
              Show older runs
            </Button>
          </Show>
        </Show>
      </div>
    </>
  );
}

/** A value for one input, in the type the API takes. */
function parseValue(variable: RoutineVariable, raw: string): string | number | boolean | undefined {
  if (raw === "") return undefined;
  if (variable.type === "number") {
    const value = Number(raw);
    return Number.isFinite(value) ? value : undefined;
  }
  if (variable.type === "boolean") return raw === "true";
  return raw;
}

/** Run now (board R3): the inputs, prefilled with their defaults, and who to assign. */
export function RunNowForm(props: { routine: RoutineDetail; onDone: () => void; onCancel: () => void }) {
  const company = useCompany();
  const client = useQueryClient();
  const agents = useAgentsQuery();
  const [values, setValues] = createSignal<Record<string, string>>(
    Object.fromEntries(props.routine.variables.map((variable) => [variable.name, variable.defaultValue == null ? "" : String(variable.defaultValue)])),
  );
  const [agentId, setAgentId] = createSignal<string | null>(props.routine.assigneeAgentId);
  const [busy, setBusy] = createSignal(false);
  const [error, setError] = createSignal<string | null>(null);
  const agentList = createMemo(() => activeAgents(agents.data));
  const agent = () => agentList().find((candidate) => candidate.id === agentId());
  const missing = () => props.routine.variables.filter((variable) => variable.required && !values()[variable.name]?.trim()).map((variable) => variable.label || variable.name);

  const run = async () => {
    if (missing().length > 0) return setError(`Fill in ${missing().join(", ")}.`);
    if (!agentId()) return setError("Pick an agent to run it.");
    setError(null);
    setBusy(true);
    try {
      const variables: Record<string, string | number | boolean> = {};
      for (const variable of props.routine.variables) {
        const value = parseValue(variable, values()[variable.name] ?? "");
        if (value !== undefined) variables[variable.name] = value;
      }
      const result = await routinesApi.run(props.routine.id, {
        source: "manual",
        ...(Object.keys(variables).length > 0 ? { variables } : {}),
        ...(agentId() !== props.routine.assigneeAgentId ? { assigneeAgentId: agentId() } : {}),
      });
      refreshRecurring(client, company().id, true);
      pushToast({
        tone: result.status === "failed" ? "warn" : "success",
        title: result.status === "failed" ? "The run didn't start" : result.status === "skipped" ? "The run was skipped" : "Started a run",
        body: result.failureReason ?? props.routine.title,
      });
      props.onDone();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Couldn't start the run.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <div class="rpn-runnow">
      <For each={props.routine.variables}>
        {(variable) => {
          const id = `rn-${variable.name}`;
          const value = () => values()[variable.name] ?? "";
          const set = (next: string) => setValues({ ...values(), [variable.name]: next });
          return (
            <div class="rpn-runnow-row">
              <label class="mono" for={id}>
                {variable.label || variable.name}
                <Show when={variable.required}>
                  <span class="rpn-required" aria-label="required">
                    *
                  </span>
                </Show>
              </label>
              <Show
                when={variable.type === "select" || variable.type === "boolean"}
                fallback={
                  <Show
                    when={variable.type === "textarea"}
                    fallback={
                      <TextInput
                        id={id}
                        type={variable.type === "number" ? "number" : variable.type === "date" ? "date" : "text"}
                        value={value()}
                        onInput={(event) => set(event.currentTarget.value)}
                      />
                    }
                  >
                    <TextArea id={id} rows={3} value={value()} onInput={(event) => set(event.currentTarget.value)} />
                  </Show>
                }
              >
                <select id={id} class="input" value={value()} onChange={(event) => set(event.currentTarget.value)}>
                  <option value="">—</option>
                  <For each={variable.type === "boolean" ? ["true", "false"] : variable.options}>
                    {(option) => <option value={option}>{variable.type === "boolean" ? (option === "true" ? "Yes" : "No") : option}</option>}
                  </For>
                </select>
              </Show>
            </div>
          );
        }}
      </For>
      <div class="rpn-runnow-row">
        <span>Assign to</span>
        <Menu>
          <Menu.Trigger class="field rpn-assign" aria-label={`Assign to: ${agent()?.name ?? "no one"}`}>
            <Show when={agent()}>{(found) => <AgentAvatar agent={found()} size={20} ring={false} />}</Show>
            <span class="field-value">{agent()?.name ?? "Pick an agent"}</span>
            <ChevronDown size={14} aria-hidden="true" class="field-caret" />
          </Menu.Trigger>
          <Menu.Content label="Assign to" width={260}>
            <For each={agentList()}>
              {(candidate) => (
                <Menu.Item
                  icon={<AgentAvatar agent={candidate} size={20} ring={false} />}
                  hint={candidate.id === agentId() ? <Check size={14} /> : undefined}
                  onSelect={() => setAgentId(candidate.id)}
                >
                  {candidate.name}
                </Menu.Item>
              )}
            </For>
          </Menu.Content>
        </Menu>
      </div>
      <Show when={error()}>
        <p class="rpn-error" role="alert">
          {error()}
        </p>
      </Show>
      <div class="rpn-runnow-foot">
        <Button variant="quiet" size="compact" onClick={() => props.onCancel()}>
          Cancel
        </Button>
        <Button variant="primary" size="compact" disabled={busy()} onClick={() => void run()}>
          <Play size={14} aria-hidden="true" />
          {busy() ? "Starting…" : "Run"}
        </Button>
      </div>
    </div>
  );
}
