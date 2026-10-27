import type { Project } from "@paperclipai/shared";
import { useQueryClient } from "@tanstack/solid-query";
import { Check, ChevronDown, Link2, Plus } from "lucide-solid";
import { createMemo, createSignal, For, Show } from "solid-js";
import { createStore } from "solid-js/store";
import { activeAgents } from "@/api/agents";
import { goalsApi } from "@/api/goals";
import { projectsApi } from "@/api/projects";
import { queryKeys } from "@/api/queryKeys";
import { useCompany } from "@/lib/company";
import { useAgentsQuery, useGoalsQuery } from "@/lib/company-data";
import { AgentAvatar } from "@/ui/Avatar";
import { Button } from "@/ui/Button";
import { FieldButton, SettingsCard, TextArea, TextInput } from "@/ui/Field";
import { Menu } from "@/ui/Menu";
import { Capsule } from "@/ui/Status";
import { pushToast } from "@/ui/Toast";
import {
  emptyGoalDraft,
  GOAL_LEVEL_OPTIONS,
  GOAL_STATUS_OPTIONS,
  goalDraft,
  goalEdit,
  goalProblem,
  linkableGoals,
  linkGoalPatch,
  newGoalPayload,
  projectGoals,
  unlinkGoalPatch,
  type GoalDraft,
  type ProjectGoal,
} from "./settings-model";
import { failure, FootError, refreshProject } from "./shared";

/*
 * The project's goals. There's no Goals page (decision 14): goals are company records linked to
 * projects through `goalIds`, and a project's are kept here. You can add a new goal (created in the
 * company, then linked), link an existing one, edit one (title, description, status, level, owner),
 * archive it, or take it off the project. Archiving cancels the goal, as the old UI retires goals;
 * the API's delete would leave tasks pointing at a missing goal.
 */

export function GoalsSection(props: { project: Project }) {
  const company = useCompany();
  const client = useQueryClient();
  const goals = useGoalsQuery();
  const [editing, setEditing] = createSignal<string | "new" | null>(null);
  const [showArchived, setShowArchived] = createSignal(false);
  const [problem, setProblem] = createSignal<string | null>(null);
  const [busy, setBusy] = createSignal(false);
  const list = createMemo(() => projectGoals(props.project, goals.data));
  const linkable = createMemo(() => linkableGoals(props.project, goals.data));

  const refresh = () => Promise.all([client.invalidateQueries({ queryKey: queryKeys.goals.list(company().id) }), refreshProject(client, company().id)]);

  /** Runs one change, shows its error in the footer, and refreshes the goals and project. */
  const run = async (work: () => Promise<unknown>, fallback: string, done?: string) => {
    setBusy(true);
    setProblem(null);
    try {
      await work();
      await refresh();
      if (done) pushToast({ tone: "success", title: done });
      return true;
    } catch (caught) {
      setProblem(failure(caught, fallback));
      return false;
    } finally {
      setBusy(false);
    }
  };

  const create = async (draft: GoalDraft) => {
    const ok = await run(
      async () => {
        const goal = await goalsApi.create(company().id, newGoalPayload(draft));
        try {
          await projectsApi.update(props.project.id, linkGoalPatch(props.project, goal.id) ?? {});
        } catch (caught) {
          throw new Error(`Created the goal, but couldn't link it to the project (${failure(caught, "unknown error")}). Link it from Link a goal.`);
        }
      },
      "Couldn't create the goal.",
      `Added ${draft.title.trim()}`,
    );
    if (ok) setEditing(null);
  };
  const update = async (goal: ProjectGoal, draft: GoalDraft) => {
    const patch = goalEdit(goal, draft);
    if (!patch) return setEditing(null);
    if (await run(() => goalsApi.update(goal.id, patch), "Couldn't save the goal.")) setEditing(null);
  };
  const setStatus = (goal: ProjectGoal, status: ProjectGoal["status"], done: string) => void run(() => goalsApi.update(goal.id, { status }), "Couldn't change the goal.", done);
  const unlink = (goal: ProjectGoal) => {
    const patch = unlinkGoalPatch(props.project, goal.id);
    if (patch) void run(() => projectsApi.update(props.project.id, patch), "Couldn't take the goal off the project.", `Took ${goal.title} off the project`);
  };
  const link = (goalId: string, title: string) => {
    const patch = linkGoalPatch(props.project, goalId);
    if (patch) void run(() => projectsApi.update(props.project.id, patch), "Couldn't link the goal.", `Linked ${title}`);
  };

  return (
    <SettingsCard
      title="Goals"
      description="Why this project exists. A task in the project gets its first goal unless you pick another, and agents read the goal with the task."
      footer={
        <>
          <Button size="compact" icon={<Plus size={14} aria-hidden="true" />} disabled={busy() || editing() === "new"} onClick={() => setEditing("new")}>
            New goal
          </Button>
          <Menu>
            <Menu.Trigger class="btn btn--secondary btn--compact" disabled={busy()}>
              <Link2 size={14} aria-hidden="true" />
              Link a goal
            </Menu.Trigger>
            <Menu.Content label="Company goals" width={300}>
              <For each={linkable()} fallback={<p class="nt-menu-note">No other goals in the company.</p>}>
                {(goal) => (
                  <Menu.Item onSelect={() => link(goal.id, goal.title)} icon={<Capsule gradient={statusOption(goal.status).gradient} size="row" />} description={levelLabel(goal.level)}>
                    {goal.title}
                  </Menu.Item>
                )}
              </For>
            </Menu.Content>
          </Menu>
          <FootError message={problem()} />
        </>
      }
    >
      <div class="ps-goals">
        <Show when={goals.isPending}>
          <p class="ps-list-note">Loading goals…</p>
        </Show>
        <For each={list().open}>
          {(goal) => (
            <Show
              when={editing() === goal.id}
              fallback={
                <GoalRow
                  goal={goal}
                  busy={busy()}
                  onEdit={() => setEditing(goal.id)}
                  onArchive={() => setStatus(goal, "cancelled", `Archived ${goal.title}`)}
                  onUnlink={() => unlink(goal)}
                />
              }
            >
              <GoalForm initial={goalDraft(goal)} busy={busy()} submitLabel="Save goal" onCancel={() => setEditing(null)} onSubmit={(draft) => void update(goal, draft)} />
            </Show>
          )}
        </For>
        <Show when={editing() === "new"}>
          <GoalForm initial={emptyGoalDraft()} busy={busy()} submitLabel="Add goal" onCancel={() => setEditing(null)} onSubmit={(draft) => void create(draft)} />
        </Show>
        <Show when={!goals.isPending && list().open.length === 0 && editing() !== "new"}>
          <p class="ps-list-note">No goals yet. Add one to say why the project exists, or link one the company already has.</p>
        </Show>
        <Show when={list().archived.length > 0}>
          <button type="button" class="ps-disclosure" aria-expanded={showArchived()} onClick={() => setShowArchived(!showArchived())}>
            <ChevronDown size={14} aria-hidden="true" />
            Archived ({list().archived.length})
          </button>
          <Show when={showArchived()}>
            <For each={list().archived}>
              {(goal) => (
                <div class="ps-goal ps-goal--archived">
                  <Capsule gradient="ash" size="row" />
                  <span class="ps-goal-title">{goal.title}</span>
                  <span class="ps-goal-actions">
                    <Button size="compact" variant="quiet" disabled={busy()} onClick={() => setStatus(goal, "planned", `Restored ${goal.title}`)}>
                      Restore
                    </Button>
                    <Button size="compact" variant="quiet" disabled={busy()} onClick={() => unlink(goal)}>
                      Take off project
                    </Button>
                  </span>
                </div>
              )}
            </For>
          </Show>
        </Show>
      </div>
    </SettingsCard>
  );
}

