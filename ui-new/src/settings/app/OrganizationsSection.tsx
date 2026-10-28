import type { Company } from "@paperclipai/shared";
import { A } from "@solidjs/router";
import { createQuery, useQueryClient } from "@tanstack/solid-query";
import { ArchiveRestore, MoreHorizontal, Pencil, Plus, Trash2 } from "lucide-solid";
import { createMemo, createSignal, For, Show } from "solid-js";
import { adminApi } from "@/api/admin";
import { companiesApi, statsFor } from "@/api/companies";
import { queryKeys } from "@/api/queryKeys";
import { useSession } from "@/lib/session";
import { InitialsDisc } from "@/ui/Avatar";
import { Button } from "@/ui/Button";
import { Dialog } from "@/ui/Dialog";
import { Field, SettingsCard, TextInput } from "@/ui/Field";
import { Menu } from "@/ui/Menu";
import { pushToast } from "@/ui/Toast";
import { renameEdit, sortOrganizations, type InstanceHealth } from "./app-settings-model";
import { failure, ListRow, SectionTitle, StatePill } from "./shared";

/*
 * Organizations (board 30's outline): every organization on this instance, archived ones too (the
 * unscoped `GET /api/companies`), with agent and task counts. Create one by name, rename, bring an
 * archived one back, or delete one when the server allows it (`features.companyDeletionEnabled`).
 * Archiving is in each organization's settings. The full onboarding (first agent, first task) is
 * still the classic UI's; an organization created here starts empty.
 *
 * The list has no owners: that needs each organization's members.
 */

type Dialogs = { kind: "create" } | { kind: "rename"; company: Company } | { kind: "delete"; company: Company } | null;

