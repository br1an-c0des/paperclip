import type { McpConnection } from "@paperclipai/shared";
import { A } from "@solidjs/router";
import { createMutation, createQuery, useQueryClient } from "@tanstack/solid-query";
import { ExternalLink } from "lucide-solid";
import { createMemo, createSignal, For, Match, Show, Switch } from "solid-js";
import { mcpApi } from "@/api/mcp";
import { queryKeys } from "@/api/queryKeys";
import { connectionTitle, mcpProblem } from "@/auth/auth-model";
import { ConfirmDialog } from "@/documents/ConfirmDialog";
import { useCompany } from "@/lib/company";
import { Button, buttonClass } from "@/ui/Button";
import { pushToast } from "@/ui/Toast";
import { CopyBlock } from "../advanced/parts";
import { failureText } from "../shared";
import {
  ASSISTANT_NAMES,
  ASSISTANTS,
  AUTHORIZATION_HANDOFF,
  assistantAccess,
  assistantRows,
  docsUrl,
  invitation,
  setupSteps,
  type AssistantClient,
} from "./assistant-model";

/*
 * Apps → Assistants (`/apps/assistant-connection`, the old UI's AssistantConnection): connect an
 * outside assistant (Codex, Claude Code, OpenCode, a browser assistant or a headless client) to
 * Paperclip's MCP endpoint, then see and revoke the assistants connected as you.
 *
 * The endpoint needs a public URL and the experimental setting `enablePublicMcp`. Without a public
 * URL the MCP routes aren't mounted and answer 404; with the setting off `GET /mcp/setup` says
 * `enabled: false`. The page says which, as the MCP connect pages do (`mcpProblem`).
 */

