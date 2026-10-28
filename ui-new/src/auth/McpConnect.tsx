import type { McpConnection, McpDotPairingPreview } from "@paperclipai/shared";
import { A, useParams } from "@solidjs/router";
import { createMutation, createQuery, useQueryClient } from "@tanstack/solid-query";
import { Globe } from "lucide-solid";
import { createEffect, createSignal, For, Match, on, onCleanup, Show, Switch } from "solid-js";
import { mcpApi, type McpConsentInput } from "@/api/mcp";
import { CompanyMark } from "@/routes/Companies";
import { Splash } from "@/routes/Splash";
import { Button, buttonClass } from "@/ui/Button";
import { Field, TextInput } from "@/ui/Field";
import { assistantName, connectionAccess, connectionTitle, DOT_PAIRING_CODE, mcpProblem, signInHref } from "./auth-model";
import { Facts, Note, Standalone } from "./Standalone";

/*
 * Approving an assistant's connection to Paperclip over MCP, as ui/src/pages/McpConnect.tsx:
 *
 * - `/mcp-connect/:id`: an assistant's OAuth request. Pick the organization (unless the request
 *   fixed one), allow writes when asked and your role permits, then Connect or Cancel. The server
 *   answers with the address to send the browser back to the assistant.
 * - `/dot-connect/:id`: the same for a Dot agent, which pairs with a one-use code first.
 * - `/mcp-device?user_code=`: a device code typed into the browser; the assistant finishes on its own.
 * - `/assistant-connections`: your connections, to revoke.
 *
 * All of them need the instance's public MCP: a public URL and `enablePublicMcp` on (build plan
 * 3.12). When it's off, the page says so instead of failing vaguely (`mcpProblem`).
 */

const homeLink = () => <A class={buttonClass({ size: "compact" })} href="/">Back to Paperclip</A>;

function ClientOrigin(props: { origin: string }) {
  return (
    <p class="stand-origin">
      <Globe size={15} aria-hidden="true" />
      <bdi>{props.origin}</bdi>
    </p>
  );
}

/** The connection is off or unavailable on this instance: say it plainly. */
function Unavailable(props: { error: unknown; device?: boolean; onEditCode?: () => void }) {
  const problem = () => mcpProblem(props.error);
  return (
    <Standalone title={problem().kind === "error" ? "This connection request isn't available" : "Assistant connections are off"}>
      <Note tone={problem().kind === "error" ? "red" : "amber"} alert>
        {problem().message}
        {problem().kind === "error" ? " Start a new connection from your assistant." : ""}
      </Note>
      <div class="stand-actions">
        <Show when={props.device && problem().kind === "error"}>
          <Button size="compact" onClick={() => props.onEditCode?.()}>Enter a different code</Button>
        </Show>
        {homeLink()}
      </div>
    </Standalone>
  );
}

export function McpConnectPage(props: { agentPairingOnly?: boolean }) {
  const params = useParams<{ id: string }>();
  return (
    <Show when={params.id} keyed>
      {(id) => <McpRequest id={id} agentPairingOnly={props.agentPairingOnly} />}
    </Show>
  );
}

export function McpDevicePage() {
  const initial = new URLSearchParams(location.search).get("user_code") ?? "";
  const [code, setCode] = createSignal(initial);
  const [submitted, setSubmitted] = createSignal(initial.trim());
  return (
    <Show
      when={submitted()}
      keyed
      fallback={
        <Standalone title="Connect your assistant to Paperclip">
          <form
            class="stand-form"
            onSubmit={(event) => {
              event.preventDefault();
              setSubmitted(code().trim());
            }}
          >
            <Field label="The code your assistant shows" for="mcp-device-code">
              <TextInput id="mcp-device-code" class="mono" autocomplete="off" required maxLength={12} value={code()} onInput={(event) => setCode(event.currentTarget.value)} />
            </Field>
            <div class="stand-actions stand-actions--end">
              <Button type="submit" variant="primary" disabled={!code().trim()}>
                Continue
              </Button>
            </div>
          </form>
        </Standalone>
      }
    >
      {(userCode) => <McpRequest id={userCode} device onEditCode={() => setSubmitted("")} />}
    </Show>
  );
}

