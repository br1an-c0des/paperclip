import { A } from "@solidjs/router";
import { createQuery, useQueryClient } from "@tanstack/solid-query";
import { Check, Copy, Ellipsis, Link2, UserPlus } from "lucide-solid";
import { createMemo, createSignal, For, Show } from "solid-js";
import { accessApi, type CompanyInviteCreated, type CompanyMember, type HumanCompanyRole } from "@/api/access";
import { activeAgents } from "@/api/agents";
import { ApiError } from "@/api/client";
import { queryKeys } from "@/api/queryKeys";
import { useCompany } from "@/lib/company";
import { useAgentsQuery } from "@/lib/company-data";
import { useSession } from "@/lib/session";
import { AgentAvatar, InitialsDisc } from "@/ui/Avatar";
import { Button } from "@/ui/Button";
import { Dialog } from "@/ui/Dialog";
import { FieldButton, TextInput } from "@/ui/Field";
import { Menu } from "@/ui/Menu";
import { pushToast } from "@/ui/Toast";
import {
  approveRole,
  inviteMeta,
  inviteTitle,
  memberMeta,
  memberName,
  requesterName,
  requestMeta,
  ROLE_OPTIONS,
  roleLabel,
  sortInvites,
  visibleMembers,
} from "./members-model";
import { CardHead, CardNoteLine, copyText, failure, SectionTitle } from "./shared";

/*
 * Members (board 22): the people in the organization and their roles, invite links, and requests
 * to join. Agents are members too, but they're managed on the Agents page.
 *
 * Role and status changes go through `PATCH /companies/:id/members/:memberId`; removing someone
 * archives the membership and hands their open tasks to whoever you pick (or leaves them
 * unassigned). An invite's link is only returned when it's made, so it's shown and copied then;
 * older invites can be revoked but not copied again.
 */

const INVITE_PAGE = 20;

