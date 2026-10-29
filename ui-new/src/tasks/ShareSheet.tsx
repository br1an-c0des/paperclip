import type { Issue, IssueAccessGrant } from "@paperclipai/shared";
import { createQuery, useQueryClient } from "@tanstack/solid-query";
import { TriangleAlert, UserPlus } from "lucide-solid";
import { createMemo, createSignal, For, Match, Show, Switch } from "solid-js";
import { issuesApi } from "@/api/issues";
import { queryKeys } from "@/api/queryKeys";
import { ConfirmDialog } from "@/documents/ConfirmDialog";
import { AgentAvatar, InitialsDisc } from "@/ui/Avatar";
import { Button } from "@/ui/Button";
import { Dialog } from "@/ui/Dialog";
import { TextInput } from "@/ui/Field";
import { pushToast } from "@/ui/Toast";
import { useTaskPeople } from "./people";
import "./ShareSheet.css";
import { activeGrants, canRevoke, grantedKeys, isSharedAgent, roleRows, SOURCE_LABELS } from "./share-model";
import { stampLabel } from "./thread-model";

/*
 * The share sheet (`tasks/privacy`), from the More menu of a private task: who can see it and why,
 * sharing it with a person or an agent, and taking a grant back. After the old UI's IssueShareSheet:
 * owners and assignees can see it by their role (no revoke: change the role instead); grants show
 * where they come from; project and inherited access are managed where they start. Sharing reaches
 * the task's subtasks too. Only the task's owner or an admin can change it (canManagePrivacy).
 */