function McpRequest(props: { id: string; device?: boolean; agentPairingOnly?: boolean; onEditCode?: () => void }) {
  const dotOnly = () => !!props.agentPairingOnly;
  const request = createQuery(() => ({
    queryKey: [props.device ? "mcp-device" : dotOnly() ? "dot-mcp-request" : "mcp-request", props.id] as const,
    queryFn: () => (props.device ? mcpApi.device(props.id) : mcpApi.request(props.id, dotOnly())),
    retry: false,
  }));
  const data = () => request.data;

  // The organization: fixed by the request, or chosen here (pinned once loaded so a refetch can't
  // switch it).
  const [companyId, setCompanyId] = createSignal("");
  createEffect(() => {
    const first = data()?.companies[0];
    if (!companyId() && !data()?.requestedCompanyId && first) setCompanyId(first.id);
  });
  const selectedId = () => data()?.requestedCompanyId ?? companyId();
  const company = () => data()?.companies.find((entry) => entry.id === selectedId());
  const [writeEnabled, setWriteEnabled] = createSignal(true);
  const canApproveWrites = () => !data()?.agentConnection && !!company()?.canWrite && writeEnabled();
  const [deviceResult, setDeviceResult] = createSignal<"approved" | "denied" | null>(null);

  const consent = createMutation(() => ({
    mutationFn: (decision: "approve" | "deny") => {
      const input: McpConsentInput = {
        decision,
        companyId: selectedId() || undefined,
        allowWrites: decision === "approve" && !!data()?.requestedWrite && canApproveWrites(),
        allowConfiguration: decision === "approve" && !!data()?.requestedConfigure && canApproveWrites(),
      };
      return props.device ? mcpApi.consentDevice(props.id, input) : mcpApi.consent(props.id, input);
    },
    onSuccess: (result: { redirectUrl?: string; status?: "approved" | "denied" }) => {
      if (props.device && result.status) setDeviceResult(result.status);
      else if (result.redirectUrl) window.location.assign(result.redirectUrl);
    },
  }));

  // A Dot agent pairs with the one-use code from its setup prompt; the code's grant is previewed first.
  const [pairingCode, setPairingCode] = createSignal("");
  const [preview, setPreview] = createSignal<McpDotPairingPreview | null>(null);
  const [previewError, setPreviewError] = createSignal("");
  createEffect(
    on([pairingCode, () => data()?.agentConnection], ([code, agent]) => {
      setPreview(null);
      setPreviewError("");
      if (!agent || props.device || !DOT_PAIRING_CODE.test(code.trim())) return;
      let current = true;
      onCleanup(() => (current = false));
      mcpApi
        .previewDotPairing(props.id, code.trim(), dotOnly())
        .then((found) => current && setPreview(found))
        .catch((error: unknown) => current && setPreviewError(error instanceof Error ? error.message : "Couldn't check this pairing code."));
    }),
  );
  const pair = createMutation(() => ({
    mutationFn: () => mcpApi.pairDot(props.id, pairingCode().trim(), dotOnly()),
    onSuccess: (result: { redirectUrl: string }) => {
      setPairingCode("");
      window.location.assign(result.redirectUrl);
    },
  }));

  const returnPath = () =>
    props.device ? `/mcp-device?user_code=${encodeURIComponent(props.id)}` : `${dotOnly() ? "/dot-connect" : "/mcp-connect"}/${encodeURIComponent(props.id)}`;
  const origin = () => data()?.clientOrigin || data()?.redirectOrigin;

  return (
    <Switch>
      <Match when={deviceResult()}>
        {(result) => (
          <Splash title={result() === "approved" ? "Access approved" : "Connection declined"} actions={homeLink()}>
            {result() === "approved"
              ? "Go back to your assistant. It finishes connecting on its own."
              : "No access was granted. You can start a new connection from your assistant."}
          </Splash>
        )}
      </Match>
      <Match when={request.isLoading}>
        <Splash title="Loading the connection request" quiet />
      </Match>
      <Match when={request.error}>{(error) => <Unavailable error={error()} device={props.device} onEditCode={props.onEditCode} />}</Match>
      <Match when={data()}>
        {(req) => (
          <Standalone wide title={<>Connect <bdi>{assistantName(req().clientName)}</bdi> to Paperclip</>}>
            <Show when={origin()}>{(found) => <ClientOrigin origin={found()} />}</Show>
            <Show when={!props.device && req().redirectOrigin && req().redirectOrigin !== origin()}>
              <ClientOrigin origin={req().redirectOrigin} />
            </Show>
            <Show when={props.device}>
              <p class="stand-body">
                Check this matches the code your assistant shows: <strong class="mono">{props.id.toUpperCase()}</strong>
              </p>
            </Show>

            <Show when={req().agentConnection && !props.device}>
              <form
                class="stand-form"
                onSubmit={(event) => {
                  event.preventDefault();
                  pair.mutate();
                }}
              >
                <p class="stand-body">
                  Enter the one-use code from Paperclip's agent setup to review what this connection may do. Keep the code out of the bot's chat. Access is
                  granted only when you allow the agent named below.
                </p>
                <Field label="Pairing code" for="dot-pairing-code">
                  <TextInput id="dot-pairing-code" type="password" autocomplete="off" required maxLength={32} value={pairingCode()} onInput={(event) => setPairingCode(event.currentTarget.value)} />
                </Field>
                <Show when={preview()}>
                  {(found) => (
                    <>
                      <Show when={found().providerKind === "grok_bot"}>
                        <p class="stand-body">
                          Allow this connection to work as {found().agent.name} in {found().company.name}.
                        </p>
                      </Show>
                      <Facts
                        rows={[
                          ["Organization", found().company.name],
                          ["Agent", found().agent.name],
                          ["Permissions", found().permissions],
                          ...(found().authorizingPerson ? ([["Authorized by", found().authorizingPerson!]] as const) : []),
                          ["Access lasts", found().accessDuration],
                        ]}
                      />
                    </>
                  )}
                </Show>
                <Show when={previewError() || (pair.error as Error | null)?.message}>{(message) => <Note tone="red" alert>{message()}</Note>}</Show>
                <div class="stand-actions stand-actions--end">
                  <Button type="submit" variant="primary" disabled={!preview() || !DOT_PAIRING_CODE.test(pairingCode().trim()) || pair.isPending}>
                    {pair.isPending ? "Connecting…" : "Allow agent connection"}
                  </Button>
                </div>
              </form>
            </Show>

            <Show
              when={!req().requiresSignIn}
              fallback={
                <div class="stand-actions">
                  <A class={buttonClass({ variant: "primary" })} href={signInHref(returnPath())}>
                    Sign in or create an account
                  </A>
                </div>
              }
            >
              <Show
                when={!req().requestedCompanyId}
                fallback={
                  <Show
                    when={company()}
                    fallback={
                      <Note tone="red">
                        The organization this request names isn't available to your account. Cancel, then reconnect from your assistant and choose one you can open.
                      </Note>
                    }
                  >
                    {(found) => <Facts rows={[["Organization", <span class="stand-origin"><CompanyMark company={found()} size={28} /> {found().name}</span>]]} />}
                  </Show>
                }
              >
                <fieldset class="stand-options" disabled={consent.isPending}>
                  <legend>Organization</legend>
                  <For each={req().companies}>
                    {(entry) => (
                      <label class="stand-option">
                        <input type="radio" name="mcp-company" value={entry.id} checked={selectedId() === entry.id} onChange={() => setCompanyId(entry.id)} />
                        <CompanyMark company={entry} size={28} />
                        <span>{entry.name}</span>
                      </label>
                    )}
                  </For>
                  <Show when={!req().companies.length}>
                    <p class="stand-muted">
                      Your account has no organizations to connect. Ask an organization owner to add you, then reconnect from your assistant.
                      <Show when={req().setupUrl}>
                        {(url) => (
                          <>
                            {" "}
                            <a class="stand-link" href={url()}>
                              Create an organization
                            </a>
                          </>
                        )}
                      </Show>
                    </p>
                  </Show>
                </fieldset>
              </Show>

              <p class="stand-body">
                {req().agentConnection
                  ? "Connect Dot as a Paperclip agent. Pair it with an agent after connecting; its work uses that agent's permissions."
                  : "It can read all of your Paperclip data in this organization."}
              </p>
              <Show when={(req().requestedWrite || req().requestedConfigure) && !req().agentConnection}>
                <label class="stand-option">
                  <input
                    type="checkbox"
                    checked={canApproveWrites()}
                    disabled={!company()?.canWrite || consent.isPending}
                    onChange={(event) => setWriteEnabled(event.currentTarget.checked)}
                  />
                  <span>{req().requestedConfigure ? "Also edit work, and configure agents, projects and skills" : "Also edit work"}</span>
                </label>
              </Show>
              <Show when={company() && !company()!.canWrite}>
                <p class="stand-muted">Your role in this organization is read-only.</p>
              </Show>
              <Show when={consent.error}>{(error) => <Note tone="red" alert>{mcpProblem(error()).message}</Note>}</Show>
              <div class="stand-actions stand-actions--split">
                <Button variant="quiet" disabled={consent.isPending} onClick={() => consent.mutate("deny")}>
                  Cancel
                </Button>
                <Button
                  variant="primary"
                  disabled={!company() || (!!req().agentConnection && !company()!.canWrite) || consent.isPending}
                  onClick={() => consent.mutate("approve")}
                >
                  {consent.isPending ? "Connecting…" : req().agentConnection ? "Connect Dot agent" : "Connect organization"}
                </Button>
              </div>
            </Show>
          </Standalone>
        )}
      </Match>
    </Switch>
  );
}