export function MembersSection(props: { anchor?: string }) {
  const company = useCompany();
  const client = useQueryClient();
  const session = useSession();
  const members = createQuery(() => ({
    queryKey: queryKeys.companySettings.members(company().id),
    queryFn: ({ signal }) => accessApi.members(company().id, signal),
  }));
  const access = () => members.data?.access;
  const list = createMemo(() => visibleMembers(members.data?.members ?? []));

  const refresh = () =>
    Promise.all([
      client.invalidateQueries({ queryKey: queryKeys.companySettings.members(company().id) }),
      client.invalidateQueries({ queryKey: queryKeys.access.userDirectory(company().id) }),
      client.invalidateQueries({ queryKey: queryKeys.companySettings.joinRequests(company().id) }),
    ]);

  const act = async (work: () => Promise<unknown>, done: string, failed: string) => {
    try {
      await work();
      await refresh();
      pushToast({ tone: "success", title: done });
      return true;
    } catch (caught) {
      pushToast({ tone: "error", title: failed, body: failure(caught, "") || undefined });
      return false;
    }
  };

  const [removing, setRemoving] = createSignal<CompanyMember | null>(null);
  const isYou = (member: CompanyMember) => member.principalId === (session.youId() ?? "");

  return (
    <>
      <SectionTitle title="Members">
        The people in {company().name}, their roles, and how new people get in. Agents are members too; manage them in{" "}
        <A class="ps-link" href={`/${company().issuePrefix}/agents`}>
          Agents
        </A>
        .
      </SectionTitle>

      <Show when={members.isError}>
        <CardNoteLine alert>
          {members.error instanceof ApiError && members.error.status === 403
            ? "You don't have permission to manage this organization's members."
            : `Couldn't load the members. ${failure(members.error, "")}`}
        </CardNoteLine>
      </Show>
      <Show when={access() && !access()!.currentUserRole}>
        <div class="ps-banner" role="status">
          You can manage members here as an instance admin, but you aren't a member of this organization yourself.
        </div>
      </Show>

      <section class="card settings-card" aria-labelledby="cs-people">
        <CardHead
          id="cs-people"
          title="People"
          note={members.data ? (list().length === 1 ? "1 member" : `${list().length} members`) : "Loading…"}
          actions={
            <Show when={access()?.canInviteUsers}>
              <a class={`btn btn--primary btn--compact`} href="#invites">
                <UserPlus size={14} aria-hidden="true" />
                Invite people
              </a>
            </Show>
          }
        />
        <div class="cs-table cs-table--people" role="table" aria-label="People">
          <div class="cs-thead" role="row">
            <span role="columnheader">Person</span>
            <span role="columnheader">Role</span>
            <span role="columnheader">
              <span class="sr-only">Actions</span>
            </span>
          </div>
          <For each={list()}>
            {(member) => (
              <div class="cs-trow" role="row">
                <span role="cell" class="cs-person">
                  <InitialsDisc name={memberName(member)} seed={member.principalId} size={30} you={isYou(member)} />
                  <span class="cs-person-text">
                    <span class="cs-strong">
                      {memberName(member)}
                      {isYou(member) ? " (you)" : ""}
                    </span>
                    <span class="cs-muted">{memberMeta(member)}</span>
                  </span>
                </span>
                <span role="cell">
                  <Menu>
                    <Menu.Trigger
                      as={FieldButton}
                      disabled={!access()?.canManageMembers}
                      aria-label={`${memberName(member)}'s role: ${roleLabel(member.membershipRole)}`}
                    >
                      {roleLabel(member.membershipRole)}
                    </Menu.Trigger>
                    <Menu.Content label="Role" width={300}>
                      <For each={ROLE_OPTIONS}>
                        {(option) => (
                          <Menu.Item
                            description={option.description}
                            hint={option.value === member.membershipRole ? <Check size={14} /> : undefined}
                            onSelect={() =>
                              option.value !== member.membershipRole &&
                              void act(
                                () => accessApi.updateMember(company().id, member.id, { membershipRole: option.value }),
                                `${memberName(member)} is now ${option.label.toLowerCase()}`,
                                "Couldn't change the role",
                              )
                            }
                          >
                            {option.label}
                          </Menu.Item>
                        )}
                      </For>
                    </Menu.Content>
                  </Menu>
                </span>
                <span role="cell" class="cs-cell-end">
                  <Show when={access()?.canManageMembers}>
                    <Menu placement="bottom-end">
                      <Menu.Trigger as={Button} variant="icon" ghost size="compact" aria-label={`More actions for ${memberName(member)}`}>
                        <Ellipsis size={16} aria-hidden="true" />
                      </Menu.Trigger>
                      <Menu.Content label="Member actions" width={240}>
                        <Show
                          when={member.status === "suspended"}
                          fallback={
                            <Menu.Item
                              disabled={isYou(member)}
                              onSelect={() =>
                                void act(
                                  () => accessApi.updateMember(company().id, member.id, { status: "suspended" }),
                                  `Suspended ${memberName(member)}`,
                                  "Couldn't suspend them",
                                )
                              }
                              description="They keep their role but can't sign in here"
                            >
                              Suspend
                            </Menu.Item>
                          }
                        >
                          <Menu.Item
                            onSelect={() =>
                              void act(
                                () => accessApi.updateMember(company().id, member.id, { status: "active" }),
                                `${memberName(member)} is active again`,
                                "Couldn't reactivate them",
                              )
                            }
                          >
                            Reactivate
                          </Menu.Item>
                        </Show>
                        <Menu.Item
                          danger
                          disabled={member.removal ? !member.removal.canArchive : isYou(member)}
                          description={member.removal && !member.removal.canArchive ? (member.removal.reason ?? undefined) : undefined}
                          onSelect={() => setRemoving(member)}
                        >
                          Remove from the organization…
                        </Menu.Item>
                      </Menu.Content>
                    </Menu>
                  </Show>
                </span>
              </div>
            )}
          </For>
        </div>
        <footer class="cfoot cs-muted">
          Owners and admins manage settings and members. Operators work with tasks, projects and agents. Viewers can look but not change anything.
        </footer>
      </section>

      <Show when={access()?.canInviteUsers !== false}>
        <InvitesCard />
      </Show>
      <Show when={access()?.canApproveJoinRequests}>
        <JoinRequestsCard onChanged={refresh} />
      </Show>

      <RemoveMemberDialog member={removing()} onClose={() => setRemoving(null)} onRemoved={refresh} />
    </>
  );
}

