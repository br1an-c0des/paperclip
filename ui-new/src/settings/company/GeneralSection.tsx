import { A, useNavigate } from "@solidjs/router";
import { useQueryClient } from "@tanstack/solid-query";
import { Archive, Check, ImageUp, PauseCircle, PlayCircle, Trash2 } from "lucide-solid";
import { createEffect, createMemo, createSignal, For, on, Show } from "solid-js";
import { companiesApi } from "@/api/companies";
import { personName } from "@/api/access";
import { queryKeys } from "@/api/queryKeys";
import { ConfirmDialog } from "@/documents/ConfirmDialog";
import { useCompany } from "@/lib/company";
import { useAgentsQuery, usePeopleQuery } from "@/lib/company-data";
import { InitialsDisc } from "@/ui/Avatar";
import { Button } from "@/ui/Button";
import { FieldButton, SettingsCard, SettingsRow, TextArea, TextInput } from "@/ui/Field";
import { Menu } from "@/ui/Menu";
import { pushToast } from "@/ui/Toast";
import {
  AUDIENCES,
  audienceLabel,
  descriptionEdit,
  kindAudience,
  nameEdit,
  REQUEST_KINDS,
  setKindAudience,
  startsNarrower,
  type Audience,
  type GovernanceKind,
} from "./general-model";
import { CardHead, CardNote, failure, SectionTitle, SwitchRow, useCompanySaver } from "./shared";

/*
 * General (board 21): who the organization is, and its rules for hiring and for answering agents.
 * Changes save as you make them, as the board says: text when the field loses focus, switches and
 * picks at once.
 *
 * - Organization: name, description, logo (`POST /companies/:id/logo`, then `logoAssetId`), and the
 *   default owner (board 30), who gets tasks and requests that have no owner.
 * - Hiring: require approval for new agents, with the hires waiting for it.
 * - Agent requests: who may answer each kind (`interactionResolverGovernance`).
 * - Feedback: share rated outputs with Paperclip (`feedbackDataSharingEnabled`).
 * - Danger zone: pause every agent (the company's `paused` status) and archive the organization.
 *
 * Agent observability, which the old General page carried, is Run telemetry under Connections
 * (board 23). The instance's own general settings are app settings.
 */

export function GeneralSection() {
  const company = useCompany();
  const saver = useCompanySaver();

  return (
    <>
      <SectionTitle title="General">Who the organization is, and its rules for hiring and for answering agents. Changes save as you make them.</SectionTitle>
      <OrganizationCard saver={saver} />
      <HiringCard saver={saver} />
      <RequestsCard saver={saver} />
      <SettingsCard title="Feedback">
        <SwitchRow
          label="Share rated outputs with Paperclip"
          help="When someone rates an agent's output, send that output and the rating to Paperclip to improve it. Off by default."
          checked={company().feedbackDataSharingEnabled}
          onChange={(value) => void saver.save({ feedbackDataSharingEnabled: value })}
        />
      </SettingsCard>
      <DangerCard saver={saver} />
    </>
  );
}

type Saver = ReturnType<typeof useCompanySaver>;