function statusOption(status: ProjectGoal["status"]) {
  return GOAL_STATUS_OPTIONS.find((option) => option.value === status) ?? GOAL_STATUS_OPTIONS[0]!;
}

function levelLabel(level: ProjectGoal["level"]) {
  return `${GOAL_LEVEL_OPTIONS.find((option) => option.value === level)?.label ?? level} goal`;
}

function GoalRow(props: { goal: ProjectGoal; busy: boolean; onEdit: () => void; onArchive: () => void; onUnlink: () => void }) {
  const agents = useAgentsQuery();
  const owner = () => activeAgents(agents.data).find((agent) => agent.id === props.goal.ownerAgentId);
  return (
    <div class="ps-goal">
      <Capsule gradient={statusOption(props.goal.status).gradient} size="row" live={props.goal.status === "active"} />
      <div class="ps-goal-text">
        <button type="button" class="ps-goal-title ps-goal-open" onClick={() => props.onEdit()}>
          {props.goal.title}
        </button>
        <span class="ps-goal-meta">
          {statusOption(props.goal.status).label} · {levelLabel(props.goal.level)}
          <Show when={owner()}>{(agent) => <> · {agent().name}</>}</Show>
        </span>
        <Show when={props.goal.description}>
          <p class="ps-goal-desc">{props.goal.description}</p>
        </Show>
      </div>
      <span class="ps-goal-actions">
        <Button size="compact" variant="quiet" disabled={props.busy} onClick={() => props.onEdit()}>
          Edit
        </Button>
        <Menu placement="bottom-end">
          <Menu.Trigger class="btn btn--quiet btn--compact" aria-label={`More for ${props.goal.title}`} disabled={props.busy}>
            More
            <ChevronDown size={13} aria-hidden="true" />
          </Menu.Trigger>
          <Menu.Content label="Goal actions" width={240}>
            <Menu.Item onSelect={() => props.onArchive()} description="Cancels it; you can restore it">
              Archive goal
            </Menu.Item>
            <Menu.Item onSelect={() => props.onUnlink()} description="It stays in the company">
              Take off this project
            </Menu.Item>
          </Menu.Content>
        </Menu>
      </span>
    </div>
  );
}