export function OrganizationsSection(props: { accessibleIds: readonly string[] }) {
  const client = useQueryClient();
  const session = useSession();
  const directory = createQuery(() => ({ queryKey: queryKeys.instanceSettings.companyDirectory, queryFn: adminApi.companies }));
  const stats = createQuery(() => ({ queryKey: queryKeys.companies.stats, queryFn: companiesApi.stats }));
  const companies = createMemo(() => sortOrganizations(directory.data ?? []));
  const accessible = createMemo(() => new Set(props.accessibleIds));
  const local = () => session.health()?.deploymentMode === "local_trusted";
  const canDelete = () => (session.health() as InstanceHealth | undefined)?.features?.companyDeletionEnabled === true;
  const [dialog, setDialog] = createSignal<Dialogs>(null);
  const [draft, setDraft] = createSignal("");
  const [problem, setProblem] = createSignal<string | null>(null);
  const [busy, setBusy] = createSignal(false);

  const open = (next: Dialogs) => {
    setProblem(null);
    setDraft(next?.kind === "rename" ? next.company.name : "");
    setDialog(next);
  };

  const refresh = () => client.invalidateQueries({ queryKey: queryKeys.companies.all });

  const run = async (work: () => Promise<unknown>, fallback: string) => {
    setBusy(true);
    setProblem(null);
    try {
      await work();
      await refresh();
      return true;
    } catch (caught) {
      setProblem(failure(caught, fallback));
      return false;
    } finally {
      setBusy(false);
    }
  };

  const submit = async () => {
    const current = dialog();
    if (!current) return;
    if (current.kind === "create") {
      const name = draft().trim();
      if (!name) return setProblem("Enter a name.");
      let created: Company | undefined;
      if (await run(async () => (created = await adminApi.createCompany({ name })), "Couldn't create the organization.")) {
        setDialog(null);
        pushToast({ tone: "success", title: `Created ${name}`, action: created ? { label: "Open", href: `/${created.issuePrefix}/dashboard` } : undefined });
      }
    } else if (current.kind === "rename") {
      const name = renameEdit(current.company.name, draft());
      if (!name) return setDialog(null);
      if (await run(() => adminApi.updateCompany(current.company.id, { name }), "Couldn't rename the organization.")) setDialog(null);
    } else {
      if (draft().trim() !== current.company.name) return setProblem("Type the organization's name to confirm.");
      if (await run(() => adminApi.deleteCompany(current.company.id), "Couldn't delete the organization.")) {
        setDialog(null);
        pushToast({ tone: "success", title: `Deleted ${current.company.name}` });
      }
    }
  };

  const unarchive = async (company: Company) => {
    try {
      await adminApi.updateCompany(company.id, { status: "active" });
      await refresh();
      pushToast({ tone: "success", title: `${company.name} is active again` });
    } catch (caught) {
      pushToast({ tone: "error", title: `Couldn't bring back ${company.name}`, body: failure(caught, "Try again.") });
    }
  };

  const counts = (company: Company) => {
    const entry = statsFor(stats.data, company.id);
    if (!entry) return "";
    const agents = entry.agentCount === 1 ? "1 agent" : `${entry.agentCount} agents`;
    const tasks = entry.issueCount === 1 ? "1 task" : `${entry.issueCount} tasks`;
    return `${agents} · ${tasks}`;
  };

  return (
    <>
      <SectionTitle title="Organizations">Every organization on this instance. Each one's own settings are under that organization.</SectionTitle>
      <SettingsCard
        title="Organizations"
        description={directory.data ? `${directory.data.length} on this instance.` : undefined}
        footer={
          <Button icon={<Plus size={15} />} onClick={() => open({ kind: "create" })}>
            New organization
          </Button>
        }
      >
        <Show when={directory.error}>
          <p class="as-empty-line as-bad" role="alert">
            {failure(directory.error, "Couldn't load the organizations.")}
          </p>
        </Show>
        <For each={companies()}>
          {(company) => (
            <ListRow
              mark={
                <Show when={company.logoUrl} fallback={<InitialsDisc name={company.name.slice(0, 1)} seed={company.id} size={32} />}>
                  {(src) => <img class="as-logo" src={src()} alt="" width="32" height="32" />}
                </Show>
              }
              title={company.name}
              mono={company.issuePrefix}
              meta={counts(company)}
            >
              <Show when={company.status !== "active"}>
                <StatePill label={company.status === "archived" ? "Archived" : "Paused"} tone={company.status === "archived" ? null : "amber"} />
              </Show>
              <Show when={company.status !== "archived" && (local() || accessible().has(company.id))}>
                <A class="as-link" href={`/${company.issuePrefix}/dashboard`}>
                  Open
                </A>
              </Show>
              <Menu placement="bottom-end">
                <Menu.Trigger class="btn btn--icon btn--ghost btn--compact" aria-label={`More actions for ${company.name}`}>
                  <MoreHorizontal size={16} />
                </Menu.Trigger>
                <Menu.Content label={`${company.name} actions`} width={220}>
                  <Menu.Item icon={<Pencil size={15} />} onSelect={() => open({ kind: "rename", company })}>
                    Rename…
                  </Menu.Item>
                  <Show when={company.status === "archived"}>
                    <Menu.Item icon={<ArchiveRestore size={15} />} onSelect={() => void unarchive(company)}>
                      Bring back
                    </Menu.Item>
                  </Show>
                  <Show when={canDelete()}>
                    <Menu.Item icon={<Trash2 size={15} />} danger onSelect={() => open({ kind: "delete", company })}>
                      Delete…
                    </Menu.Item>
                  </Show>
                </Menu.Content>
              </Menu>
            </ListRow>
          )}
        </For>
      </SettingsCard>

      <Dialog
        open={dialog() !== null}
        onOpenChange={(value) => !value && setDialog(null)}
        title={dialog()?.kind === "create" ? "New organization" : dialog()?.kind === "rename" ? "Rename organization" : `Delete ${(dialog() as { company?: Company })?.company?.name ?? ""}?`}
        description={
          dialog()?.kind === "create"
            ? "It starts empty: hire its first agent from its Agents page."
            : dialog()?.kind === "delete"
              ? "This deletes its agents, tasks, projects and history for good. It can't be undone."
              : undefined
        }
        width={480}
        hideClose
        footer={
          <>
            <Button ghost onClick={() => setDialog(null)}>
              Cancel
            </Button>
            <Button variant={dialog()?.kind === "delete" ? "danger" : "primary"} disabled={busy()} onClick={() => void submit()}>
              {dialog()?.kind === "create" ? "Create" : dialog()?.kind === "rename" ? "Rename" : "Delete for good"}
            </Button>
          </>
        }
      >
        <form
          onSubmit={(event) => {
            event.preventDefault();
            void submit();
          }}
        >
          <Field
            label={dialog()?.kind === "delete" ? `Type “${(dialog() as { company?: Company })?.company?.name ?? ""}” to confirm` : "Name"}
            for="as-org-name"
            error={problem() ?? undefined}
          >
            <TextInput id="as-org-name" value={draft()} autocomplete="off" invalid={Boolean(problem())} onInput={(event) => setDraft(event.currentTarget.value)} />
          </Field>
        </form>
      </Dialog>
    </>
  );
}
