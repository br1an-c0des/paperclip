import { createQuery, useQueryClient } from "@tanstack/solid-query";
import { Building2, Search, ShieldCheck } from "lucide-solid";
import { createEffect, createMemo, createSignal, For, on, onCleanup, Show } from "solid-js";
import { adminApi, type AdminUser } from "@/api/admin";
import { queryKeys } from "@/api/queryKeys";
import { InitialsDisc } from "@/ui/Avatar";
import { Button } from "@/ui/Button";
import { Dialog } from "@/ui/Dialog";
import { SettingsCard, TextInput } from "@/ui/Field";
import { Switch } from "@/ui/Switch";
import { TonePill } from "@/ui/Status";
import { pushToast } from "@/ui/Toast";
import { accessChanged, demoteProblem, personLabel, sortOrganizations } from "./app-settings-model";
import { failure, ListRow, SectionTitle } from "./shared";

/*
 * Admins (board 30's outline; the old UI's Instance settings → Access): the people on this instance,
 * who is an instance admin, and which organizations each belongs to. Make or remove an admin
 * (`POST /api/admin/users/:id/promote-instance-admin`, `/demote-instance-admin`); you can't remove
 * yourself or the last admin. "Organizations" sets a person's memberships
 * (`PUT /api/admin/users/:id/company-access`); new ones join as an active operator.
 */

export function AdminsSection(props: { youId: string | null }) {
  const client = useQueryClient();
  const [search, setSearch] = createSignal("");
  const [query, setQuery] = createSignal("");
  // Search as you type, a moment after the last key.
  createEffect(
    on(search, (value) => {
      const timer = window.setTimeout(() => setQuery(value.trim()), 250);
      onCleanup(() => window.clearTimeout(timer));
    }),
  );
  const everyone = createQuery(() => ({ queryKey: queryKeys.instanceSettings.adminUsers(""), queryFn: () => adminApi.users("") }));
  const found = createQuery(() => ({
    queryKey: queryKeys.instanceSettings.adminUsers(query()),
    queryFn: () => adminApi.users(query()),
    enabled: query() !== "",
  }));
  const users = () => (query() ? found.data : everyone.data) ?? [];
  const adminCount = () => (everyone.data ?? []).filter((user) => user.isInstanceAdmin).length;
  const sorted = createMemo(() => [...users()].sort((a, b) => Number(b.isInstanceAdmin) - Number(a.isInstanceAdmin) || personLabel(a).localeCompare(personLabel(b))));
  const [pending, setPending] = createSignal<string | null>(null);
  const [editing, setEditing] = createSignal<AdminUser | null>(null);

  const setAdmin = async (user: AdminUser, admin: boolean) => {
    setPending(user.id);
    try {
      await (admin ? adminApi.promote(user.id) : adminApi.demote(user.id));
      await client.invalidateQueries({ queryKey: ["access", "admin-users"] });
      pushToast({ tone: "success", title: admin ? `${personLabel(user)} is an instance admin` : `${personLabel(user)} is no longer an instance admin` });
    } catch (caught) {
      pushToast({ tone: "error", title: "Couldn't change the role", body: failure(caught, "Try again.") });
    } finally {
      setPending(null);
    }
  };

  return (
    <>
      <SectionTitle title="Admins">Who can change this instance's settings, and which organizations each person belongs to.</SectionTitle>
      <SettingsCard
        title="People"
        description="Instance admins can change these settings and open every organization's settings."
        aria-label="People on this instance"
      >
        <div class="as-search">
          <Search size={15} aria-hidden="true" />
          <TextInput value={search()} placeholder="Search by name or email" aria-label="Search people" onInput={(event) => setSearch(event.currentTarget.value)} />
        </div>
        <Show when={everyone.error || found.error}>
          <p class="as-empty-line as-bad" role="alert">
            {failure(everyone.error ?? found.error, "Couldn't load the people on this instance.")}
          </p>
        </Show>
        <For each={sorted()} fallback={<Show when={!everyone.isLoading && !found.isFetching}><p class="as-empty-line">No one matches.</p></Show>}>
          {(user) => {
            const blocked = () => demoteProblem(user, props.youId, adminCount());
            return (
              <ListRow
                mark={
                  <Show when={user.image} fallback={<InitialsDisc name={personLabel(user)} seed={user.id} size={32} />}>
                    {(src) => <img class="as-avatar as-avatar--32" src={src()} alt="" width="32" height="32" />}
                  </Show>
                }
                title={
                  <>
                    {personLabel(user)}
                    <Show when={user.id === props.youId}>
                      <span class="as-muted"> (you)</span>
                    </Show>
                  </>
                }
                meta={[user.email, user.activeCompanyMembershipCount === 1 ? "1 organization" : `${user.activeCompanyMembershipCount} organizations`].filter(Boolean).join(" · ")}
              >
                <Show when={user.isInstanceAdmin}>
                  <TonePill tone="violet" compact icon={<ShieldCheck size={12} aria-hidden="true" />}>
                    Instance admin
                  </TonePill>
                </Show>
                <Button size="compact" ghost icon={<Building2 size={14} />} onClick={() => setEditing(user)}>
                  Organizations
                </Button>
                <Show
                  when={user.isInstanceAdmin}
                  fallback={
                    <Button size="compact" disabled={pending() === user.id} onClick={() => void setAdmin(user, true)}>
                      Make admin
                    </Button>
                  }
                >
                  <Show
                    when={blocked()}
                    fallback={
                      <Button size="compact" disabled={pending() === user.id} onClick={() => void setAdmin(user, false)}>
                        Remove admin
                      </Button>
                    }
                  >
                    {(reason) => <span class="as-row-note">{reason()}</span>}
                  </Show>
                </Show>
              </ListRow>
            );
          }}
        </For>
      </SettingsCard>
      <Show when={editing()}>{(user) => <AccessDialog user={user()} onClose={() => setEditing(null)} />}</Show>
    </>
  );
}