export function ShareSheet(props: { task: Issue; open: boolean; canManage: boolean; onOpenChange: (open: boolean) => void }) {
  const client = useQueryClient();
  const people = useTaskPeople();
  const [adding, setAdding] = createSignal(false);
  const [filter, setFilter] = createSignal("");
  const [choice, setChoice] = createSignal<string | null>(null);
  const [busy, setBusy] = createSignal(false);
  const [revoking, setRevoking] = createSignal<IssueAccessGrant | null>(null);

  const grants = createQuery(() => ({
    queryKey: queryKeys.issues.section(props.task.id, "access-grants"),
    queryFn: ({ signal }) => issuesApi.accessGrants(props.task.id, signal),
    enabled: props.open,
  }));
  const active = () => activeGrants(grants.data ?? []);
  // Role rows a grant already covers show once, as the grant.
  const roles = () => roleRows(props.task).filter((row) => !active().some((grant) => `${grant.subjectType}:${grant.subjectId}` === row.key));
  const roleOf = (grant: IssueAccessGrant) => roleRows(props.task).find((row) => row.key === `${grant.subjectType}:${grant.subjectId}`);

  const candidates = createMemo(() => {
    const taken = grantedKeys(grants.data ?? []);
    const words = filter().toLowerCase().split(/\s+/).filter(Boolean);
    const match = (name: string) => words.every((word) => name.toLowerCase().includes(word));
    const you = people.youId();
    const humans = [...(you ? [{ id: you, name: "You" }] : []), ...people.otherPeople()]
      .filter((person) => !taken.has(`user:${person.id}`) && match(person.name))
      .map((person) => ({ key: `user:${person.id}`, kind: "user" as const, id: person.id, name: person.name }));
    const agents = people
      .assignableAgents()
      .filter((agent) => !taken.has(`agent:${agent.id}`) && match(agent.name))
      .map((agent) => ({ key: `agent:${agent.id}`, kind: "agent" as const, id: agent.id, name: agent.name }));
    return [...humans, ...agents];
  });
  const chosenAgent = () => {
    const key = choice();
    return key?.startsWith("agent:") ? people.agent(key.slice("agent:".length)) : undefined;
  };

  const refresh = () => {
    // A grant changes what the task's subtasks show too, and where the task is listed.
    void client.invalidateQueries({ queryKey: ["issues"] });
  };
  const share = async () => {
    const key = choice();
    if (!key) return;
    const [subjectType, subjectId] = key.split(/:(.+)/) as ["user" | "agent", string];
    setBusy(true);
    try {
      await issuesApi.grantAccess(props.task.id, { subjectType, subjectId });
      pushToast({ tone: "success", title: "Shared" });
      setAdding(false);
      setChoice(null);
      setFilter("");
      refresh();
    } catch (error) {
      pushToast({ tone: "error", title: "Couldn't share the task", body: (error as Error).message });
    } finally {
      setBusy(false);
    }
  };
  const revoke = async (grant: IssueAccessGrant) => {
    try {
      await issuesApi.revokeAccess(props.task.id, grant.id);
      pushToast({ tone: "success", title: "Access removed" });
      refresh();
    } catch (error) {
      pushToast({ tone: "error", title: "Couldn't remove the access", body: (error as Error).message });
    }
  };

  const close = (open: boolean) => {
    if (!open) {
      setAdding(false);
      setChoice(null);
      setFilter("");
    }
    props.onOpenChange(open);
  };

  return (
    <>
      <Dialog
        open={props.open}
        onOpenChange={close}
        title="Who can see this task"
        description="Sharing gives access to this task and its subtasks: comments, documents and run history. Its parent and the tasks beside it need their own access."
        width={480}
        footer={
          <Show
            when={adding()}
            fallback={
              <Show when={props.canManage}>
                <Button icon={<UserPlus size={14} aria-hidden="true" />} disabled={grants.isPending} onClick={() => setAdding(true)}>
                  Share with someone
                </Button>
              </Show>
            }
          >
            <Button variant="quiet" onClick={() => (setAdding(false), setChoice(null))}>
              Back
            </Button>
            <Button variant="primary" disabled={!choice() || busy()} onClick={() => void share()}>
              {busy() ? "Sharing…" : "Share"}
            </Button>
          </Show>
        }
      >
        <Show
          when={adding()}
          fallback={
            <Switch>
              <Match when={grants.isPending}>
                <p class="share-muted">Loading who can see it…</p>
              </Match>
              <Match when={grants.isError}>
                <p class="share-muted">
                  Who can see it couldn't be loaded.{" "}
                  <Button size="compact" ghost onClick={() => void grants.refetch()}>
                    Try again
                  </Button>
                </p>
              </Match>
              <Match when={roles().length + active().length === 0}>
                <p class="share-muted">Only you can see this task.</p>
              </Match>
              <Match when={true}>
                <ul class="share-list">
                  <For each={roles()}>
                    {(row) => (
                      <li class="share-row">
                        <Subject kind={row.kind} id={row.id} people={people} />
                        <span class="share-text">
                          <span class="share-name">{name(row.kind, row.id, people)}</span>
                          <span class="share-muted">Can see it while they're its {row.role.toLowerCase()}</span>
                        </span>
                        <span class="share-badge">{row.role}</span>
                      </li>
                    )}
                  </For>
                  <For each={active()}>
                    {(grant) => (
                      <li class="share-row">
                        <Subject kind={grant.subjectType} id={grant.subjectId} people={people} />
                        <span class="share-text">
                          <span class="share-name">
                            {grant.subjectId === people.youId() ? "You" : (grant.subjectDisplayName ?? name(grant.subjectType, grant.subjectId, people))}
                          </span>
                          <span class="share-muted">
                            <Switch fallback={<>{grant.source === "explicit" ? "Shared" : "Given access"} {stampLabel(grant.createdAt)}</>}>
                              <Match when={grant.source === "owner"}>Owns this task</Match>
                              <Match when={grant.inherited && grant.source === "project"}>Through the task's private project</Match>
                              <Match when={grant.inherited}>Inherited, managed where it comes from</Match>
                              <Match when={roleOf(grant)}>{(row) => <>Its {row().role.toLowerCase()}, with a saved grant</>}</Match>
                            </Switch>
                          </span>
                        </span>
                        <span class="share-badge" data-source={grant.source}>
                          {SOURCE_LABELS[grant.source]}
                        </span>
                        <Show when={props.canManage && canRevoke(grant)}>
                          <Button size="compact" ghost onClick={() => setRevoking(grant)}>
                            Remove
                          </Button>
                        </Show>
                      </li>
                    )}
                  </For>
                </ul>
              </Match>
            </Switch>
          }
        >
          <div class="share-add">
            <TextInput
              type="search"
              value={filter()}
              ref={(element) => queueMicrotask(() => element.focus())}
              onInput={(event) => setFilter(event.currentTarget.value)}
              placeholder="Search people and agents"
              aria-label="Search people and agents"
            />
            <div class="share-pick" role="radiogroup" aria-label="Share with">
              <For each={candidates()} fallback={<p class="share-muted">No one left to add.</p>}>
                {(candidate) => (
                  <button type="button" class="share-row share-option" role="radio" aria-checked={choice() === candidate.key} onClick={() => setChoice(candidate.key)}>
                    <Subject kind={candidate.kind} id={candidate.id} people={people} />
                    <span class="share-name">{candidate.name}</span>
                    <span class="share-muted">{candidate.kind === "agent" ? "Agent" : "Person"}</span>
                  </button>
                )}
              </For>
            </div>
            <Show when={chosenAgent() && isSharedAgent(chosenAgent()!)}>
              <p class="share-caution" role="note">
                <TriangleAlert size={14} aria-hidden="true" />
                <span>
                  <b>{chosenAgent()!.name} works for others too.</b> Its memory and workspace can carry what it sees here into later runs for
                  other people. Share only if that's acceptable.
                </span>
              </p>
            </Show>
          </div>
        </Show>
      </Dialog>
      <ConfirmDialog
        open={revoking() !== null}
        onOpenChange={(open) => !open && setRevoking(null)}
        title={`Remove ${revoking()?.subjectDisplayName ?? "this"} grant?`}
        body={
          <>
            This removes the grant and the access it gives to the task's subtasks. Ownership, assignment, the project or another grant can still
            give access. It doesn't erase what was already seen, or what an agent remembers.
          </>
        }
        confirmLabel="Remove grant"
        danger
        onConfirm={() => {
          const grant = revoking();
          return grant ? revoke(grant) : undefined;
        }}
      />
    </>
  );
}

function name(kind: "user" | "agent", id: string, people: ReturnType<typeof useTaskPeople>) {
  if (kind === "agent") return people.agent(id)?.name ?? "An agent";
  return id === people.youId() ? "You" : people.personName(id);
}

function Subject(props: { kind: "user" | "agent"; id: string; people: ReturnType<typeof useTaskPeople> }) {
  return (
    <Show
      when={props.kind === "agent" && props.people.agent(props.id)}
      fallback={<InitialsDisc name={name(props.kind, props.id, props.people)} seed={props.id} size={24} you={props.id === props.people.youId()} />}
    >
      {(agent) => <AgentAvatar agent={agent()} size={24} />}
    </Show>
  );
}
