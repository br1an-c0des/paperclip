import type { Project, ProjectAccessMember } from "@paperclipai/shared";
import { createMutation, createQuery, useQueryClient } from "@tanstack/solid-query";
import { Globe, Lock, Plus, Star, X } from "lucide-solid";
import { createMemo, createSignal, For, Match, Show, Switch } from "solid-js";
import { personName } from "@/api/access";
import { activeAgents } from "@/api/agents";
import { projectsApi } from "@/api/projects";
import { queryKeys } from "@/api/queryKeys";
import { resourceMembershipsApi } from "@/api/resource-memberships";
import { useCompany } from "@/lib/company";
import { useAgentsQuery, usePeopleQuery } from "@/lib/company-data";
import { useSession } from "@/lib/session";
import { useBoardAccess } from "@/tasks/TaskActions";
import { canManagePrivacy } from "@/tasks/task-edits";
import { AgentAvatar, InitialsDisc } from "@/ui/Avatar";
import { Button } from "@/ui/Button";
import { Dialog } from "@/ui/Dialog";
import { SettingsCard, SettingsRow } from "@/ui/Field";
import { Menu } from "@/ui/Menu";
import { pushToast } from "@/ui/Toast";
import { addableMembers, isOwnerMember, isStarred, membershipState, visibilityChange, type Candidate } from "./settings-model";
import { CardNote, failure, useProjectSaver } from "./shared";

/*
 * Visibility and members (board 10's second card). An open project is visible to everyone in the
 * company; a private one only to its members, which are listed, added and removed here
 * (`/projects/:id/access-members`). Only the project's privacy owner, company owners and admins, and
 * instance admins may change who can see it, as in the old UI; the server checks again.
 *
 * Joining and starring are personal (`/resource-memberships/me`): joining only decides whether the
 * project shows in your sidebar, and a star pins it.
 */

export function AccessSection(props: { project: Project }) {
  const company = useCompany();
  const client = useQueryClient();
  const session = useSession();
  const access = useBoardAccess();
  const saver = useProjectSaver(() => props.project);
  const [confirmOpen, setConfirmOpen] = createSignal(false);

  const canManage = () => {
    const current = access();
    return canManagePrivacy(
      { companyId: props.project.companyId, responsibleUserId: props.project.privacyOwnerUserId ?? null, createdByUserId: props.project.personalOwnerUserId ?? null, assigneeUserId: null },
      current.youId,
      current.access,
      current.localTrusted,
    );
  };
  const isPrivate = () => props.project.visibility === "private";

  const pick = (next: "open" | "private") => {
    const change = visibilityChange(props.project.visibility, next);
    if (change === "confirm") setConfirmOpen(true);
    else if (change === "save") void saveVisibility(next);
  };
  const saveVisibility = async (visibility: "open" | "private") => {
    // Visibility changes which tasks people can read, so every task list refreshes.
    if (await saver.save({ visibility })) void client.invalidateQueries({ queryKey: ["issues"] });
  };

  return (
    <>
      <SettingsCard
        title="Visibility and members"
        description={
          <CardNote state={saver.state()} error={saver.error()}>
            Who can see this project and its tasks.
          </CardNote>
        }
      >
        <SettingsRow label="Visibility">
          <div class="ps-choices" role="radiogroup" aria-label="Visibility">
            <button type="button" role="radio" class="ps-choice" aria-checked={!isPrivate()} disabled={!canManage()} onClick={() => pick("open")}>
              <span class="ps-radio" aria-hidden="true" />
              <span>
                <b>
                  <Globe size={14} aria-hidden="true" /> Open
                </b>
                <span class="ps-choice-help">Everyone in {company().name} can find it. Tasks made private keep their own access.</span>
              </span>
            </button>
            <button type="button" role="radio" class="ps-choice" aria-checked={isPrivate()} disabled={!canManage()} onClick={() => pick("private")}>
              <span class="ps-radio" aria-hidden="true" />
              <span>
                <b>
                  <Lock size={14} aria-hidden="true" /> Private
                </b>
                <span class="ps-choice-help">Only its members can find it and read its tasks. A task can still be shared directly.</span>
              </span>
            </button>
          </div>
          <Show when={!canManage()}>
            <p class="fhelp">Only the project's owner and company admins can change who sees it.</p>
          </Show>
        </SettingsRow>
        <Show when={isPrivate()}>
          <SettingsRow label="Members" help="People and agents who can see this private project.">
            <Members project={props.project} canManage={canManage()} />
          </SettingsRow>
        </Show>
        <YourMembership project={props.project} youId={session.youId()} />
      </SettingsCard>

      <Dialog
        open={confirmOpen()}
        onOpenChange={setConfirmOpen}
        title="Open this project to the company?"
        width={480}
        description="Everyone in the company will be able to find this project. Its private tasks stay private, but members who could only see them through this project lose access. Share those tasks directly first if they should keep it."
        footer={
          <>
            <Button variant="quiet" onClick={() => setConfirmOpen(false)}>
              Keep private
            </Button>
            <Button
              variant="primary"
              onClick={() => {
                setConfirmOpen(false);
                void saveVisibility("open");
              }}
            >
              Open to the company
            </Button>
          </>
        }
      >
        {null}
      </Dialog>
    </>
  );
}