function InvitesCard() {
  const company = useCompany();
  const client = useQueryClient();
  const session = useSession();
  const invites = createQuery(() => ({
    queryKey: queryKeys.companySettings.invites(company().id),
    queryFn: ({ signal }) => accessApi.invites(company().id, { limit: INVITE_PAGE }, signal),
  }));
  const [role, setRole] = createSignal<HumanCompanyRole>("operator");
  const [created, setCreated] = createSignal<CompanyInviteCreated | null>(null);
  const [busy, setBusy] = createSignal(false);
  const [showAll, setShowAll] = createSignal(false);
  const sorted = createMemo(() => sortInvites(invites.data?.invites ?? []));
  const shown = createMemo(() => (showAll() ? sorted() : sorted().filter((invite) => invite.state === "active")));
  const hiddenCount = () => sorted().length - sorted().filter((invite) => invite.state === "active").length;
  const refresh = () => client.invalidateQueries({ queryKey: queryKeys.companySettings.invites(company().id) });

  const create = async () => {
    setBusy(true);
    try {
      const invite = await accessApi.createInvite(company().id, role());
      setCreated(invite);
      const copied = await copyText(invite.inviteUrl);
      pushToast({ tone: "success", title: copied ? "Invite link copied" : "Invite link ready", body: copied ? undefined : "Copy it from the field below." });
      await refresh();
    } catch (caught) {
      pushToast({ tone: "error", title: "Couldn't create the invite", body: failure(caught, "") || undefined });
    } finally {
      setBusy(false);
    }
  };

  const revoke = async (inviteId: string) => {
    try {
      await accessApi.revokeInvite(inviteId);
      if (created()?.id === inviteId) setCreated(null);
      await refresh();
      pushToast({ tone: "success", title: "Revoked the invite" });
    } catch (caught) {
      pushToast({ tone: "error", title: "Couldn't revoke the invite", body: failure(caught, "") || undefined });
    }
  };

  return (
    <section class="card settings-card" id="invites" aria-labelledby="cs-invites">
      <CardHead
        id="cs-invites"
        title="Invites"
        note="Anyone with the link can join with the role you choose."
        actions={
          <div class="cs-inline">
            <Menu>
              <Menu.Trigger as={FieldButton} class="cs-field-160" aria-label={`Invite as ${roleLabel(role())}`}>
                {roleLabel(role())}
              </Menu.Trigger>
              <Menu.Content label="Join as" width={300}>
                <For each={ROLE_OPTIONS}>
                  {(option) => (
                    <Menu.Item onSelect={() => setRole(option.value)} description={option.description} hint={option.value === role() ? <Check size={14} /> : undefined}>
                      {option.label}
                    </Menu.Item>
                  )}
                </For>
              </Menu.Content>
            </Menu>
            <Button size="compact" icon={<Link2 size={14} aria-hidden="true" />} disabled={busy()} onClick={() => void create()}>
              {busy() ? "Creating…" : "Create invite link"}
            </Button>
          </div>
        }
      />
      <Show when={created()}>
        {(invite) => (
          <div class="cs-lrow cs-new-invite">
            <div class="cs-grow">
              <div class="cs-strong">New link · {roleLabel(invite().humanRole ?? role())}</div>
              <TextInput readOnly value={invite().inviteUrl} aria-label="Invite link" class="mono" onFocus={(event) => event.currentTarget.select()} />
              <span class="fhelp">Copy it now: the link isn't shown again once you leave this page.</span>
            </div>
            <Button
              size="compact"
              icon={<Copy size={14} aria-hidden="true" />}
              onClick={async () => pushToast(await copyText(invite().inviteUrl) ? { tone: "success", title: "Copied the link" } : { tone: "warn", title: "Copy it from the field" })}
            >
              Copy link
            </Button>
          </div>
        )}
      </Show>
      <Show when={invites.isError}>
        <CardNoteLine alert>Couldn't load the invites. {failure(invites.error, "")}</CardNoteLine>
      </Show>
      <For each={shown()} fallback={<Show when={invites.data && !created()}><CardNoteLine>No open invites.</CardNoteLine></Show>}>
        {(invite) => (
          <div class="cs-lrow" classList={{ "cs-lrow--quiet": invite.state !== "active" }}>
            <div class="cs-grow">
              <div class="cs-strong">{inviteTitle(invite)}</div>
              <div class="cs-muted">{inviteMeta(invite, session.youId())}</div>
            </div>
            <Show when={invite.state === "active"}>
              <Button size="compact" variant="quiet" onClick={() => void revoke(invite.id)}>
                Revoke
              </Button>
            </Show>
          </div>
        )}
      </For>
      <Show when={hiddenCount() > 0}>
        <footer class="cfoot">
          <Button size="compact" variant="quiet" onClick={() => setShowAll(!showAll())}>
            {showAll() ? "Hide used and expired invites" : `Show used and expired invites (${hiddenCount()})`}
          </Button>
        </footer>
      </Show>
    </section>
  );
}

