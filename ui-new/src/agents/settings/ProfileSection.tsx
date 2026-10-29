import type { AgentDetail } from "@paperclipai/shared";
import { createQuery, useQueryClient } from "@tanstack/solid-query";
import { Check, ChevronDown } from "lucide-solid";
import { createEffect, createMemo, createSignal, on, Show } from "solid-js";
import { agentsApi } from "@/api/agents";
import { queryKeys } from "@/api/queryKeys";
import { resourceMembershipsApi } from "@/api/resource-memberships";
import { useCompany } from "@/lib/company";
import { useAgentsQuery } from "@/lib/company-data";
import { AgentAvatar } from "@/ui/Avatar";
import { Button } from "@/ui/Button";
import { SettingsCard, SettingsRow, TextArea, TextInput } from "@/ui/Field";
import { Popover } from "@/ui/Popover";
import { pushToast } from "@/ui/Toast";
import { managerCandidates, roleLabel, textEdit } from "../agent-model";
import { BuiltInCard } from "./BuiltInCard";
import { ManagerMenu, PaletteGrid, paletteAppearance, RoleMenu } from "./fields";
import { IdentityCard } from "./IdentityCard";
import { CardNote, dateTime, failure, refreshAgent, SectionTitle, shortDate, SwitchRow, useAgentSaver } from "../shared";

/*
 * Profile (board 30's outline): who the agent is, where it sits in the org, what's personal to you,
 * and its lifecycle. Changes save as you make them: text when the field loses focus, picks at once.
 * The avatar picks one of the ClipLab palettes (`appearance`); an uploaded image isn't offered yet.
 */

export function ProfileSection(props: { agent: AgentDetail; base: string }) {
  const saver = useAgentSaver(() => props.agent);
  const agents = useAgentsQuery();
  const [name, setName] = createSignal(props.agent.name);
  const [title, setTitle] = createSignal(props.agent.title ?? "");
  const [about, setAbout] = createSignal(props.agent.capabilities ?? "");
  const [avatarOpen, setAvatarOpen] = createSignal(false);
  createEffect(on(() => props.agent.name, (value) => setName(value), { defer: true }));
  createEffect(on(() => props.agent.title, (value) => setTitle(value ?? ""), { defer: true }));
  createEffect(on(() => props.agent.capabilities, (value) => setAbout(value ?? ""), { defer: true }));

  const candidates = createMemo(() => managerCandidates(agents.data ?? [], props.agent.id));
  const manager = () => (agents.data ?? []).find((agent) => agent.id === props.agent.reportsTo);
  const paletteId = () => props.agent.appearance?.paletteId;

  const saveName = async () => {
    const patch = textEdit("name", props.agent.name, name());
    if (!patch) return setName(props.agent.name);
    if (await saver.save(patch)) pushToast({ tone: "success", title: `Renamed to ${patch.name as string}` });
  };

  return (
    <>
      <SectionTitle title="Profile">Who {props.agent.name} is, where it sits in the organization, and its lifecycle.</SectionTitle>
      <BuiltInCard agent={props.agent} />
      <SettingsCard
        title="Identity"
        description={
          <CardNote state={saver.state()} error={saver.error()}>
            Changes save as you make them.
          </CardNote>
        }
        footer={<span class="ps-meta">Hired {shortDate(props.agent.createdAt)} · Updated {shortDate(props.agent.updatedAt)}</span>}
      >
        <SettingsRow label="Avatar" help="One of the ClipLab palettes.">
          <Popover open={avatarOpen()} onOpenChange={setAvatarOpen}>
            <Popover.Trigger class="ag-avatar-button" aria-label="Change the avatar">
              <AgentAvatar agent={props.agent} size={48} ring={false} />
              <span class="np-tile-caret" aria-hidden="true">
                <ChevronDown size={12} />
              </span>
            </Popover.Trigger>
            <Popover.Content title="Avatar" width={360}>
              <PaletteGrid agent={props.agent} value={paletteId()} onPick={(palette) => void saver.save({ appearance: paletteAppearance(palette) })} />
            </Popover.Content>
          </Popover>
        </SettingsRow>
        <SettingsRow label="Name" for="ag-name">
          <TextInput
            id="ag-name"
            value={name()}
            autocomplete="off"
            onInput={(event) => setName(event.currentTarget.value)}
            onBlur={() => void saveName()}
            onKeyDown={(event) => {
              if (event.key === "Enter") event.currentTarget.blur();
              if (event.key === "Escape") {
                setName(props.agent.name);
                event.currentTarget.blur();
              }
            }}
          />
        </SettingsRow>
        <SettingsRow label="Role">
          <RoleMenu value={props.agent.role} onChange={(role) => void saver.save({ role })} />
        </SettingsRow>
        <SettingsRow label="Title" help="Shown in place of the role, such as “Quant Researcher”." for="ag-title">
          <TextInput
            id="ag-title"
            value={title()}
            placeholder={roleLabel(props.agent.role)}
            autocomplete="off"
            onInput={(event) => setTitle(event.currentTarget.value)}
            onBlur={() => void saver.save(textEdit("title", props.agent.title, title()))}
            onKeyDown={(event) => event.key === "Enter" && event.currentTarget.blur()}
          />
        </SettingsRow>
        <SettingsRow label="What they do" help="Other agents read this when they decide what to hand over." for="ag-about">
          <TextArea
            id="ag-about"
            rows={4}
            value={about()}
            placeholder={`What ${props.agent.name} is good at.`}
            onInput={(event) => setAbout(event.currentTarget.value)}
            onBlur={() => void saver.save(textEdit("capabilities", props.agent.capabilities, about()))}
          />
        </SettingsRow>
        <SettingsRow label="Reports to" help="Its manager in the org chart.">
          <ManagerMenu
            candidates={candidates()}
            manager={manager()}
            value={props.agent.reportsTo}
            onChange={(reportsTo) => void saver.save({ reportsTo })}
          />
          <Show when={props.agent.orgChainHealth && props.agent.orgChainHealth.status !== "healthy"}>
            <p class="fhelp ag-warn">{props.agent.orgChainHealth?.repairGuidance ?? "Its chain of command needs attention."}</p>
          </Show>
        </SettingsRow>
      </SettingsCard>

      <ForYouCard agent={props.agent} />
      <IdentityCard agent={props.agent} />
      <LifecycleCard agent={props.agent} />
    </>
  );
}