function Members(props: { project: Project; canManage: boolean }) {
  const client = useQueryClient();
  const session = useSession();
  const agents = useAgentsQuery();
  const people = usePeopleQuery();
  const [problem, setProblem] = createSignal<string | null>(null);
  const members = createQuery(() => ({
    queryKey: queryKeys.projectSettings.accessMembers(props.project.id),
    queryFn: ({ signal }) => projectsApi.listAccessMembers(props.project.id, signal),
  }));
  const agentById = (id: string) => activeAgents(agents.data).find((agent) => agent.id === id);
  const candidates = createMemo<Candidate[]>(() => [
    ...(people.data?.users ?? []).map((entry) => ({ kind: "user" as const, id: entry.principalId, name: entry.principalId === session.youId() ? "You" : personName(entry) })),
    ...activeAgents(agents.data).map((agent) => ({ kind: "agent" as const, id: agent.id, name: agent.name })),
  ]);
  const addable = createMemo(() => addableMembers(members.data ?? [], candidates()));

  const refresh = () =>
    Promise.all([
      client.invalidateQueries({ queryKey: queryKeys.projectSettings.accessMembers(props.project.id) }),
      // Membership changes which tasks people can read.
      client.invalidateQueries({ queryKey: ["issues"] }),
    ]);
  const add = createMutation(() => ({
    mutationFn: (candidate: Candidate) => projectsApi.addAccessMember(props.project.id, { subjectType: candidate.kind, subjectId: candidate.id }),
    onSuccess: (_data, candidate) => {
      setProblem(null);
      void refresh();
      pushToast({ tone: "success", title: `Added ${candidate.name}` });
    },
    onError: (caught) => setProblem(failure(caught, "Couldn't add the member.")),
  }));
  const remove = createMutation(() => ({
    mutationFn: (member: ProjectAccessMember) => projectsApi.removeAccessMember(props.project.id, member.id),
    onSuccess: (_data, member) => {
      setProblem(null);
      void refresh();
      pushToast({ tone: "success", title: `Removed ${member.subjectDisplayName ?? "the member"}` });
    },
    onError: (caught) => setProblem(failure(caught, "Couldn't remove the member.")),
  }));

  return (
    <div class="ps-stack">
      <div class="ps-list">
        <Switch>
          <Match when={members.isPending}>
            <p class="ps-list-note">Loading members…</p>
          </Match>
          <Match when={members.isError}>
            <p class="ps-list-note" role="alert">
              Couldn't load the members. {failure(members.error, "")}
            </p>
          </Match>
          <Match when={true}>
            <For each={members.data} fallback={<p class="ps-list-note">No members yet besides the owner.</p>}>
              {(member) => {
                const owner = () => isOwnerMember(props.project, member);
                const name = () => (member.subjectType === "user" && member.subjectId === session.youId() ? `${member.subjectDisplayName ?? "You"} (you)` : (member.subjectDisplayName ?? "Unknown member"));
                return (
                  <div class="ps-list-row">
                    <Show when={member.subjectType === "agent" && agentById(member.subjectId)} fallback={<InitialsDisc name={member.subjectDisplayName ?? "?"} seed={member.subjectId} size={24} />}>
                      {(agent) => <AgentAvatar agent={agent()} size={24} ring={false} />}
                    </Show>
                    <span class="ps-list-name">{name()}</span>
                    <span class="ps-list-meta">{owner() ? "Owner" : member.subjectType === "agent" ? "Agent" : "Person"}</span>
                    <Show when={!owner() && props.canManage}>
                      <button type="button" class="nt-icon nt-icon--small" aria-label={`Remove ${member.subjectDisplayName ?? "member"}`} disabled={remove.isPending} onClick={() => remove.mutate(member)}>
                        <X size={13} aria-hidden="true" />
                      </button>
                    </Show>
                  </div>
                );
              }}
            </For>
          </Match>
        </Switch>
      </div>
      <Show when={props.canManage}>
        <div class="ps-inline">
          <Menu>
            <Menu.Trigger class="nt-pill nt-pill--quiet" disabled={add.isPending}>
              <Plus size={13} aria-hidden="true" />
              Add a member
            </Menu.Trigger>
            <Menu.Content label="Add a member" width={280}>
              <Show when={addable().length > 0} fallback={<p class="nt-menu-note">Everyone in the company is a member already.</p>}>
                <Show when={addable().some((candidate) => candidate.kind === "user")}>
                  <Menu.Group label="People">
                    <For each={addable().filter((candidate) => candidate.kind === "user")}>
                      {(candidate) => (
                        <Menu.Item onSelect={() => add.mutate(candidate)} icon={<InitialsDisc name={candidate.name} seed={candidate.id} size={22} />}>
                          {candidate.name}
                        </Menu.Item>
                      )}
                    </For>
                  </Menu.Group>
                </Show>
                <Show when={addable().some((candidate) => candidate.kind === "agent")}>
                  <Menu.Group label="Agents">
                    <For each={addable().filter((candidate) => candidate.kind === "agent")}>
                      {(candidate) => (
                        <Menu.Item
                          onSelect={() => add.mutate(candidate)}
                          icon={<Show when={agentById(candidate.id)}>{(agent) => <AgentAvatar agent={agent()} size={24} ring={false} />}</Show>}
                        >
                          {candidate.name}
                        </Menu.Item>
                      )}
                    </For>
                  </Menu.Group>
                </Show>
              </Show>
            </Menu.Content>
          </Menu>
          <span class="fhelp">An agent you add can remember what it reads here in later runs; removing it later can't erase that.</span>
        </div>
      </Show>
      <Show when={problem()}>
        <span class="field-error" role="alert">
          {problem()}
        </span>
      </Show>
    </div>
  );
}