function OrganizationCard(props: { saver: Saver }) {
  const company = useCompany();
  const client = useQueryClient();
  const people = usePeopleQuery();
  const [name, setName] = createSignal(company().name);
  const [description, setDescription] = createSignal(company().description ?? "");
  const [uploading, setUploading] = createSignal(false);
  let fileInput!: HTMLInputElement;
  createEffect(on(() => company().name, (value) => setName(value), { defer: true }));
  createEffect(on(() => company().description, (value) => setDescription(value ?? ""), { defer: true }));

  const owners = createMemo(() => (people.data?.users ?? []).filter((user) => user.status === "active"));
  const owner = () => owners().find((user) => user.principalId === company().defaultResponsibleUserId);

  const saveName = () => {
    const patch = nameEdit(company(), name());
    if (!patch) return setName(company().name);
    void props.saver.save(patch);
  };

  const uploadLogo = async (file: File) => {
    setUploading(true);
    try {
      const asset = await companiesApi.uploadLogo(company().id, file);
      await companiesApi.update(company().id, { logoAssetId: asset.assetId });
      await client.invalidateQueries({ queryKey: queryKeys.companies.all });
      pushToast({ tone: "success", title: "Updated the logo" });
    } catch (caught) {
      pushToast({ tone: "error", title: "Couldn't upload the logo", body: failure(caught, "") || undefined });
    } finally {
      setUploading(false);
    }
  };

  return (
    <SettingsCard
      title="Organization"
      description={
        <CardNote state={props.saver.state()} error={props.saver.error()}>
          {null}
        </CardNote>
      }
    >
      <SettingsRow label="Name" for="cs-name" help="Shown in the sidebar, on invites and in agents' instructions.">
        <TextInput
          id="cs-name"
          value={name()}
          autocomplete="off"
          onInput={(event) => setName(event.currentTarget.value)}
          onBlur={saveName}
          onKeyDown={(event) => {
            if (event.key === "Enter") event.currentTarget.blur();
            if (event.key === "Escape") {
              setName(company().name);
              event.currentTarget.blur();
            }
          }}
        />
      </SettingsRow>
      <SettingsRow label="Description" for="cs-description" help="Optional. Shown on the organization's profile.">
        <TextArea
          id="cs-description"
          rows={3}
          value={description()}
          placeholder="What this organization does"
          onInput={(event) => setDescription(event.currentTarget.value)}
          onBlur={() => void props.saver.save(descriptionEdit(company(), description()))}
        />
      </SettingsRow>
      <SettingsRow label="Logo" help="Square, at least 128 px. PNG, JPEG, WEBP, GIF or SVG.">
        <div class="cs-logo-row">
          <Show when={company().logoUrl} fallback={<InitialsDisc name={company().name.slice(0, 1)} seed={company().id} size={44} />}>
            {(url) => <img class="cs-logo" src={url()} alt="" width={44} height={44} />}
          </Show>
          <input
            ref={fileInput}
            type="file"
            class="sr-only"
            accept="image/png,image/jpeg,image/webp,image/gif,image/svg+xml"
            aria-label="Logo image"
            onChange={(event) => {
              const file = event.currentTarget.files?.[0];
              event.currentTarget.value = "";
              if (file) void uploadLogo(file);
            }}
          />
          <Button size="compact" icon={<ImageUp size={14} aria-hidden="true" />} disabled={uploading()} onClick={() => fileInput.click()}>
            {uploading() ? "Uploading…" : company().logoUrl ? "Replace" : "Upload"}
          </Button>
          <Show when={company().logoUrl}>
            <Button size="compact" variant="quiet" icon={<Trash2 size={14} aria-hidden="true" />} onClick={() => void props.saver.save({ logoAssetId: null })}>
              Remove
            </Button>
          </Show>
        </div>
      </SettingsRow>
      <SettingsRow label="Default owner" help="The person who gets tasks and requests that have no owner.">
        <Menu>
          <Menu.Trigger as={FieldButton} class="ps-field-320" aria-label={`Default owner: ${owner() ? personName(owner()!) : "nobody"}`}>
            {owner() ? personName(owner()!) : company().defaultResponsibleUserId ? "Someone who isn't a member now" : "Nobody"}
          </Menu.Trigger>
          <Menu.Content label="Default owner" width={300}>
            <For each={owners()} fallback={<p class="nt-menu-note">No people to choose from.</p>}>
              {(user) => (
                <Menu.Item
                  onSelect={() => user.principalId !== company().defaultResponsibleUserId && void props.saver.save({ defaultResponsibleUserId: user.principalId })}
                  icon={<InitialsDisc name={personName(user)} seed={user.principalId} size={24} />}
                  description={user.user?.email ?? undefined}
                  hint={user.principalId === company().defaultResponsibleUserId ? <Check size={14} /> : undefined}
                >
                  {personName(user)}
                </Menu.Item>
              )}
            </For>
            <Menu.Separator />
            <Menu.Item
              onSelect={() => company().defaultResponsibleUserId && void props.saver.save({ defaultResponsibleUserId: null })}
              hint={company().defaultResponsibleUserId ? undefined : <Check size={14} />}
            >
              Nobody
            </Menu.Item>
          </Menu.Content>
        </Menu>
      </SettingsRow>
    </SettingsCard>
  );
}

function HiringCard(props: { saver: Saver }) {
  const company = useCompany();
  const agents = useAgentsQuery();
  const waiting = () => (agents.data ?? []).filter((agent) => agent.status === "pending_approval").length;
  return (
    <SettingsCard title="Hiring">
      <SwitchRow
        label="Require approval for new hires"
        help="When a person or an agent hires an agent, the new agent waits in the Inbox until an owner or admin approves it."
        checked={company().requireBoardApprovalForNewAgents}
        onChange={(value) => void props.saver.save({ requireBoardApprovalForNewAgents: value })}
      >
        <Show when={waiting() > 0}>
          <A class="ps-link" href={`/${company().issuePrefix}/inbox`}>
            {waiting() === 1 ? "1 hire is waiting" : `${waiting()} hires are waiting`}
          </A>
        </Show>
      </SwitchRow>
    </SettingsCard>
  );
}

