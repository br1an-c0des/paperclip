import type { ToolProfileWithDetails } from "@paperclipai/shared";
import { A, useNavigate } from "@solidjs/router";
import { createMutation, createQuery } from "@tanstack/solid-query";
import { MoreHorizontal, Plus, ShieldCheck } from "lucide-solid";
import { createMemo, createSignal, For, Match, Show, Switch } from "solid-js";
import { activeAgents } from "@/api/agents";
import { queryKeys } from "@/api/queryKeys";
import { toolAccessApi } from "@/api/tool-access";
import { shortDate } from "@/agents/shared";
import { useCompany } from "@/lib/company";
import { useAgentsQuery } from "@/lib/company-data";
import { Button } from "@/ui/Button";
import { Dialog } from "@/ui/Dialog";
import { Field } from "@/ui/Field";
import { Menu } from "@/ui/Menu";
import { pushToast } from "@/ui/Toast";
import { failureText, useRefreshTools } from "../shared";
import { CardState, StatePill } from "./parts";
import { allowsLabel, assignedLabel, deleteBlocker, isAppProfile, STATUS_LABEL, TEMPLATES } from "./profile-model";
import { useProfiles } from "./queries";

/*
 * Advanced → Access profiles (`/apps/advanced/profiles`, the old UI's ProfilesIndex): which tools a
 * run gets. Each profile with what it allows and who has it; drafts resume in the wizard. Profiles
 * an app's setup made for itself (`app:<connectionId>`) are listed apart: their app's page manages
 * them. "Check an agent's access" shows what one agent can use right now, and why.
 */

export const profilesBase = (prefix: string) => `/${prefix}/apps/advanced/profiles`;

export function useProfileActions() {
  const refresh = useRefreshTools();
  const fail = (title: string) => (error: unknown) => pushToast({ title, body: failureText(error, "Please try again."), tone: "error" });
  const update = createMutation(() => ({
    mutationFn: (input: { profile: ToolProfileWithDetails; status: "archived" | "active" }) => toolAccessApi.updateProfile(input.profile.id, { status: input.status }),
    onSuccess: (profile) => pushToast({ title: profile.status === "archived" ? "Profile archived" : "Profile restored", tone: "success" }),
    onError: fail("Couldn't change the profile"),
    onSettled: () => refresh(),
  }));
  const duplicate = createMutation(() => ({
    mutationFn: (input: { profile: ToolProfileWithDetails; name?: string; includeAssignments?: boolean }) =>
      toolAccessApi.duplicateProfile(input.profile.id, { name: input.name ?? `${input.profile.name} (copy)`, includeAssignments: input.includeAssignments }),
    onSuccess: () => pushToast({ title: "Profile duplicated", body: "The copy isn't assigned to anyone yet.", tone: "success" }),
    onError: fail("Couldn't duplicate the profile"),
    onSettled: () => refresh(),
  }));
  const remove = createMutation(() => ({
    mutationFn: (profile: ToolProfileWithDetails) => toolAccessApi.deleteProfile(profile.id),
    onSuccess: () => pushToast({ title: "Profile deleted", tone: "success" }),
    onError: fail("Couldn't delete the profile"),
    onSettled: () => refresh(),
  }));
  return { update, duplicate, remove };
}