/** Personal: your primary agent, and whether this agent shows in your sidebar. */
function ForYouCard(props: { agent: AgentDetail }) {
  const company = useCompany();
  const client = useQueryClient();
  const [busy, setBusy] = createSignal(false);
  const primary = createQuery(() => ({
    queryKey: queryKeys.agents.primary(company().id),
    queryFn: ({ signal }) => agentsApi.primaryAgent(company().id, signal),
    retry: false,
  }));
  const memberships = createQuery(() => ({
    queryKey: queryKeys.projectSettings.memberships(company().id),
    queryFn: ({ signal }) => resourceMembershipsApi.mine(company().id, signal),
    retry: false,
  }));
  const joined = () => memberships.data?.agentMemberships?.[props.agent.id] !== "left";
  const isPrimary = () => primary.data?.primaryAgentId === props.agent.id;

  const run = async (work: () => Promise<unknown>, keys: readonly unknown[][], fallback: string) => {
    setBusy(true);
    try {
      await work();
      await Promise.all(keys.map((queryKey) => client.invalidateQueries({ queryKey })));
    } catch (caught) {
      pushToast({ tone: "error", title: fallback, body: failure(caught, "") || undefined });
    } finally {
      setBusy(false);
    }
  };

  return (
    <SettingsCard title="For you" description="Only you see these.">
      <SettingsRow label="Primary agent" help="The default for your new tasks and chat.">
        <Show
          when={!isPrimary()}
          fallback={
            <span class="ps-inline ag-ok">
              <Check size={14} aria-hidden="true" /> {props.agent.name} is your primary agent
            </span>
          }
        >
          <Button
            size="compact"
            disabled={busy() || props.agent.status === "terminated"}
            onClick={() => void run(() => agentsApi.setPrimaryAgent(company().id, props.agent.id), [[...queryKeys.agents.primary(company().id)]], "Couldn't change your primary agent")}
          >
            Make it my primary agent
          </Button>
        </Show>
      </SettingsRow>
      <SwitchRow
        label="Show in my sidebar"
        help="Turning it off only hides it from your sidebar; nobody else is affected."
        checked={joined()}
        disabled={busy() || !memberships.isSuccess}
        onChange={(checked) =>
          void run(
            () => agentsApi.updateMembership(company().id, props.agent.id, { state: checked ? "joined" : "left" }),
            [[...queryKeys.projectSettings.memberships(company().id)]],
            "Couldn't change your sidebar",
          )
        }
      />
    </SettingsCard>
  );
}