function RequestsCard(props: { saver: Saver }) {
  const company = useCompany();
  const governance = () => company().interactionResolverGovernance ?? {};
  const set = (kind: GovernanceKind, field: "cap" | "defaultPolicy", value: Audience) =>
    void props.saver.save({ interactionResolverGovernance: setKindAudience(governance(), kind, field, value) });

  return (
    <section class="card settings-card" aria-labelledby="cs-requests">
      <CardHead
        id="cs-requests"
        title="Agent requests"
        note={
          <CardNote state={props.saver.state()} error={props.saver.error()}>
            Agents ask for answers, confirmations and reviews. Choose who may respond to each kind. A task can tighten this, but not loosen it.
          </CardNote>
        }
      />
      <div class="cs-table cs-table--requests" role="table" aria-label="Who can answer each kind of request">
        <div class="cs-thead" role="row">
          <span role="columnheader">Kind</span>
          <span role="columnheader">Example</span>
          <span role="columnheader">Who can answer</span>
        </div>
        <For each={REQUEST_KINDS}>
          {(row) => {
            const audience = () => kindAudience(governance(), row.kind);
            return (
              <div class="cs-trow" role="row">
                <span role="cell" class="cs-strong">
                  {row.label}
                </span>
                <span role="cell" class="cs-muted">
                  {row.example}
                  <Show when={startsNarrower(audience())}>
                    <span class="fhelp">New requests ask for {audienceLabel(audience().start).toLowerCase()}.</span>
                  </Show>
                </span>
                <span role="cell">
                  <Menu>
                    <Menu.Trigger as={FieldButton} aria-label={`Who can answer ${row.label.toLowerCase()}: ${audienceLabel(audience().cap)}`}>
                      {audienceLabel(audience().cap)}
                    </Menu.Trigger>
                    <Menu.Content label={`${row.label}: who can answer`} width={320}>
                      <Menu.Group label="Who can answer">
                        <For each={AUDIENCES}>
                          {(option) => (
                            <Menu.Item
                              onSelect={() => option.value !== audience().cap && set(row.kind, "cap", option.value)}
                              description={option.effect}
                              hint={option.value === audience().cap ? <Check size={14} /> : undefined}
                            >
                              {option.label}
                            </Menu.Item>
                          )}
                        </For>
                      </Menu.Group>
                      <Menu.Separator />
                      <Menu.Group label="New requests ask for">
                        <For each={AUDIENCES}>
                          {(option) => (
                            <Menu.Item
                              onSelect={() => option.value !== audience().start && set(row.kind, "defaultPolicy", option.value)}
                              hint={option.value === audience().start ? <Check size={14} /> : undefined}
                            >
                              {option.value === "anyone" ? "Whatever the agent asks for" : option.label}
                            </Menu.Item>
                          )}
                        </For>
                      </Menu.Group>
                    </Menu.Content>
                  </Menu>
                </span>
              </div>
            );
          }}
        </For>
      </div>
      <footer class="cfoot cs-muted">Tool approvals always wait for a person.</footer>
    </section>
  );
}

function DangerCard(props: { saver: Saver }) {
  const company = useCompany();
  const client = useQueryClient();
  const navigate = useNavigate();
  const [confirm, setConfirm] = createSignal<"pause" | "archive" | null>(null);
  const paused = () => company().status === "paused";

  const archive = async () => {
    try {
      await companiesApi.archive(company().id);
      pushToast({ tone: "info", title: `${company().name} is archived` });
      await client.invalidateQueries({ queryKey: queryKeys.companies.all });
      navigate("/", { replace: true });
    } catch (caught) {
      pushToast({ tone: "error", title: "Couldn't archive the organization", body: failure(caught, "") || undefined });
    }
  };

  return (
    <section class="card settings-card cs-danger" aria-labelledby="cs-danger">
      <CardHead id="cs-danger" title="Danger zone" note={<CardNote state={props.saver.state()} error={props.saver.error()}>{null}</CardNote>} />
      <div class="cs-lrow">
        <div class="cs-grow">
          <div class="cs-strong">{paused() ? "Every agent is paused" : "Pause every agent"}</div>
          <div class="cs-muted">
            {paused()
              ? "No new runs start anywhere in the organization until you resume."
              : "No new runs start anywhere in the organization. Runs in progress are stopped."}
          </div>
        </div>
        <Show
          when={paused()}
          fallback={
            <Button size="compact" variant="danger" icon={<PauseCircle size={14} aria-hidden="true" />} onClick={() => setConfirm("pause")}>
              Pause all
            </Button>
          }
        >
          <Button size="compact" variant="primary" icon={<PlayCircle size={14} aria-hidden="true" />} onClick={() => void props.saver.save({ status: "active" })}>
            Resume all
          </Button>
        </Show>
      </div>
      <div class="cs-lrow">
        <div class="cs-grow">
          <div class="cs-strong">Archive the organization</div>
          <div class="cs-muted">Stops every agent and hides the organization from its members. Its data is kept, and it can be restored from the organization list.</div>
        </div>
        <Button size="compact" variant="danger" icon={<Archive size={14} aria-hidden="true" />} disabled={company().status === "archived"} onClick={() => setConfirm("archive")}>
          Archive…
        </Button>
      </div>
      <ConfirmDialog
        open={confirm() === "pause"}
        onOpenChange={(open) => !open && setConfirm(null)}
        title={`Pause every agent in ${company().name}?`}
        body="No new runs start, and runs in progress are stopped. Agents start again when you resume."
        confirmLabel="Pause all"
        danger
        onConfirm={() => props.saver.save({ status: "paused" })}
      />
      <ConfirmDialog
        open={confirm() === "archive"}
        onOpenChange={(open) => !open && setConfirm(null)}
        title={`Archive ${company().name}?`}
        body="Every agent stops and the organization leaves the sidebar for all its members. Nothing is deleted."
        confirmLabel="Archive"
        danger
        onConfirm={archive}
      />
    </section>
  );
}