/** A person's organizations: a switch per organization, saved together. */
function AccessDialog(props: { user: AdminUser; onClose: () => void }) {
  const client = useQueryClient();
  const companies = createQuery(() => ({ queryKey: queryKeys.instanceSettings.companyDirectory, queryFn: adminApi.companies }));
  const access = createQuery(() => ({ queryKey: queryKeys.instanceSettings.userCompanyAccess(props.user.id), queryFn: () => adminApi.companyAccess(props.user.id) }));
  const saved = createMemo(() => new Set((access.data?.companyAccess ?? []).filter((entry) => entry.status === "active").map((entry) => entry.companyId)));
  const roles = createMemo(() => new Map((access.data?.companyAccess ?? []).map((entry) => [entry.companyId, entry])));
  const [draft, setDraft] = createSignal<Set<string> | null>(null);
  const current = () => draft() ?? saved();
  const [saving, setSaving] = createSignal(false);
  const [problem, setProblem] = createSignal<string | null>(null);

  const toggle = (companyId: string, on: boolean) => {
    const next = new Set(current());
    if (on) next.add(companyId);
    else next.delete(companyId);
    setDraft(next);
  };

  const save = async () => {
    setSaving(true);
    setProblem(null);
    try {
      const result = await adminApi.setCompanyAccess(props.user.id, [...current()]);
      client.setQueryData(queryKeys.instanceSettings.userCompanyAccess(props.user.id), result);
      await Promise.all([
        client.invalidateQueries({ queryKey: ["access", "admin-users"] }),
        client.invalidateQueries({ queryKey: queryKeys.companies.all }),
      ]);
      pushToast({ tone: "success", title: `Updated ${personLabel(props.user)}'s organizations` });
      props.onClose();
    } catch (caught) {
      setProblem(failure(caught, "Couldn't save the organizations."));
    } finally {
      setSaving(false);
    }
  };

  const roleNote = (companyId: string) => {
    const entry = roles().get(companyId);
    if (!entry || entry.status !== "active") return current().has(companyId) ? "Joins as an operator" : undefined;
    return entry.membershipRole ? `${entry.membershipRole[0]!.toUpperCase()}${entry.membershipRole.slice(1)}` : undefined;
  };

  return (
    <Dialog
      open
      onOpenChange={(open) => !open && props.onClose()}
      title={`${personLabel(props.user)}'s organizations`}
      description="Turn on the organizations this person belongs to. Roles are changed in each organization's Members settings."
      width={520}
      hideClose
      footer={
        <>
          <Show when={problem()}>
            <span class="field-error as-foot-error" role="alert">
              {problem()}
            </span>
          </Show>
          <Button ghost onClick={props.onClose}>
            Cancel
          </Button>
          <Button variant="primary" disabled={saving() || !access.data || !accessChanged(saved(), current())} onClick={() => void save()}>
            {saving() ? "Saving…" : "Save"}
          </Button>
        </>
      }
    >
      <Show when={access.data && companies.data} fallback={<p class="as-muted">{access.error ? failure(access.error, "Couldn't load their organizations.") : "Loading…"}</p>}>
        <div class="as-access-list">
          <For each={sortOrganizations(companies.data ?? [])}>
            {(company) => (
              <Switch
                checked={current().has(company.id)}
                onChange={(on) => toggle(company.id, on)}
                label={company.name}
                description={[company.status === "archived" ? "Archived" : null, roleNote(company.id)].filter(Boolean).join(" · ") || undefined}
              />
            )}
          </For>
        </div>
      </Show>
    </Dialog>
  );
}
