import type { ToolProfileBinding, ToolProfileDefaultAction, ToolProfileNewToolReviewDecision, ToolProfileWithDetails } from "@paperclipai/shared";
import { A, useNavigate } from "@solidjs/router";
import { createMutation, createQuery } from "@tanstack/solid-query";
import { Copy, Pencil, ShieldCheck, Trash2 } from "lucide-solid";
import { createEffect, createMemo, createSignal, For, Match, on, Show, Switch } from "solid-js";
import { createStore } from "solid-js/store";
import { queryKeys } from "@/api/queryKeys";
import { toolAccessApi } from "@/api/tool-access";
import { shortDate } from "@/agents/shared";
import { ConfirmDialog } from "@/documents/ConfirmDialog";
import { useCompany } from "@/lib/company";
import { Button, buttonClass } from "@/ui/Button";
import { Dialog } from "@/ui/Dialog";
import { Field, TextArea, TextInput } from "@/ui/Field";
import { PageHeader } from "@/ui/PageHeader";
import { pushToast } from "@/ui/Toast";
import { failureText, useRefreshTools } from "../shared";
import { CardState, RowLink, StatePill } from "./parts";
import {
  allowRows,
  allowsLabel,
  assignmentKind,
  assignmentLabel,
  isAppProfile,
  newToolsAppLabel,
  profileKeyFrom,
  STATUS_LABEL,
} from "./profile-model";
import { CheckAccessDialog, ProfileActionDialog, profilesBase, useProfileActions, type PendingAction } from "./Profiles";
import { useCompanyCatalog, useProfiles, useTargetNames } from "./queries";

/*
 * One access profile (`/apps/advanced/profiles/:id`, the old UI's ProfileDetail): what it allows,
 * tool by tool and why; who has it; whether tools an app adds later are allowed; and the new tools
 * waiting for review. Editing its tools or assignments opens the wizard at that step.
 * `?created=1` greets a profile the wizard just saved; `?review=new-tools` opens the review.
 */

const SHOWN = 80;