/** State, the last heartbeat, and the lifecycle actions the header's menu also has. */
function LifecycleCard(props: { agent: AgentDetail }) {
  const company = useCompany();
  const client = useQueryClient();
  const [busy, setBusy] = createSignal(false);
  const act = async (work: () => Promise<unknown>, done: string, fallback: string) => {
    setBusy(true);
    try {
      await work();
      await refreshAgent(client, company().id, props.agent.id);
      pushToast({ tone: "success", title: done });
    } catch (caught) {
      pushToast({ tone: "error", title: fallback, body: failure(caught, "") || undefined });
    } finally {
      setBusy(false);
    }
  };
  const paused = () => props.agent.status === "paused";
  const stateText = () =>
    ({
      active: "Active",
      idle: "Idle",
      running: "Running",
      paused: props.agent.pauseReason === "budget" ? "Paused: it reached its budget" : "Paused",
      error: "Error",
      pending_approval: "Waiting for approval",
      terminated: "Retired",
    })[props.agent.status] ?? props.agent.status;

  return (
    <SettingsCard title="Lifecycle" description="Pause or resume it, clear an error, or reset its sessions. Retire it from the header's menu.">
      <SettingsRow label="State">
        <div class="ps-stack">
          <span>{stateText()}</span>
          <Show when={props.agent.errorReason}>
            <span class="fhelp ag-warn">{props.agent.errorReason}</span>
          </Show>
          <Show when={props.agent.lifecycleError}>
            <span class="fhelp ag-warn">Setup: {props.agent.lifecycleError}</span>
          </Show>
          <span class="fhelp">{props.agent.lastHeartbeatAt ? `Last checked in ${dateTime(props.agent.lastHeartbeatAt)}` : "Hasn't run yet"}</span>
        </div>
      </SettingsRow>
      <SettingsRow label="Actions">
        <div class="ps-inline">
          <Show when={props.agent.status !== "terminated" && props.agent.status !== "pending_approval"}>
            <Button
              size="compact"
              disabled={busy()}
              onClick={() =>
                void (paused()
                  ? act(() => agentsApi.resume(props.agent.id, company().id), `Resumed ${props.agent.name}`, "Couldn't resume the agent")
                  : act(() => agentsApi.pause(props.agent.id, company().id), `Paused ${props.agent.name}`, "Couldn't pause the agent"))
              }
            >
              {paused() ? "Resume" : "Pause"}
            </Button>
          </Show>
          <Show when={props.agent.status === "error"}>
            <Button size="compact" disabled={busy()} onClick={() => void act(() => agentsApi.clearError(props.agent.id, company().id), "Cleared the error", "Couldn't clear the error")}>
              Clear error
            </Button>
          </Show>
          <Show when={props.agent.status === "pending_approval"}>
            <Button size="compact" variant="primary" disabled={busy()} onClick={() => void act(() => agentsApi.approve(props.agent.id, company().id), `Approved ${props.agent.name}`, "Couldn't approve the agent")}>
              Approve hire
            </Button>
          </Show>
          <Button size="compact" disabled={busy()} onClick={() => void act(() => agentsApi.resetSession(props.agent.id, null, company().id), "Reset every session", "Couldn't reset the sessions")}>
            Reset all sessions
          </Button>
        </div>
      </SettingsRow>
    </SettingsCard>
  );
}