function JoinRequestsCard(props: { onChanged: () => Promise<unknown> }) {
  const company = useCompany();
  const requests = createQuery(() => ({
    queryKey: queryKeys.companySettings.joinRequests(company().id),
    queryFn: ({ signal }) => accessApi.joinRequests(company().id, signal),
  }));
  const [busy, setBusy] = createSignal<string | null>(null);

  const decide = async (requestId: string, approve: boolean, name: string) => {
    setBusy(requestId);
    try {
      if (approve) await accessApi.approveJoinRequest(company().id, requestId);
      else await accessApi.rejectJoinRequest(company().id, requestId);
      await props.onChanged();
      pushToast({ tone: "success", title: approve ? `Approved ${name}` : `Rejected ${name}'s request` });
    } catch (caught) {
      pushToast({ tone: "error", title: approve ? "Couldn't approve the request" : "Couldn't reject the request", body: failure(caught, "") || undefined });
    } finally {
      setBusy(null);
    }
  };

  return (
    <section class="card settings-card" id="join-requests" aria-labelledby="cs-join">
      <CardHead id="cs-join" title="Join requests" note="People who asked to join. Requests also arrive in your Inbox." />
      <Show when={requests.isError}>
        <CardNoteLine alert>Couldn't load the requests. {failure(requests.error, "")}</CardNoteLine>
      </Show>
      <For each={requests.data ?? []} fallback={<Show when={requests.data}><CardNoteLine>No one is waiting to join.</CardNoteLine></Show>}>
        {(request) => {
          const name = () => requesterName(request);
          const role = () => approveRole(request);
          return (
            <div class="cs-lrow">
              <div class="cs-person cs-grow">
                <InitialsDisc name={name()} seed={request.id} size={30} />
                <span class="cs-person-text">
                  <span class="cs-strong">{name()}</span>
                  <span class="cs-muted">
                    {requestMeta(request)}
                    {request.invite?.inviteMessage ? `: “${request.invite.inviteMessage}”` : ""}
                  </span>
                </span>
              </div>
              <div class="cs-inline">
                <Button size="compact" variant="primary" disabled={busy() === request.id} onClick={() => void decide(request.id, true, name())}>
                  {role() ? `Approve as ${roleLabel(role()).toLowerCase()}` : "Approve"}
                </Button>
                <Button size="compact" disabled={busy() === request.id} onClick={() => void decide(request.id, false, name())}>
                  Reject
                </Button>
              </div>
            </div>
          );
        }}
      </For>
    </section>
  );
}

/** Removing someone: who gets their open tasks, then the archive. */
function RemoveMemberDialog(props: { member: CompanyMember | null; onClose: () => void; onRemoved: () => Promise<unknown> }) {
  const company = useCompany();
  const agents = useAgentsQuery();
  const client = useQueryClient();
  const [target, setTarget] = createSignal<{ kind: "none" } | { kind: "agent"; id: string; name: string }>({ kind: "none" });
  const [busy, setBusy] = createSignal(false);
  const [problem, setProblem] = createSignal<string | null>(null);
  const candidates = createMemo(() => activeAgents(agents.data).filter((agent) => agent.status !== "pending_approval"));

  const remove = async () => {
    const member = props.member;
    if (!member) return;
    setBusy(true);
    setProblem(null);
    try {
      const current = target();
      const result = await accessApi.archiveMember(company().id, member.id, current.kind === "agent" ? { assigneeAgentId: current.id, assigneeUserId: null } : null);
      await props.onRemoved();
      await client.invalidateQueries({ queryKey: queryKeys.issues.list(company().id) });
      pushToast({
        tone: "success",
        title: `Removed ${memberName(member)}`,
        body: result.reassignedIssueCount > 0 ? `${result.reassignedIssueCount} open task${result.reassignedIssueCount === 1 ? "" : "s"} handed over.` : undefined,
      });
      setTarget({ kind: "none" });
      props.onClose();
    } catch (caught) {
      setProblem(failure(caught, "Couldn't remove them."));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Dialog
      open={!!props.member}
      onOpenChange={(open) => !open && props.onClose()}
      title={`Remove ${props.member ? memberName(props.member) : ""}?`}
      width={480}
      hideClose
      footer={
        <>
          <Show when={problem()}>
            <span class="nt-error ps-foot-error" role="alert">
              {problem()}
            </span>
          </Show>
          <Button variant="quiet" disabled={busy()} onClick={props.onClose}>
            Cancel
          </Button>
          <Button variant="danger" disabled={busy()} onClick={() => void remove()}>
            {busy() ? "Removing…" : "Remove"}
          </Button>
        </>
      }
    >
      <div class="cs-dialog-body">
        <p>They lose access to {company().name}. Their open tasks go to:</p>
        <Menu>
          <Menu.Trigger as={FieldButton} aria-label="Who gets their open tasks">
            {target().kind === "agent" ? (target() as { name: string }).name : "Nobody: leave them unassigned"}
          </Menu.Trigger>
          <Menu.Content label="Who gets their open tasks" width={320}>
            <Menu.Item onSelect={() => setTarget({ kind: "none" })} hint={target().kind === "none" ? <Check size={14} /> : undefined}>
              Nobody: leave them unassigned
            </Menu.Item>
            <Menu.Separator />
            <For each={candidates()}>
              {(agent) => (
                <Menu.Item
                  icon={<AgentAvatar agent={agent} size={24} ring={false} />}
                  onSelect={() => setTarget({ kind: "agent", id: agent.id, name: agent.name })}
                  hint={target().kind === "agent" && (target() as { id: string }).id === agent.id ? <Check size={14} /> : undefined}
                >
                  {agent.name}
                </Menu.Item>
              )}
            </For>
          </Menu.Content>
        </Menu>
      </div>
    </Dialog>
  );
}