export function AssistantConnection() {
  const company = useCompany();
  const client = useQueryClient();
  const [assistant, setAssistant] = createSignal<AssistantClient>("codex");
  const [revoking, setRevoking] = createSignal<McpConnection | null>(null);
  const setup = createQuery(() => ({
    queryKey: queryKeys.mcp.setup,
    queryFn: mcpApi.setup,
    retry: false,
    refetchOnWindowFocus: "always" as const,
  }));
  const enabled = () => setup.data?.enabled === true;
  const connections = createQuery(() => ({
    queryKey: queryKeys.mcp.connections,
    queryFn: mcpApi.connections,
    retry: false,
    // While you set one up, watch for it to appear.
    refetchInterval: enabled() ? 5000 : false,
  }));
  const rows = createMemo(() => assistantRows(connections.data, company().id));
  const problem = createMemo(() => (setup.error ? mcpProblem(setup.error) : null));
  const serverUrl = () => setup.data?.serverUrl ?? "";
  const invite = () => (serverUrl() ? invitation(serverUrl(), { id: company().id, name: company().name }) : "");
  const revoke = createMutation(() => ({
    mutationFn: (id: string) => mcpApi.revoke(id),
    onSuccess: (_: unknown, id: string) => {
      client.setQueryData<McpConnection[]>(queryKeys.mcp.connections, (list) => list?.filter((row) => row.id !== id));
      pushToast({ title: "Assistant disconnected", body: "Its future calls are refused.", tone: "success" });
      return client.invalidateQueries({ queryKey: queryKeys.mcp.connections });
    },
    onError: (error) => pushToast({ title: "Couldn't revoke that connection", body: failureText(error, "Please try again."), tone: "error" }),
  }));

  return (
    <>
      <section class="card ap-card" aria-labelledby="as-connect">
        <header class="chead">
          <h3 id="as-connect" class="disp">
            Connect an assistant
          </h3>
          <p>
            Use {company().name} from Codex, Claude Code, OpenCode or another assistant: review work, create tasks and follow up, with your account's access to this
            organization.
          </p>
        </header>
        <div class="tl-form">
          <Switch>
            <Match when={setup.isPending}>
              <p class="cx-note" role="status">
                Checking assistant connections…
              </p>
            </Match>
            <Match when={problem()}>
              {(found) => (
                <div class="tl-stack">
                  <p class="cx-note" classList={{ "cx-note--warn": found().kind !== "error", "cx-note--error": found().kind === "error" }} role="alert">
                    {found().kind === "error" ? `Couldn't load assistant setup. ${found().message}` : found().message}
                  </p>
                  <div>
                    <Button size="compact" disabled={setup.isFetching} onClick={() => void setup.refetch()}>
                      Check again
                    </Button>
                  </div>
                </div>
              )}
            </Match>
            <Match when={setup.data && !enabled()}>
              <div class="tl-stack">
                <p class="cx-note cx-note--warn">
                  Assistant connections are turned off. An instance admin can turn on Assistant connections (MCP), the experimental setting{" "}
                  <span class="mono">enablePublicMcp</span>, in app settings. Then come back here to connect.
                </p>
                <div>
                  <A class={buttonClass({ size: "compact" })} href={`/${company().issuePrefix}/company/settings/instance/general`}>
                    Open app settings
                  </A>
                </div>
              </div>
            </Match>
            <Match when={enabled()}>
              <p class="cx-note">Paste this invitation into your assistant. It sets up the connection and asks you to approve its access in Paperclip.</p>
              <CopyBlock value={invite()} label="invitation" />
              <details class="ap-more">
                <summary>Set it up by hand</summary>
                <div class="ap-more-body tl-stack">
                  <div class="ap-chips" role="group" aria-label="Assistant">
                    <For each={ASSISTANTS}>
                      {(entry) => (
                        <button type="button" class="ap-chip" aria-pressed={assistant() === entry} onClick={() => setAssistant(entry)}>
                          {ASSISTANT_NAMES[entry]}
                        </button>
                      )}
                    </For>
                  </div>
                  <ol class="cx-steps">
                    <For each={setupSteps(serverUrl(), assistant())}>
                      {(step, index) => (
                        <li>
                          <span>{step.text}</span>
                          <Show when={step.code}>{(code) => <CopyBlock value={code()} label={`${ASSISTANT_NAMES[assistant()]} step ${index() + 1}`} />}</Show>
                        </li>
                      )}
                    </For>
                  </ol>
                  <Show when={assistant() !== "browser"}>
                    <p class="cx-note">{AUTHORIZATION_HANDOFF}</p>
                  </Show>
                  <p class="cx-note">
                    When Paperclip asks, choose <b>{company().name}</b>, review the access, then click <b>Connect organization</b>. Creating tasks and adding comments
                    may start agent work on the organization's budget.
                  </p>
                  <div class="field-stack">
                    <span class="field-label">MCP server address</span>
                    <CopyBlock value={serverUrl()} label="MCP server address" />
                  </div>
                  <a class="cx-link" href={docsUrl(assistant())} target="_blank" rel="noreferrer">
                    Setup documentation{" "}
                    <ExternalLink size={12} aria-hidden="true" />
                  </a>
                </div>
              </details>
            </Match>
          </Switch>
        </div>
      </section>

      <section class="card ap-card" aria-labelledby="as-yours">
        <header class="chead">
          <h3 id="as-yours" class="disp">
            Your connected assistants
          </h3>
          <p>Assistants connected as you to {company().name}. Revoking one stops its future calls; work it already handed off carries on.</p>
        </header>
        <Switch>
          <Match when={connections.isPending}>
            <p class="ap-empty" role="status">
              Loading connections…
            </p>
          </Match>
          <Match when={connections.isError}>
            <Show
              when={problem() && problem()!.kind !== "error"}
              fallback={
                <div class="ap-empty" role="alert">
                  <p>Couldn't load your connections. {mcpProblem(connections.error).message}</p>
                  <Button size="compact" onClick={() => void connections.refetch()}>
                    Try again
                  </Button>
                </div>
              }
            >
              <p class="ap-empty">None. Assistants can connect once the MCP endpoint is available.</p>
            </Show>
          </Match>
          <Match when={rows().length === 0}>
            <p class="ap-empty">No assistants are connected to {company().name} yet.</p>
          </Match>
          <Match when={true}>
            <ul class="ap-rows">
              <For each={rows()}>
                {(row) => (
                  <li class="ap-row">
                    <div class="ap-row-main">
                      <span class="ap-row-name">{connectionTitle(row)}</span>
                      <span class="ap-row-meta">{assistantAccess(row.scopes)}</span>
                    </div>
                    <Button size="compact" variant="danger" disabled={revoke.isPending} aria-label={`Revoke ${connectionTitle(row)}`} onClick={() => setRevoking(row)}>
                      Revoke
                    </Button>
                  </li>
                )}
              </For>
            </ul>
          </Match>
        </Switch>
      </section>

      <ConfirmDialog
        open={revoking() !== null}
        onOpenChange={(open) => !open && setRevoking(null)}
        title="Revoke this assistant?"
        body={<>{revoking() ? connectionTitle(revoking()!) : ""} won't be able to make calls to Paperclip any more. You can connect it again later.</>}
        confirmLabel="Revoke"
        danger
        onConfirm={() => revoke.mutateAsync(revoking()!.id)}
      />
    </>
  );
}