export function ProfileDetail(props: { profileId: string; created: boolean; review: boolean }) {
  const company = useCompany();
  const navigate = useNavigate();
  const refresh = useRefreshTools();
  const profiles = useProfiles();
  const catalog = useCompanyCatalog();
  const targets = useTargetNames();
  const actions = useProfileActions();
  const [editing, setEditing] = createSignal(false);
  const [copying, setCopying] = createSignal(false);
  const [checking, setChecking] = createSignal(false);
  const [pending, setPending] = createSignal<PendingAction | null>(null);
  const [removing, setRemoving] = createSignal<ToolProfileBinding | null>(null);
  const [reviewing, setReviewing] = createSignal(props.review);
  const [greeting, setGreeting] = createSignal(props.created);
  const base = () => profilesBase(company().issuePrefix);
  const profile = createMemo(() => profiles.data?.profiles.find((entry) => entry.id === props.profileId) ?? null);

  const update = createMutation(() => ({
    mutationFn: (input: Parameters<typeof toolAccessApi.updateProfile>[1]) => toolAccessApi.updateProfile(props.profileId, input),
    onSuccess: () => pushToast({ title: "Profile saved", tone: "success" }),
    onError: (error) => pushToast({ title: "Couldn't save the profile", body: failureText(error, "Please try again."), tone: "error" }),
    onSettled: () => refresh(),
  }));
  const unbind = createMutation(() => ({
    mutationFn: (binding: ToolProfileBinding) => toolAccessApi.unbindProfile(company().id, props.profileId, { targetType: binding.targetType, targetId: binding.targetId }),
    onSuccess: () => pushToast({ title: "Assignment removed", tone: "success" }),
    onError: (error) => pushToast({ title: "Couldn't remove the assignment", body: failureText(error, "Please try again."), tone: "error" }),
    onSettled: () => refresh(),
  }));

  return (
    <Switch>
      <Match when={!profiles.isSuccess}>
        <section class="card">
          <CardState loading={profiles.isPending} error={profiles.error} what="the profile" onRetry={() => void profiles.refetch()} />
        </section>
      </Match>
      <Match when={!profile()}>
        <section class="card ap-later">
          <h2 class="disp">Profile not found</h2>
          <p>
            It may have been deleted. <A href={base()}>Back to access profiles</A>
          </p>
        </section>
      </Match>
      <Match when={profile()}>
        {(current) => {
          const archived = () => current().status === "archived";
          const rows = createMemo(() => allowRows(current(), catalog.catalog(), catalog.applicationNames(), catalog.live()));
          const appConnection = () => (isAppProfile(current()) ? current().profileKey.slice("app:".length) : null);
          return (
            <>
              <PageHeader
                size="compact"
                crumbs={
                  <>
                    <A href={`/${company().issuePrefix}/apps/advanced`}>Advanced</A>
                    <span aria-hidden="true">/</span>
                    <A href={base()}>Access profiles</A>
                  </>
                }
                title={current().name}
                numbers={
                  <>
                    <StatePill tone={current().status === "active" ? "green" : current().status === "draft" ? "amber" : null}>{STATUS_LABEL[current().status]}</StatePill>
                    <span>{allowsLabel(current().summary)}</span>
                    <span>Updated {shortDate(current().updatedAt)}</span>
                  </>
                }
                actions={
                  <>
                    <Button size="compact" icon={<Pencil size={14} aria-hidden="true" />} disabled={archived()} onClick={() => setEditing(true)}>
                      Edit
                    </Button>
                    <Button size="compact" icon={<Copy size={14} aria-hidden="true" />} disabled={archived()} onClick={() => setCopying(true)}>
                      Duplicate
                    </Button>
                    <Button size="compact" onClick={() => setPending({ kind: archived() ? "restore" : "archive", profile: current() })}>
                      {archived() ? "Restore" : "Archive"}
                    </Button>
                    <Button size="compact" variant="danger" icon={<Trash2 size={14} aria-hidden="true" />} onClick={() => setPending({ kind: "delete", profile: current() })}>
                      Delete
                    </Button>
                  </>
                }
              >
                <Show when={current().description}>
                  <p class="cx-note">{current().description}</p>
                </Show>
              </PageHeader>

              <Show when={appConnection()}>
                {(id) => (
                  <p class="card cx-note ap-flash">
                    An app's setup made this profile. Change its actions and who uses it from <A href={`/${company().issuePrefix}/apps/${id()}/permissions`}>the app's page</A>.
                  </p>
                )}
              </Show>
              <Show when={greeting()}>
                <div class="card ap-flash ap-inline">
                  <span style={{ flex: 1 }}>
                    <b>Profile saved.</b> {current().summary.assignmentCount === 0 ? "Assign it before it changes anyone's access." : "Its assignments apply now."}
                  </span>
                  <A class={buttonClass({ size: "compact", variant: "primary" })} href={`${base()}/${current().id}/edit?step=3`}>
                    Assign
                  </A>
                  <Button size="compact" variant="quiet" onClick={() => setGreeting(false)}>
                    Dismiss
                  </Button>
                </div>
              </Show>
              <Show when={archived()}>
                <p class="card cx-note cx-note--warn ap-flash">This profile is archived: it doesn't apply to anyone until it's restored.</p>
              </Show>
              <Show when={(current().newToolsPendingCount ?? 0) > 0}>
                <NewToolsBanner profile={current()} onReview={() => setReviewing(true)} />
              </Show>

              <section class="card ap-card" aria-labelledby="pd-allows">
                <header class="chead ap-chead">
                  <div>
                    <h3 id="pd-allows" class="disp">
                      What it allows
                    </h3>
                    <p>{rows().length === 0 ? "" : `${rows().length} of the ${current().summary.totalToolCount} tools Paperclip knows.`}</p>
                  </div>
                  <Show when={!archived()}>
                    <A class={buttonClass({ size: "compact" })} href={`${base()}/${current().id}/edit?step=2`}>
                      Edit tools
                    </A>
                  </Show>
                </header>
                <Show when={!catalog.loading()} fallback={<p class="ap-empty">Loading tools…</p>}>
                  <ul class="ap-rows">
                    <For
                      each={rows().slice(0, SHOWN)}
                      fallback={<li class="ap-empty">It allows no tools: agents with only this profile can't use any app tools.</li>}
                    >
                      {(row) => (
                        <li class="ap-row">
                          <div class="ap-row-main">
                            <span class="ap-row-name">{row.tool}</span>
                            <span class="ap-row-meta">
                              {row.app} · {row.capability} · {row.source}
                              {row.autoAddedAt ? ` · added automatically ${shortDate(row.autoAddedAt)}` : ""}
                              {row.degraded ? ` · ${row.app} is disconnected` : ""}
                            </span>
                          </div>
                          <Show when={row.degraded}>
                            <A class="tl-rowlink" href={`/${company().issuePrefix}/apps/${row.connectionId}/permissions`}>
                              Reconnect
                            </A>
                          </Show>
                        </li>
                      )}
                    </For>
                  </ul>
                  <Show when={rows().length > SHOWN}>
                    <p class="ap-empty">
                      Showing {SHOWN} of {rows().length} allowed tools.
                    </p>
                  </Show>
                </Show>
              </section>

              <section class="card ap-card" aria-labelledby="pd-who">
                <header class="chead ap-chead">
                  <div>
                    <h3 id="pd-who" class="disp">
                      Who has it
                    </h3>
                    <p>An agent with several profiles can use anything any of them allows.</p>
                  </div>
                  <Show when={!archived()}>
                    <A class={buttonClass({ size: "compact" })} href={`${base()}/${current().id}/edit?step=3`}>
                      Assign
                    </A>
                  </Show>
                </header>
                <ul class="ap-rows">
                  <For each={current().bindings} fallback={<li class="ap-empty">Not assigned yet. Assign it before it changes anyone's access.</li>}>
                    {(binding) => (
                      <li class="ap-row">
                        <div class="ap-row-main">
                          <span class="ap-row-name">{assignmentLabel(binding, company().id, targets.names())}</span>
                          <span class="ap-row-meta">{assignmentKind(binding.targetType)}</span>
                        </div>
                        <Switch>
                          <Match when={binding.targetType === "gateway"}>
                            <Show when={targets.names().gateways.has(binding.targetId)}>
                              <RowLink href={`/${company().issuePrefix}/apps/gateways/${binding.targetId}/overview`}>Open the gateway</RowLink>
                            </Show>
                          </Match>
                          <Match when={true}>
                            <Button size="compact" variant="quiet" disabled={archived()} onClick={() => setRemoving(binding)}>
                              Remove
                            </Button>
                          </Match>
                        </Switch>
                      </li>
                    )}
                  </For>
                </ul>
              </section>

              <NewToolsSetting value={current().defaultAction} disabled={archived() || update.isPending} onChange={(defaultAction) => update.mutate({ defaultAction })} />

              <div>
                <Button size="compact" variant="quiet" icon={<ShieldCheck size={14} aria-hidden="true" />} onClick={() => setChecking(true)}>
                  Check what an agent can actually use
                </Button>
              </div>

              <EditDialog open={editing()} onOpenChange={setEditing} profile={current()} all={profiles.data?.profiles ?? []} onSave={(input) => update.mutateAsync(input)} />
              <DuplicateDialog
                open={copying()}
                onOpenChange={setCopying}
                profile={current()}
                all={profiles.data?.profiles ?? []}
                onSave={async (input) => {
                  const copy = await actions.duplicate.mutateAsync({ profile: current(), ...input });
                  navigate(`${base()}/${copy.id}?created=1`);
                }}
              />
              <ProfileActionDialog action={pending()} onClose={() => setPending(null)} actions={actions} onDone={(kind) => kind === "delete" && navigate(base())} />
              <ConfirmDialog
                open={removing() !== null}
                onOpenChange={(open) => !open && setRemoving(null)}
                title="Remove this assignment?"
                body={
                  removing()?.targetType === "company"
                    ? "It stops being the organization default. Agents without a profile of their own lose its tools."
                    : `${removing() ? assignmentLabel(removing()!, company().id, targets.names()) : ""} stops getting this profile's tools.`
                }
                confirmLabel="Remove"
                danger
                onConfirm={() => unbind.mutateAsync(removing()!)}
              />
              <ReviewDialog open={reviewing()} onOpenChange={setReviewing} profile={current()} />
              <CheckAccessDialog open={checking()} onOpenChange={setChecking} />
            </>
          );
        }}
      </Match>
    </Switch>
  );
}

function NewToolsSetting(props: { value: ToolProfileDefaultAction; disabled: boolean; onChange: (value: ToolProfileDefaultAction) => void }) {
  return (
    <section class="card ap-card" aria-labelledby="pd-new-tools">
      <header class="chead">
        <h3 id="pd-new-tools" class="disp">
          Tools an app adds later
        </h3>
        <p>When a connected app gains a tool, whether this profile allows it.</p>
      </header>
      <div class="ap-card-body" role="radiogroup" aria-labelledby="pd-new-tools">
        <NewToolsChoice name="pd-new-tools" value={props.value} disabled={props.disabled} onChange={props.onChange} />
      </div>
    </section>
  );
}

export function NewToolsChoice(props: { name: string; value: ToolProfileDefaultAction; disabled?: boolean; onChange: (value: ToolProfileDefaultAction) => void }) {
  const options: { value: ToolProfileDefaultAction; title: string; body: string }[] = [
    { value: "deny", title: "Stay blocked until someone allows them (recommended)", body: "New tools aren't usable until you review them." },
    { value: "allow", title: "Allowed automatically", body: "New tools become usable right away." },
  ];
  return (
    <For each={options}>
      {(option) => (
        <label class="tl-radio">
          <input type="radio" name={props.name} checked={props.value === option.value} disabled={props.disabled} onChange={() => props.onChange(option.value)} />
          <span>
            <b>{option.title}</b>
            {option.body}
          </span>
        </label>
      )}
    </For>
  );
}

function NewToolsBanner(props: { profile: ToolProfileWithDetails; onReview: () => void }) {
  const company = useCompany();
  const review = createQuery(() => ({
    queryKey: queryKeys.tools.profileNewTools(company().id, props.profile.id),
    queryFn: ({ signal }) => toolAccessApi.newTools(props.profile.id, signal),
  }));
  const count = () => props.profile.newToolsPendingCount ?? 0;
  return (
    <div class="card ap-banner">
      <span>
        <b>{review.data ? newToolsAppLabel(review.data.tools) : "Apps"}</b> added {count() === 1 ? "1 new tool" : `${count()} new tools`} since the last review. Choose which this
        profile allows.
      </span>
      <Button size="compact" variant="primary" onClick={() => props.onReview()}>
        Review
      </Button>
    </div>
  );
}

function ReviewDialog(props: { open: boolean; onOpenChange: (open: boolean) => void; profile: ToolProfileWithDetails }) {
  const company = useCompany();
  const refresh = useRefreshTools();
  const review = createQuery(() => ({
    queryKey: queryKeys.tools.profileNewTools(company().id, props.profile.id),
    queryFn: ({ signal }) => toolAccessApi.newTools(props.profile.id, signal),
    enabled: props.open,
  }));
  const [decisions, setDecisions] = createStore<Record<string, ToolProfileNewToolReviewDecision>>({});
  const tools = () => review.data?.tools ?? [];
  const submit = createMutation(() => ({
    mutationFn: () =>
      toolAccessApi.reviewNewTools(
        props.profile.id,
        tools().map((tool) => ({ catalogEntryId: tool.catalogEntryId, decision: decisions[tool.catalogEntryId] ?? "keep_blocked" })),
      ),
    onSuccess: (result) => {
      props.onOpenChange(false);
      pushToast({ title: "New tools reviewed", body: `${result.allowedCount} allowed, ${result.keptBlockedCount} kept blocked.`, tone: "success" });
    },
    onError: (error) => pushToast({ title: "Couldn't save the review", body: failureText(error, "Please try again."), tone: "error" }),
    onSettled: () => refresh(),
  }));
  return (
    <Dialog
      open={props.open}
      onOpenChange={props.onOpenChange}
      title="Review new tools"
      description="Allow the ones this profile should use; the rest stay blocked."
      width={680}
      footer={
        <>
          <Button variant="quiet" onClick={() => props.onOpenChange(false)}>
            Cancel
          </Button>
          <Button variant="primary" disabled={submit.isPending || tools().length === 0} onClick={() => submit.mutate()}>
            {submit.isPending ? "Saving…" : "Save review"}
          </Button>
        </>
      }
    >
      <Show when={review.isSuccess} fallback={<CardState loading={review.isPending} error={review.error} what="the new tools" onRetry={() => void review.refetch()} />}>
        <ul class="ap-rows">
          <For each={tools()} fallback={<li class="ap-empty">No new tools are waiting.</li>}>
            {(tool) => (
              <li class="ap-row">
                <div class="ap-row-main">
                  <span class="ap-row-name">{tool.title || tool.toolName}</span>
                  <span class="ap-row-meta">
                    {tool.applicationName ?? tool.connectionName ?? "App tool"} · {tool.riskLevel} · added {shortDate(tool.addedAt)}
                    {tool.description ? ` · ${tool.description}` : ""}
                  </span>
                </div>
                <span class="tl-row-side" role="radiogroup" aria-label={`${tool.title || tool.toolName}`}>
                  <label class="ap-check">
                    <input
                      type="radio"
                      name={`pd-review-${tool.catalogEntryId}`}
                      checked={decisions[tool.catalogEntryId] === "allow"}
                      onChange={() => setDecisions(tool.catalogEntryId, "allow")}
                    />
                    Allow
                  </label>
                  <label class="ap-check">
                    <input
                      type="radio"
                      name={`pd-review-${tool.catalogEntryId}`}
                      checked={(decisions[tool.catalogEntryId] ?? "keep_blocked") === "keep_blocked"}
                      onChange={() => setDecisions(tool.catalogEntryId, "keep_blocked")}
                    />
                    Keep blocked
                  </label>
                </span>
              </li>
            )}
          </For>
        </ul>
      </Show>
    </Dialog>
  );
}

function EditDialog(props: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  profile: ToolProfileWithDetails;
  all: ToolProfileWithDetails[];
  onSave: (input: { name: string; description: string | null; profileKey: string }) => Promise<unknown>;
}) {
  const [name, setName] = createSignal("");
  const [description, setDescription] = createSignal("");
  const [key, setKey] = createSignal("");
  const [busy, setBusy] = createSignal(false);
  createEffect(
    on(
      () => props.open,
      (open) => {
        if (!open) return;
        setName(props.profile.name);
        setDescription(props.profile.description ?? "");
        setKey(props.profile.profileKey);
      },
    ),
  );
  const taken = () => props.all.some((entry) => entry.id !== props.profile.id && entry.name.trim().toLowerCase() === name().trim().toLowerCase());
  const save = async () => {
    setBusy(true);
    try {
      await props.onSave({ name: name().trim(), description: description().trim() || null, profileKey: key().trim() || profileKeyFrom(name()) });
      props.onOpenChange(false);
    } catch {
      // The toast says why.
    } finally {
      setBusy(false);
    }
  };
  return (
    <Dialog
      open={props.open}
      onOpenChange={props.onOpenChange}
      title="Edit profile"
      width={520}
      footer={
        <>
          <Button variant="quiet" onClick={() => props.onOpenChange(false)}>
            Cancel
          </Button>
          <Button variant="primary" disabled={!name().trim() || taken() || busy()} onClick={() => void save()}>
            {busy() ? "Saving…" : "Save"}
          </Button>
        </>
      }
    >
      <div class="tl-stack">
        <Field label="Name" for="pd-name" error={taken() ? "Another profile has this name." : undefined}>
          <TextInput id="pd-name" value={name()} onInput={(event) => setName(event.currentTarget.value)} />
        </Field>
        <Field label="Description" for="pd-description">
          <TextArea id="pd-description" rows={3} value={description()} onInput={(event) => setDescription(event.currentTarget.value)} />
        </Field>
        <details class="ap-more">
          <summary>Identifier</summary>
          <div class="ap-more-body">
            <Field label="Identifier" for="pd-key" help="Used in exports and the API.">
              <TextInput id="pd-key" class="mono" value={key()} onInput={(event) => setKey(event.currentTarget.value)} />
            </Field>
          </div>
        </details>
      </div>
    </Dialog>
  );
}

function DuplicateDialog(props: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  profile: ToolProfileWithDetails;
  all: ToolProfileWithDetails[];
  onSave: (input: { name: string; includeAssignments: boolean }) => Promise<unknown>;
}) {
  const [name, setName] = createSignal("");
  const [assignments, setAssignments] = createSignal(false);
  const [busy, setBusy] = createSignal(false);
  createEffect(
    on(
      () => props.open,
      (open) => {
        if (!open) return;
        setName(`${props.profile.name} (copy)`);
        setAssignments(false);
      },
    ),
  );
  const taken = () => props.all.some((entry) => entry.name.trim().toLowerCase() === name().trim().toLowerCase());
  const save = async () => {
    setBusy(true);
    try {
      await props.onSave({ name: name().trim(), includeAssignments: assignments() });
      props.onOpenChange(false);
    } catch {
      // The toast says why.
    } finally {
      setBusy(false);
    }
  };
  return (
    <Dialog
      open={props.open}
      onOpenChange={props.onOpenChange}
      title="Duplicate profile"
      width={480}
      footer={
        <>
          <Button variant="quiet" onClick={() => props.onOpenChange(false)}>
            Cancel
          </Button>
          <Button variant="primary" disabled={!name().trim() || taken() || busy()} onClick={() => void save()}>
            {busy() ? "Duplicating…" : "Duplicate"}
          </Button>
        </>
      }
    >
      <div class="tl-stack">
        <Field label="Name" for="pd-copy-name" error={taken() ? "Another profile has this name." : undefined}>
          <TextInput id="pd-copy-name" value={name()} onInput={(event) => setName(event.currentTarget.value)} />
        </Field>
        <label class="ap-check">
          <input type="checkbox" checked={assignments()} onChange={(event) => setAssignments(event.currentTarget.checked)} />
          Copy its assignments too
        </label>
      </div>
    </Dialog>
  );
}