export function ProfilesIndex(props: { checkOpen?: boolean }) {
  const company = useCompany();
  const navigate = useNavigate();
  const profiles = useProfiles();
  const actions = useProfileActions();
  const [archived, setArchived] = createSignal(false);
  const [checking, setChecking] = createSignal(Boolean(props.checkOpen));
  const [pending, setPending] = createSignal<PendingAction | null>(null);
  const base = () => profilesBase(company().issuePrefix);
  const all = () => profiles.data?.profiles ?? [];
  const shown = createMemo(() => all().filter((profile) => (archived() ? profile.status === "archived" : profile.status !== "archived")));
  const own = createMemo(() => shown().filter((profile) => !isAppProfile(profile)));
  const apps = createMemo(() => shown().filter(isAppProfile));
  const href = (profile: ToolProfileWithDetails) => (profile.status === "draft" ? `${base()}/${profile.id}/edit` : `${base()}/${profile.id}`);

  const row = (profile: ToolProfileWithDetails) => {
    const assigned = assignedLabel(profile.summary);
    return (
      <li class="ap-row">
        <div class="ap-row-main">
          <A class="ap-row-name" href={href(profile)}>
            {profile.name}
          </A>
          <span class="ap-row-meta">
            {allowsLabel(profile.summary)} · {assigned.text}
            {assigned.unassigned ? " (changes nobody's access)" : ""} · updated {shortDate(profile.updatedAt)}
          </span>
        </div>
        <span class="tl-row-side">
          <Show when={(profile.newToolsPendingCount ?? 0) > 0}>
            <StatePill tone="amber">{profile.newToolsPendingCount} new</StatePill>
          </Show>
          <StatePill tone={profile.status === "active" ? "green" : profile.status === "draft" ? "amber" : null}>{STATUS_LABEL[profile.status]}</StatePill>
          <Menu placement="bottom-end">
            <Menu.Trigger class="btn btn--icon btn--compact" aria-label={`Actions for ${profile.name}`}>
              <MoreHorizontal size={16} aria-hidden="true" />
            </Menu.Trigger>
            <Menu.Content label={`Actions for ${profile.name}`} width={220}>
              <Menu.Item onSelect={() => navigate(`${base()}/${profile.id}/edit`)}>{profile.status === "draft" ? "Resume" : "Edit"}</Menu.Item>
              <Menu.Item onSelect={() => actions.duplicate.mutate({ profile })}>Duplicate</Menu.Item>
              <Show
                when={profile.status === "archived"}
                fallback={<Menu.Item onSelect={() => actions.update.mutate({ profile, status: "archived" })}>Archive</Menu.Item>}
              >
                <Menu.Item onSelect={() => setPending({ kind: "restore", profile })}>Restore</Menu.Item>
              </Show>
              <Menu.Item danger onSelect={() => setPending({ kind: "delete", profile })}>
                Delete
              </Menu.Item>
            </Menu.Content>
          </Menu>
        </span>
      </li>
    );
  };

  return (
    <>
      <section class="card ap-card" aria-labelledby="pr-list">
        <header class="chead ap-chead">
          <div>
            <h3 id="pr-list" class="disp">
              Access profiles
            </h3>
            <p>Which tools your agents can use. Build a profile once, then assign it to the agents, projects or recurring tasks that need it.</p>
          </div>
          <span class="ap-actions-end">
            <Button size="compact" icon={<ShieldCheck size={14} aria-hidden="true" />} onClick={() => setChecking(true)}>
              Check an agent's access
            </Button>
            <A class="btn btn--primary btn--compact" href={`${base()}/new`}>
              <Plus size={14} aria-hidden="true" />
              New profile
            </A>
          </span>
        </header>
        <div class="ap-filters">
          <div class="ap-chips" role="group" aria-label="Show">
            <button type="button" class="ap-chip" aria-pressed={!archived()} onClick={() => setArchived(false)}>
              Active
            </button>
            <button type="button" class="ap-chip" aria-pressed={archived()} onClick={() => setArchived(true)}>
              Archived
            </button>
          </div>
        </div>
        <Switch>
          <Match when={!profiles.isSuccess}>
            <CardState loading={profiles.isPending} error={profiles.error} what="profiles" onRetry={() => void profiles.refetch()} />
          </Match>
          <Match when={shown().length === 0 && archived()}>
            <p class="ap-empty">No archived profiles.</p>
          </Match>
          <Match when={own().length === 0 && !archived()}>
            <div class="tl-form">
              <p class="cx-note">No access profiles yet. Pick a starting point; you choose the exact tools next.</p>
              <ul class="tl-choices">
                <For each={TEMPLATES}>
                  {(template) => (
                    <li>
                      <A class="tl-choice" href={`${base()}/new?template=${template.key}`}>
                        <b>{template.title}</b>
                        {template.description}
                      </A>
                    </li>
                  )}
                </For>
              </ul>
            </div>
          </Match>
          <Match when={true}>
            <ul class="ap-rows">
              <For each={own()}>{row}</For>
            </ul>
          </Match>
        </Switch>
        <Show when={profiles.isSuccess && apps().length > 0}>
          <div class="ap-group">
            <h4 class="ap-group-title">
              Made by an app's setup<span>Change these from the app's page</span>
            </h4>
            <ul class="ap-rows">
              <For each={apps()}>
                {(profile) => (
                  <li class="ap-row">
                    <div class="ap-row-main">
                      <A class="ap-row-name" href={`${base()}/${profile.id}`}>
                        {profile.name}
                      </A>
                      <span class="ap-row-meta">
                        {allowsLabel(profile.summary)} · {assignedLabel(profile.summary).text}
                      </span>
                    </div>
                    <A class="tl-rowlink" href={`/${company().issuePrefix}/apps/${profile.profileKey.slice("app:".length)}/permissions`}>
                      Open the app
                    </A>
                  </li>
                )}
              </For>
            </ul>
          </div>
        </Show>
      </section>

      <CheckAccessDialog open={checking()} onOpenChange={setChecking} />
      <ProfileActionDialog action={pending()} onClose={() => setPending(null)} actions={actions} />
    </>
  );
}

export type PendingAction = { kind: "archive" | "restore" | "delete"; profile: ToolProfileWithDetails };