/** Your own membership: joined or left (your sidebar), and starred. */
export function useMembership(project: () => Project) {
  const company = useCompany();
  const client = useQueryClient();
  const memberships = createQuery(() => ({
    queryKey: queryKeys.projectSettings.memberships(company().id),
    queryFn: ({ signal }) => resourceMembershipsApi.mine(company().id, signal),
  }));
  const update = createMutation(() => ({
    mutationFn: (data: { state?: "joined" | "left"; starred?: boolean }) => resourceMembershipsApi.updateProject(company().id, project().id, data),
    onSuccess: (_result, data) => {
      void client.invalidateQueries({ queryKey: queryKeys.projectSettings.memberships(company().id) });
      void client.invalidateQueries({ queryKey: queryKeys.projects.all(company().id) });
      if (data.state) pushToast({ tone: "success", title: data.state === "left" ? `Left ${project().name}` : `Joined ${project().name}` });
    },
    onError: (caught) => pushToast({ tone: "error", title: "Couldn't change your membership", body: failure(caught, "") }),
  }));
  return {
    loaded: () => memberships.data !== undefined,
    state: () => membershipState(memberships.data, project().id),
    starred: () => isStarred(memberships.data, project().id),
    pending: () => update.isPending,
    set: (data: { state?: "joined" | "left"; starred?: boolean }) => update.mutate(data),
  };
}

function YourMembership(props: { project: Project; youId: string | null }) {
  const membership = useMembership(() => props.project);
  return (
    <>
      <SettingsRow label="In your sidebar" help="Joining is personal. It only decides whether the project shows in your sidebar.">
        <div class="ps-inline ps-inline--spread">
          <span class="ps-muted-line">{membership.state() === "left" ? "You've left this project." : "You've joined this project."}</span>
          <Button size="compact" disabled={!membership.loaded() || membership.pending()} onClick={() => membership.set({ state: membership.state() === "left" ? "joined" : "left" })}>
            {membership.state() === "left" ? "Join" : "Leave"}
          </Button>
        </div>
      </SettingsRow>
      <SettingsRow label="Starred" help="Starred projects are pinned for you.">
        <div class="ps-inline ps-inline--spread">
          <span class="ps-muted-line">{membership.starred() ? "You've starred this project." : "Not starred."}</span>
          <Button
            size="compact"
            aria-pressed={membership.starred()}
            disabled={!membership.loaded() || membership.pending()}
            icon={<Star size={14} aria-hidden="true" fill={membership.starred() ? "currentColor" : "none"} />}
            onClick={() => membership.set({ starred: !membership.starred() })}
          >
            {membership.starred() ? "Unstar" : "Star"}
          </Button>
        </div>
      </SettingsRow>
    </>
  );
}