function GoalForm(props: { initial: GoalDraft; busy: boolean; submitLabel: string; onCancel: () => void; onSubmit: (draft: GoalDraft) => void }) {
  const agents = useAgentsQuery();
  const agentList = createMemo(() => activeAgents(agents.data));
  const [draft, setDraft] = createStore<GoalDraft>({ ...props.initial });
  const [problem, setProblem] = createSignal<string | null>(null);
  const owner = () => agentList().find((agent) => agent.id === draft.ownerAgentId);
  const id = `ps-goal-${Math.random().toString(36).slice(2, 8)}`;

  const submit = (event: Event) => {
    event.preventDefault();
    const found = goalProblem(draft);
    if (found) return setProblem(found);
    setProblem(null);
    props.onSubmit({ ...draft });
  };

  return (
    <form class="ps-goal-form" onSubmit={submit} onKeyDown={(event) => event.key === "Escape" && props.onCancel()}>
      <label class="sr-only" for={`${id}-title`}>
        Goal title
      </label>
      <TextInput
        id={`${id}-title`}
        placeholder="What the project is for, such as “Ship paper trading by December”"
        value={draft.title}
        onInput={(event) => setDraft("title", event.currentTarget.value)}
        autofocus
      />
      <label class="sr-only" for={`${id}-desc`}>
        Description
      </label>
      <TextArea id={`${id}-desc`} rows={3} placeholder="More detail, if it helps" value={draft.description} onInput={(event) => setDraft("description", event.currentTarget.value)} />
      <div class="ps-inline">
        <Menu>
          <Menu.Trigger as={FieldButton} class="ps-field-auto" aria-label={`Status: ${statusOption(draft.status).label}`} icon={<Capsule gradient={statusOption(draft.status).gradient} size="tiny" />}>
            {statusOption(draft.status).label}
          </Menu.Trigger>
          <Menu.Content label="Status" width={220}>
            <For each={GOAL_STATUS_OPTIONS}>
              {(option) => (
                <Menu.Item onSelect={() => setDraft("status", option.value)} icon={<Capsule gradient={option.gradient} size="row" />} hint={option.value === draft.status ? <Check size={14} /> : undefined}>
                  {option.label}
                </Menu.Item>
              )}
            </For>
          </Menu.Content>
        </Menu>
        <Menu>
          <Menu.Trigger as={FieldButton} class="ps-field-auto" aria-label={`Level: ${levelLabel(draft.level)}`}>
            {levelLabel(draft.level)}
          </Menu.Trigger>
          <Menu.Content label="Level" width={220}>
            <For each={GOAL_LEVEL_OPTIONS}>
              {(option) => (
                <Menu.Item onSelect={() => setDraft("level", option.value)} hint={option.value === draft.level ? <Check size={14} /> : undefined}>
                  {option.label}
                </Menu.Item>
              )}
            </For>
          </Menu.Content>
        </Menu>
        <Menu>
          <Menu.Trigger
            as={FieldButton}
            class="ps-field-auto"
            aria-label={`Owner: ${owner()?.name ?? "No owner"}`}
            icon={<Show when={owner()}>{(agent) => <AgentAvatar agent={agent()} size={20} ring={false} />}</Show>}
          >
            {owner()?.name ?? "No owner"}
          </Menu.Trigger>
          <Menu.Content label="Owner" width={260}>
            <For each={agentList()} fallback={<p class="nt-menu-note">No agents yet.</p>}>
              {(agent) => (
                <Menu.Item onSelect={() => setDraft("ownerAgentId", agent.id)} icon={<AgentAvatar agent={agent} size={24} ring={false} />} hint={agent.id === draft.ownerAgentId ? <Check size={14} /> : undefined}>
                  {agent.name}
                </Menu.Item>
              )}
            </For>
            <Menu.Separator />
            <Menu.Item onSelect={() => setDraft("ownerAgentId", null)} hint={draft.ownerAgentId ? undefined : <Check size={14} />}>
              No owner
            </Menu.Item>
          </Menu.Content>
        </Menu>
      </div>
      <div class="ps-form-foot">
        <Show when={problem()}>
          <span class="nt-error" role="alert">
            {problem()}
          </span>
        </Show>
        <Button size="compact" variant="quiet" onClick={() => props.onCancel()}>
          Cancel
        </Button>
        <Button size="compact" variant="primary" type="submit" disabled={props.busy}>
          {props.busy ? "Saving…" : props.submitLabel}
        </Button>
      </div>
    </form>
  );
}
