import type { Project } from "@paperclipai/shared";
import { createMutation, createQuery, useQueryClient } from "@tanstack/solid-query";
import { Check, ShieldCheck } from "lucide-solid";
import { createSignal, For, Match, Show, Switch } from "solid-js";
import { projectsApi } from "@/api/projects";
import { queryKeys } from "@/api/queryKeys";
import { useCompany } from "@/lib/company";
import { Button } from "@/ui/Button";
import { FieldButton, SettingsCard, SettingsRow } from "@/ui/Field";
import { Menu } from "@/ui/Menu";
import { pushToast } from "@/ui/Toast";
import { gitAuthorizedAs } from "./settings-model";
import { failure, FootError } from "./shared";

/*
 * Git authorization (upstream, 2026-10-26; ProjectGitAuthorization.tsx and
 * doc/execution-github-identity.md). Background work on a project's repositories (provisioning a
 * workspace, maintenance) has no task, so no person's identity to run as. A person who can edit the
 * project's workspaces picks one of their own GitHub Connector grants and explicitly authorizes the
 * project to use it until they revoke it. Only the grant is stored, never a credential. Agents can't
 * give this consent, and task runs keep using their own identity.
 *
 * `GET` returns the current grant and only your own eligible grants; `PUT { grantId }` authorizes,
 * `PUT { grantId: null }` revokes.
 */

export function GitAuthorizationSection(props: { project: Project }) {
  const company = useCompany();
  const client = useQueryClient();
  const key = () => queryKeys.projectSettings.gitAuthorization(company().id, props.project.id);
  const authorization = createQuery(() => ({
    queryKey: key(),
    queryFn: ({ signal }) => projectsApi.gitAuthorization(props.project.id, signal),
    retry: false,
  }));
  const [selected, setSelected] = createSignal("");
  const [consent, setConsent] = createSignal(false);
  const save = createMutation(() => ({
    mutationFn: (grantId: string | null) => projectsApi.setGitAuthorization(props.project.id, grantId),
    onSuccess: (data, grantId) => {
      client.setQueryData(key(), data);
      setSelected("");
      setConsent(false);
      pushToast({ tone: "success", title: grantId ? "Authorized the project" : "Revoked the authorization" });
    },
  }));
  const data = () => authorization.data;
  const authorizedAs = () => gitAuthorizedAs(data());
  const option = () => data()?.options.find((entry) => entry.grantId === selected());

  return (
    <SettingsCard
      title="Background GitHub authorization"
      description="Lets this project's workspace provider use your GitHub Connector to set up and maintain its repositories, until you revoke it."
      footer={save.error ? <FootError message={failure(save.error, "Couldn't change the authorization.")} /> : undefined}
    >
      <Switch>
        <Match when={authorization.isPending}>
          <p class="ps-list-note">Loading…</p>
        </Match>
        <Match when={authorization.isError}>
          <p class="ps-list-note" role="alert">
            Couldn't load the authorization. {failure(authorization.error, "")}
          </p>
        </Match>
        <Match when={data()}>
          {(current) => (
            <>
              <SettingsRow label="Authorized as">
                <div class="ps-inline ps-inline--spread">
                  <Show when={authorizedAs()} fallback={<span class="ps-muted-line">Not authorized. Private repositories wait for an authorization before their workspaces are set up; public ones don't need one.</span>}>
                    {(who) => (
                      <span class="ps-inline">
                        <ShieldCheck size={15} aria-hidden="true" />
                        <span>{who()}</span>
                      </span>
                    )}
                  </Show>
                  <Show when={current().grantId}>
                    <Button size="compact" variant="danger" disabled={save.isPending} onClick={() => save.mutate(null)}>
                      Revoke
                    </Button>
                  </Show>
                </div>
              </SettingsRow>
              <SettingsRow
                label={current().grantId ? "Authorize another account" : "Your GitHub account"}
                help="Only your own accounts, connected through a GitHub Connector installed for this company."
              >
                <Show
                  when={current().options.length > 0}
                  fallback={<span class="ps-muted-line">Connect your GitHub account and install the Connector for this company, under Apps, to authorize the project.</span>}
                >
                  <div class="ps-stack">
                    <Menu>
                      <Menu.Trigger as={FieldButton} class="ps-field-360" aria-label="Your GitHub account">
                        {option() ? `${option()!.login} · ${option()!.connectionName}` : "Pick your GitHub account"}
                      </Menu.Trigger>
                      <Menu.Content label="Your GitHub accounts" width={320}>
                        <For each={current().options}>
                          {(entry) => (
                            <Menu.Item onSelect={() => setSelected(entry.grantId)} description={entry.connectionName} hint={entry.grantId === selected() ? <Check size={14} /> : undefined}>
                              {entry.login}
                            </Menu.Item>
                          )}
                        </For>
                      </Menu.Content>
                    </Menu>
                    <label class="ps-consent">
                      <input type="checkbox" checked={consent()} onChange={(event) => setConsent(event.currentTarget.checked)} />
                      <span>
                        I allow this project's workspace provider to use my GitHub Connector, with its existing GitHub permissions, for repository setup and maintenance
                        until I revoke it. People who can edit the project's repositories can add any repository this connection reaches.
                      </span>
                    </label>
                    <div class="ps-inline">
                      <Button size="compact" variant="primary" disabled={!selected() || !consent() || save.isPending} onClick={() => save.mutate(selected())}>
                        {save.isPending ? "Saving…" : "Authorize project"}
                      </Button>
                    </div>
                  </div>
                </Show>
              </SettingsRow>
            </>
          )}
        </Match>
      </Switch>
    </SettingsCard>
  );
}