/** `/assistant-connections`: the assistants connected as you, to revoke. */
export function AssistantConnectionsPage() {
  const client = useQueryClient();
  const connections = createQuery(() => ({ queryKey: ["mcp-connections"] as const, queryFn: mcpApi.connections, retry: false }));
  const setup = createQuery(() => ({ queryKey: ["mcp-setup"] as const, queryFn: mcpApi.setup, retry: false }));
  const active = () => connections.data?.filter((connection) => !connection.revokedAt) ?? [];
  const revoke = createMutation(() => ({
    mutationFn: (id: string) => mcpApi.revoke(id),
    onSuccess: (_: unknown, id: string) => {
      client.setQueryData<McpConnection[]>(["mcp-connections"], (rows) => rows?.filter((row) => row.id !== id));
      return client.invalidateQueries({ queryKey: ["mcp-connections"] });
    },
  }));
  const problem = () => (connections.error ? mcpProblem(connections.error) : null);

  return (
    <Standalone wide title="Assistant connections" lede="Revoking a connection stops its future tool calls. Work it already handed off carries on under your organization's usual controls.">
      <Show when={setup.data?.enabled === false}>
        <Note tone="amber">
          Assistant connections are turned off on this Paperclip, so these can't make calls. An instance admin can turn on the experimental setting for public MCP
          (enablePublicMcp).
        </Note>
      </Show>
      <Switch>
        <Match when={connections.isLoading}>
          <p class="stand-muted" role="status">Loading connections…</p>
        </Match>
        <Match when={problem()}>{(found) => <Note tone={found().kind === "error" ? "red" : "amber"} alert>{found().message}</Note>}</Match>
        <Match when={active().length === 0}>
          <p class="stand-muted">No assistant connections.</p>
        </Match>
        <Match when={active().length > 0}>
          <ul class="stand-list">
            <For each={active()}>
              {(connection) => (
                <li class="stand-item">
                  <h2 class="disp">{connectionTitle(connection)}</h2>
                  <span class="stand-muted">Organization: {connection.companyName}</span>
                  <Show when={connection.agent}>
                    {(agent) => (
                      <span class="stand-body">
                        Works as{" "}
                        <A class="stand-link" href={`/${connection.companyPrefix ?? connection.companyId}/agents/${agent().id}`}>
                          {agent().name}
                        </A>
                        {connection.user ? ` · authorized by ${connection.user.name}` : ""}
                      </span>
                    )}
                  </Show>
                  <span class="stand-body">{connectionAccess(connection.scopes)}</span>
                  <div class="stand-actions">
                    <Button size="compact" variant="danger" disabled={revoke.isPending} onClick={() => revoke.mutate(connection.id)}>
                      Revoke
                    </Button>
                  </div>
                </li>
              )}
            </For>
          </ul>
        </Match>
      </Switch>
      <Show when={revoke.error}>{(error) => <Note tone="red" alert>{mcpProblem(error()).message}</Note>}</Show>
      <div class="stand-actions">{homeLink()}</div>
    </Standalone>
  );
}