/** Archive, restore or delete a profile, after saying what it changes. The organization default can't be deleted. */
export function ProfileActionDialog(props: { action: PendingAction | null; onClose: () => void; actions: ReturnType<typeof useProfileActions>; onDone?: (kind: PendingAction["kind"]) => void }) {
  const blocker = () => (props.action?.kind === "delete" ? deleteBlocker(props.action.profile) : null);
  const blocked = () => blocker() !== null;
  const copy = () => {
    const action = props.action;
    if (!action) return { title: "", body: "", confirm: "" };
    const { summary } = action.profile;
    if (action.kind === "archive") {
      return {
        title: "Archive this profile?",
        body: `It stops applying to ${summary.appliesToAgentCount === 1 ? "1 agent" : `${summary.appliesToAgentCount} agents`}. You can restore it later.`,
        confirm: "Archive",
      };
    }
    if (action.kind === "restore") return { title: "Restore this profile?", body: "It's active again and can be assigned.", confirm: "Restore" };
    return {
      title: "Delete this profile?",
      body:
        blocker() === "default"
          ? "It's the organization default. Make another profile the default first, then delete this one."
          : blocker() === "gateway"
            ? "A gateway uses it, and gateways keep their profile even once archived, so it can't be deleted. Archive it instead."
            : `This deletes it for good and removes its ${summary.assignmentCount === 1 ? "1 assignment" : `${summary.assignmentCount} assignments`}.`,
      confirm: "Delete",
    };
  };
  const run = async () => {
    const action = props.action!;
    if (action.kind === "delete") await props.actions.remove.mutateAsync(action.profile);
    else await props.actions.update.mutateAsync({ profile: action.profile, status: action.kind === "archive" ? "archived" : "active" });
    props.onDone?.(action.kind);
  };
  return (
    <Dialog
      open={props.action !== null}
      onOpenChange={(open) => !open && props.onClose()}
      title={copy().title}
      width={460}
      hideClose
      footer={
        <>
          <Button variant="quiet" onClick={() => props.onClose()}>
            Cancel
          </Button>
          <Button
            variant={props.action?.kind === "delete" ? "danger" : "primary"}
            disabled={blocked() || props.actions.remove.isPending || props.actions.update.isPending}
            onClick={() => void run().then(() => props.onClose(), () => undefined)}
          >
            {copy().confirm}
          </Button>
        </>
      }
    >
      <p class="confirm-body">{copy().body}</p>
    </Dialog>
  );
}

/** Which tools one agent can use right now, and which profiles allow them. */
export function CheckAccessDialog(props: { open: boolean; onOpenChange: (open: boolean) => void; agentId?: string }) {
  const company = useCompany();
  const agents = useAgentsQuery();
  const [picked, setPicked] = createSignal("");
  const agentId = () => picked() || props.agentId || "";
  const effective = createQuery(() => ({
    queryKey: queryKeys.tools.effective(company().id, agentId()),
    queryFn: ({ signal }) => toolAccessApi.effectiveForAgent(company().id, agentId(), signal),
    enabled: props.open && Boolean(agentId()),
  }));
  const names = () => effective.data?.allowedToolNames ?? [];
  return (
    <Dialog open={props.open} onOpenChange={props.onOpenChange} title="Check an agent's access" description="What one agent can use right now, and which profiles allow it." width={620}>
      <div class="tl-stack">
        <Field label="Agent" for="pr-check-agent">
          <select id="pr-check-agent" class="tl-select" value={agentId()} onChange={(event) => setPicked(event.currentTarget.value)}>
            <option value="" disabled>
              Pick an agent
            </option>
            <For each={activeAgents(agents.data)}>
              {(agent) => (
                <option value={agent.id} selected={agent.id === agentId()}>
                  {agent.name}
                </option>
              )}
            </For>
          </select>
        </Field>
        <Show when={agentId()} fallback={<p class="cx-note">Pick an agent to see what it can use.</p>}>
          <Show when={effective.isSuccess} fallback={<CardState loading={effective.isPending} error={effective.error} what="its access" onRetry={() => void effective.refetch()} />}>
            <div>
              <h4 class="field-label">Can use · {names().length === 1 ? "1 tool" : `${names().length} tools`}</h4>
              <Show when={names().length > 0} fallback={<p class="cx-note">It can't use any app tools right now.</p>}>
                <div class="tl-chips">
                  <For each={names().slice(0, 80)}>{(name) => <span class="tl-chip mono">{name}</span>}</For>
                  <Show when={names().length > 80}>
                    <span class="tl-chip">+{names().length - 80} more</span>
                  </Show>
                </div>
              </Show>
            </div>
            <div>
              <h4 class="field-label">Access profiles</h4>
              <Show when={(effective.data?.profiles.length ?? 0) > 0} fallback={<p class="cx-note">No active profile applies to this agent.</p>}>
                <ul class="tl-list">
                  <For each={effective.data?.profiles}>
                    {(profile) => (
                      <li class="ap-inline">
                        <A class="ap-row-name" href={`${profilesBase(company().issuePrefix)}/${profile.id}`} onClick={() => props.onOpenChange(false)}>
                          {profile.name}
                        </A>
                        <Show when={profile.summary.isCompanyDefault}>
                          <StatePill tone={null}>Organization default</StatePill>
                        </Show>
                      </li>
                    )}
                  </For>
                </ul>
              </Show>
            </div>
          </Show>
        </Show>
      </div>
    </Dialog>
  );
}
