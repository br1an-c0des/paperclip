import type { AppDefinition, ConnectToolApp, ConnectToolAppResult, ConnectionMethodDef, FieldDef, MachineSignInSetupResult } from "@paperclipai/shared";
import { A, Navigate, useNavigate } from "@solidjs/router";
import { createMutation } from "@tanstack/solid-query";
import { ExternalLink, Plus, Trash2 } from "lucide-solid";
import { createEffect, createMemo, createSignal, For, Index, Match, on, Show, Switch, type JSX } from "solid-js";
import { createStore, produce } from "solid-js/store";
import { toolsApi, type VercelConnectAvailability } from "@/api/tools";
import { useCompany } from "@/lib/company";
import { Button, buttonClass } from "@/ui/Button";
import { Field, TextArea, TextInput } from "@/ui/Field";
import { InfoTip } from "@/ui/InfoTip";
import { Markdown } from "@/ui/Markdown";
import { pushToast } from "@/ui/Toast";
import {
  acceptsOwnOAuthClient,
  accessInstalls,
  BYO_SIGN_IN_OPTIONS,
  byoAuthChange,
  byoFailureFocus,
  byoPayload,
  byoProblem,
  byoSignInProblem,
  byoSignInSummary,
  canSetUp,
  configFields,
  connectFailure,
  connectionRows,
  connectPayload,
  connectProblem,
  defaultServerName,
  errorCode,
  finishDefaults,
  methodTitle,
  needsLink,
  needsOwnOAuthClient,
  newByoDraft,
  newConnectDraft,
  recommendedMethod,
  SPECIAL_SETUP_APPS,
  toolMethods,
  vercelMethods,
  type AccessDraft,
  type ByoAuth,
  type ByoDraft,
  type ConnectDraft,
} from "./apps-model";
import { AgentAccessPicker, AppLogo, ChoiceCard, StateTag, useApplications, useConnections, useGallery, useRefreshTools } from "./shared";
import { channelMethod, chatConnectHref } from "./chat/chat-model";
import { AggregatorConnect } from "./setups/AggregatorConnect";
import { setupExtras, type GalleryExtras } from "./setups/SetupExtras";
import { isAggregator } from "./setups/setups-model";
import { isSheetsRobotMethod } from "./setups/extras-model";
import { NewPool } from "./pools/Pools";
import { CopyBlock } from "./advanced/parts";
import { MachineSignInSetup } from "./MachineSignIn";

/*
 * Connecting an app (the old UI's AppsConnect and ConnectionSetupFlow, on a page):
 *
 * - A gallery app (`/connections/connect?source=<slug>`): pick a way to connect when it has several, fill
 *   in its key and settings, and choose which agents may use it. Keys and keyless servers connect
 *   and turn on at once (`POST tools/apps/connect`, then `…/finish` with every discovered action on
 *   and the risky ones set to ask first). OAuth saves the choices, then leaves for the provider's
 *   sign-in; the server sends you back to the connection's page.
 * - Your own MCP server (`/connections/byo`): paste its address; Paperclip probes it, or you say how it
 *   signs in (a key, headers, browser sign-in with your own client ID, none, or machine sign-in for
 *   automation the organization owns: src/apps/MachineSignIn.tsx).
 * - Vercel Connect (`/connections/vercel-connect?source=<slug>`): the apps Vercel has reviewed, connected
 *   with a connector made in Vercel. Paperclip keeps only the connector's reference; the form asks
 *   for its UID instead of a key, address or OAuth app.
 * - `/connections/app/:applicationId`: an app the company has, with its accounts and a way to add one.
 *
 * Composio and Arcade have their own form (src/apps/setups/AggregatorConnect.tsx); chat apps
 * (AgentMail, Telegram…) go to their chat setup (src/apps/chat/); Google Workspace's services and
 * whose account a connection is come from src/apps/setups/SetupExtras.tsx.
 *
 * The agent instructions some apps come with, and Google Sheets' robot account, come from
 * src/apps/setups/AppExtras.tsx through SetupExtras. Paperclip Cloud sign-in hand-offs are refused
 * with a message.
 */

type ConnectOutcome = { kind: "done"; connectionId: string } | { kind: "redirect" };

/** Turns a connected app on (every action, the risky ones asking first) and saves who may use it. */
async function finishConnected(companyId: string, result: ConnectToolAppResult, access: AccessDraft, agentInstructions?: ConnectToolApp["agentInstructions"]) {
  const defaults = finishDefaults(result);
  await toolsApi.finishApp(companyId, result.connectionId, {
    enabledCatalogEntryIds: defaults.enabled,
    askFirstCatalogEntryIds: defaults.askFirst,
    ...(agentInstructions ? { agentInstructions } : {}),
    access: access.mode === "all" ? "all_agents" : { agentIds: [...access.agentIds] },
  });
  await toolsApi.putInstalls(result.connectionId, accessInstalls(companyId, access));
}

/** Connect, then finish or leave for sign-in. Shared by the gallery and your-own-server forms. */
function useConnectFlow(onFailure: (message: string, code: string | null) => void) {
  const company = useCompany();
  const navigate = useNavigate();
  const refresh = useRefreshTools();
  return createMutation(() => ({
    mutationFn: async (input: { payload: ConnectToolApp; access: AccessDraft }): Promise<ConnectOutcome> => {
      const result = await toolsApi.connectApp(company().id, input.payload);
      const installs = accessInstalls(company().id, input.access);
      if (result.auth?.kind === "oauth") {
        if (result.auth.manualClientRequired) {
          throw Object.assign(new Error("This server needs an OAuth client you register yourself."), {
            body: { details: { code: "oauth_manual_client_required" } },
          });
        }
        // Save who may use it before leaving, so the sign-in can't outrun the access choice.
        await toolsApi.putInstalls(result.connectionId, installs);
        const startUrl = result.auth.startUrl?.trim();
        const start = startUrl
          ? { authorizationUrl: startUrl, handoff: result.auth.handoff }
          : await toolsApi.startOAuth(result.connectionId, { asCurrentUser: result.connection.credentialPolicy === "per_user" });
        if (start.handoff) throw new Error("This app signs in through Paperclip Cloud, which this board can't hand off to yet.");
        window.location.assign(start.authorizationUrl);
        return { kind: "redirect" };
      }
      await finishConnected(company().id, result, input.access, input.payload.agentInstructions);
      return { kind: "done", connectionId: result.connectionId };
    },
    onSuccess: (outcome) => {
      void refresh();
      if (outcome.kind === "done") {
        pushToast({ title: "Connected", body: "Review its actions and who can use it.", tone: "success" });
        navigate(`/${company().issuePrefix}/connections/${outcome.connectionId}/permissions`);
      }
    },
    onError: (error) => {
      void refresh();
      const code = errorCode(error);
      onFailure(connectFailure(code, error instanceof Error ? error.message : null), code);
    },
  }));
}

// ---------------------------------------------------------------------------------------------

export function GalleryConnect(props: { source: string | null; resume: string | null; applicationId: string | null }) {
  const company = useCompany();
  const gallery = useGallery();
  const app = createMemo(() => gallery.data?.apps.find((entry) => entry.slug === props.source) ?? null);
  const methods = createMemo(() => (app() ? toolMethods(app()!).filter(canSetUp) : []));
  const isAi = () => Boolean(app()?.methods.length && app()!.methods.every((method) => method.purpose === "ai"));

  return (
    <Switch>
      <Match when={!props.source}>
        <Navigate href={`/${company().issuePrefix}/connections`} />
      </Match>
      <Match when={gallery.isPending}>
        <p class="ap-empty card" role="status">
          Loading the app…
        </p>
      </Match>
      <Match when={gallery.isError}>
        <div class="ap-empty card" role="alert">
          <p>Could not load the app gallery: {(gallery.error as Error).message}</p>
          <Button size="compact" onClick={() => void gallery.refetch()}>
            Retry
          </Button>
        </div>
      </Match>
      <Match when={app()?.aiConnectionRouter && app()} keyed>
        {(entry) => <NewPool app={entry} />}
      </Match>
      <Match when={isAi()}>
        <Navigate href={`/${company().issuePrefix}/connections/ai`} />
      </Match>
      <Match when={app() && methods().length === 0 && channelMethod(app()!)}>
        {(method) => <Navigate href={chatConnectHref(`/${company().issuePrefix}/connections`, method().provider)} />}
      </Match>
      <Match when={app() && isAggregator(app()!.slug) && app()}>
        {(entry) => <AggregatorConnect app={entry()} id={entry().slug as "composio" | "arcade"} resume={props.resume} />}
      </Match>
      <Match when={!app() || SPECIAL_SETUP_APPS.has(app()!.slug) || methods().length === 0}>
        <section class="card ap-later">
          <h2 class="disp">{app() ? `${app()!.name} can't be connected here yet` : "Unknown app"}</h2>
          <p>
            {app()
              ? "Its setup needs steps this board doesn't have yet. You can still connect it as your own MCP server if it has one."
              : `There's no app called "${props.source}" in this Paperclip's gallery.`}{" "}
            <A href={`/${company().issuePrefix}/connections`}>Back to Connections</A>
          </p>
        </section>
      </Match>
      {/* Keyed by slug: a gallery refetch (after a failed connect) must not reset the form. */}
      <Match when={app()?.slug} keyed>
        {(_slug) => (
          <GalleryForm app={app()!} methods={methods()} resume={props.resume} applicationId={props.applicationId} extras={(method) => setupExtras(app()!, method, { resume: props.resume })} />
        )}
      </Match>
    </Switch>
  );
}

// ---------------------------------------------------------------------------------------------

/** Vercel Connect: the reviewed apps, then one app's form with a Vercel connector for credentials. */
export function VercelConnect(props: { source: string | null; resume: string | null; applicationId: string | null }) {
  const company = useCompany();
  const base = () => `/${company().issuePrefix}/connections`;
  const gallery = useGallery();
  const availability = () => gallery.data?.credentialSources?.vercelConnect ?? null;
  const reviewed = createMemo(() => (gallery.data?.apps ?? []).filter((entry) => vercelMethods(entry).length > 0));
  const app = createMemo(() => reviewed().find((entry) => entry.slug === props.source) ?? null);
  // A connection already set up through Vercel can still be finished while new ones can't.
  const usable = () => availability()?.available === true || Boolean(props.resume);

  return (
    <Switch>
      <Match when={gallery.isPending}>
        <p class="ap-empty card" role="status">
          Loading the apps…
        </p>
      </Match>
      <Match when={gallery.isError}>
        <div class="ap-empty card" role="alert">
          <p>Could not load the app gallery: {(gallery.error as Error).message}</p>
          <Button size="compact" onClick={() => void gallery.refetch()}>
            Retry
          </Button>
        </div>
      </Match>
      <Match when={usable() ? app()?.slug : null} keyed>
        {(_slug) => (
          <GalleryForm
            app={app()!}
            methods={vercelMethods(app()!)}
            resume={props.resume}
            applicationId={props.applicationId}
            vercel={availability()}
            extras={(method) => setupExtras(app()!, method, { resume: props.resume, vercel: true })}
          />
        )}
      </Match>
      <Match when={props.source && !app()}>
        <section class="card ap-later">
          <h2 class="disp">This app can't connect through Vercel</h2>
          <p>
            Vercel Connect hasn't been reviewed for "{props.source}" in this Paperclip.{" "}
            <A href={`${base()}/connect?source=${encodeURIComponent(props.source!)}`}>Connect it directly</A>
          </p>
        </section>
      </Match>
      <Match when={true}>
        <section class="card ap-connect">
          <header class="ap-connect-head">
            <div class="ap-connect-title">
              <h2 class="disp">Connect through Vercel</h2>
              <p>Create and manage the provider connector in Vercel. Paperclip stores its reference and applies agent access, policy, approval and audit controls here.</p>
            </div>
            <Show when={availability()?.manageUrl}>
              {(url) => (
                <a class={buttonClass({ size: "compact", variant: "quiet" })} href={url()} target="_blank" rel="noopener noreferrer">
                  Open Vercel Connect
                  <ExternalLink size={13} aria-hidden="true" />
                </a>
              )}
            </Show>
          </header>
          <Show when={!usable()}>
            <p class="cx-note cx-note--warn" role="status">
              {availability()?.reason ?? "Vercel Connect is unavailable on this Paperclip."}
            </p>
          </Show>
          <Show when={reviewed().length > 0} fallback={<p class="cx-note">No apps in this Paperclip's gallery can connect through Vercel.</p>}>
            <ul class="ap-rows" aria-label="Apps Vercel can connect">
              <For each={reviewed()}>
                {(entry) => (
                  <li class="ap-row" classList={{ "ap-row--link": usable() }}>
                    <AppLogo app={entry} name={entry.name} />
                    <div class="ap-row-main">
                      <Show when={usable()} fallback={<span class="ap-row-name">{entry.name}</span>}>
                        <A class="ap-row-name" href={`${base()}/vercel-connect?source=${encodeURIComponent(entry.slug)}`}>
                          {entry.name}
                        </A>
                      </Show>
                      <span class="ap-row-meta">{entry.description}</span>
                    </div>
                  </li>
                )}
              </For>
            </ul>
          </Show>
        </section>
      </Match>
    </Switch>
  );
}

function GalleryForm(props: {
  app: AppDefinition;
  methods: ConnectionMethodDef[];
  resume: string | null;
  applicationId: string | null;
  /** Fields some apps add (src/apps/setups/): whose account it is, Google's services. */
  extras?: (method: () => ConnectionMethodDef | null) => GalleryExtras;
  /** Connecting through Vercel Connect: a connector reference instead of keys and sign-in. */
  vercel?: VercelConnectAvailability | null;
}) {
  const company = useCompany();
  const gallery = useGallery();
  const [methodKey, setMethodKey] = createSignal(recommendedMethod(props.methods)?.key ?? null);
  // Compared by key, so a refetched gallery doesn't count as a different method and clear the form.
  const method = createMemo(() => props.methods.find((candidate) => candidate.key === methodKey()) ?? null, null, {
    equals: (a, b) => a?.key === b?.key,
  });
  const extras = props.extras?.(method);
  const [draft, setDraft] = createStore<ConnectDraft>(newConnectDraft(props.app, method()));
  const [failure, setFailure] = createSignal<string | null>(null);
  const [ownClient, setOwnClient] = createSignal(false);
  const [connector, setConnector] = createSignal("");
  const viaVercel = props.vercel !== undefined;
  const canAll = () => gallery.data?.capabilities.canSetCompanyInstall !== false;

  // A different method has different fields: start them over, keeping the name and access.
  createEffect(
    on(method, (next) => {
      const fresh = newConnectDraft(props.app, next);
      setDraft(produce((d) => {
        d.credentials = {};
        d.config = fresh.config;
        d.link = "";
        d.oauthClientId = "";
        d.oauthClientSecret = "";
      }));
      setOwnClient(needsOwnOAuthClient(next));
      setFailure(null);
    }, { defer: true }),
  );
  createEffect(() => {
    if (!canAll() && draft.access.mode === "all") setDraft("access", { mode: "specific", agentIds: new Set() });
  });

  const flow = useConnectFlow(setFailure);
  const problem = () => connectProblem(method(), draft, viaVercel ? connector() : undefined) ?? extras?.problem() ?? null;
  const submit = (event: Event) => {
    event.preventDefault();
    const current = method();
    if (!current || problem()) return;
    setFailure(null);
    const withClient = ownClient() ? draft : { ...draft, oauthClientId: "", oauthClientSecret: "" };
    const payload = connectPayload(props.app, current, withClient, {
      applicationId: props.applicationId ?? undefined,
      resumeConnectionId: props.resume ?? undefined,
      ...(viaVercel ? { vercelConnector: connector() } : {}),
    });
    flow.mutate({
      payload: extras ? extras.apply(payload) : payload,
      access: draft.access,
    });
  };
  const fields = () => configFields(method());
  const standard = () => fields().filter((field) => !field.advanced);
  const advanced = () => fields().filter((field) => field.advanced);
  const signsIn = () => method()?.auth === "oauth";

  return (
    <form class="card ap-connect" onSubmit={submit}>
      <header class="ap-connect-head">
        <AppLogo app={props.app} name={props.app.name} size={48} />
        <div class="ap-connect-title">
          <h2 class="disp">
            {props.resume ? `Finish connecting ${props.app.name}` : `Connect ${props.app.name}`}
            {viaVercel ? " through Vercel" : ""}
          </h2>
          <p>{props.app.description}</p>
        </div>
        <Show when={props.app.docsUrl}>
          {(url) => (
            <a class={buttonClass({ size: "compact", variant: "quiet" })} href={url()} target="_blank" rel="noopener noreferrer">
              Docs
              <ExternalLink size={13} aria-hidden="true" />
            </a>
          )}
        </Show>
      </header>

      {/* Google's Developer Preview applies to its MCP servers, not the robot account. */}
      <Show when={isSheetsRobotMethod(props.app, method()) ? undefined : props.app.setupPrerequisite}>
        {(pre) => (
          <div class="cx-note cx-note--warn">
            <b>{pre().title}.</b> {pre().description}{" "}
            <a href={pre().actionUrl} target="_blank" rel="noopener noreferrer">
              {pre().actionLabel}
            </a>
          </div>
        )}
      </Show>

      <Show when={props.methods.length > 1}>
        <Field label="How to connect">
          <ul class="cx-options" role="radiogroup" aria-label="How to connect">
            <For each={props.methods}>
              {(candidate) => (
                <li>
                  <label class="cx-option ap-method" classList={{ "cx-option--on": candidate.key === methodKey() }}>
                    <input type="radio" name="ap-method" checked={candidate.key === methodKey()} onChange={() => setMethodKey(candidate.key)} />
                    <span class="ap-method-text">
                      <span class="cx-option-name">{methodTitle(props.app, candidate)}</span>
                      <span class="cx-option-note">{candidate.whenToUse}</span>
                    </span>
                  </label>
                </li>
              )}
            </For>
          </ul>
        </Field>
      </Show>

      <Show when={method()}>
        {(current) => (
          <>
            <Show when={current().guidanceMd}>
              <Markdown class="ap-guidance" source={current().guidanceMd} />
            </Show>
            <Show when={(current().warnings?.length ?? 0) > 0}>
              <ul class="ap-warnings">
                <For each={current().warnings}>{(warning) => <li>{warning}</li>}</For>
              </ul>
            </Show>

            <Field label="Name" for="ap-name" help="How this connection shows in Paperclip.">
              <TextInput id="ap-name" value={draft.name} maxLength={160} onInput={(event) => setDraft("name", event.currentTarget.value)} />
            </Field>

            <Show when={viaVercel}>
              <div class="ap-oauth-client">
                <p class="cx-note">
                  Paperclip doesn't copy Vercel's setup forms. Create or attach the connector in Vercel, then paste its UID here.
                  <Show when={props.vercel?.manageUrl}>
                    {(url) => (
                      <>
                        {" "}
                        <a href={url()} target="_blank" rel="noopener noreferrer">
                          Open Vercel Connect
                        </a>
                      </>
                    )}
                  </Show>
                </p>
                <Field label="Connector UID or ID" for="ap-vercel-connector" help="Paperclip checks the connector and keeps only its reference and redacted verification details.">
                  <TextInput
                    id="ap-vercel-connector"
                    class="mono"
                    autocomplete="off"
                    placeholder="service/my-connector or scl_…"
                    value={connector()}
                    onInput={(event) => setConnector(event.currentTarget.value)}
                  />
                </Field>
              </div>
            </Show>

            <Show when={!viaVercel && needsLink(current())}>
              <Field label="Server address" for="ap-link" help="The full MCP address the provider gave you. Paperclip keeps it as a secret.">
                <TextInput
                  id="ap-link"
                  type="url"
                  placeholder="https://"
                  autocomplete="off"
                  value={draft.link}
                  onInput={(event) => setDraft("link", event.currentTarget.value)}
                />
              </Field>
            </Show>

            <For each={viaVercel ? [] : (current().credentialFields ?? [])}>
              {(field) => (
                <FieldInput
                  field={field}
                  secret
                  value={draft.credentials[field.key] ?? ""}
                  onChange={(value) => setDraft("credentials", field.key, String(value))}
                  link={current().consoleLinks?.keys}
                />
              )}
            </For>
            <For each={standard()}>
              {(field) => <FieldInput field={field} value={draft.config[field.key] ?? ""} onChange={(value) => setDraft("config", field.key, value)} />}
            </For>
            <Show when={advanced().length > 0}>
              <details class="ap-more">
                <summary>More settings</summary>
                <div class="ap-more-body">
                  <For each={advanced()}>
                    {(field) => <FieldInput field={field} value={draft.config[field.key] ?? ""} onChange={(value) => setDraft("config", field.key, value)} />}
                  </For>
                </div>
              </details>
            </Show>

            <Show when={!viaVercel && acceptsOwnOAuthClient(current())}>
              <Show
                when={ownClient()}
                fallback={
                  <button type="button" class="cx-link" onClick={() => setOwnClient(true)}>
                    Use your own {props.app.name} OAuth app
                  </button>
                }
              >
                <div class="ap-oauth-client">
                  <p class="cx-note">
                    Register Paperclip as an OAuth app with {props.app.name}
                    <Show when={current().consoleLinks?.register}>
                      {(url) => (
                        <>
                          {" "}
                          (
                          <a href={url()} target="_blank" rel="noopener noreferrer">
                            open its console
                          </a>
                          )
                        </>
                      )}
                    </Show>
                    , with this callback address:
                  </p>
                  <Show when={gallery.data?.oauthCallbackUrl} fallback={<p class="cx-note cx-note--error">This Paperclip has no public address for sign-in callbacks.</p>}>
                    {(url) => <code class="ap-code mono">{url()}</code>}
                  </Show>
                  <Field label="Client ID" for="ap-client-id">
                    <TextInput id="ap-client-id" autocomplete="off" value={draft.oauthClientId} onInput={(event) => setDraft("oauthClientId", event.currentTarget.value)} />
                  </Field>
                  <Field label={current().oauthClientSecretRequired ? "Client secret" : "Client secret (if it has one)"} for="ap-client-secret">
                    <TextInput
                      id="ap-client-secret"
                      type="password"
                      autocomplete="new-password"
                      value={draft.oauthClientSecret}
                      onInput={(event) => setDraft("oauthClientSecret", event.currentTarget.value)}
                    />
                  </Field>
                  <Show when={!needsOwnOAuthClient(current())}>
                    <button type="button" class="cx-link" onClick={() => setOwnClient(false)}>
                      Let Paperclip register itself instead
                    </button>
                  </Show>
                </div>
              </Show>
            </Show>

            {extras?.element}

            <Field label="Which agents can use it">
              <AgentAccessPicker
                value={draft.access}
                onChange={(next) => setDraft("access", next)}
                disabled={flow.isPending}
                allDescription={
                  canAll()
                    ? "Current and future agents can use it, and carry its tools on every run."
                    : (gallery.data?.capabilities.companyInstallReason ?? "Only a connection manager can give every agent access.")
                }
              />
            </Field>
          </>
        )}
      </Show>

      <Show when={failure()}>
        {(text) => (
          <p class="cx-note cx-note--error" role="alert">
            {text()}
          </p>
        )}
      </Show>
      <div class="cx-actions">
        <A class={buttonClass({ variant: "quiet" })} href={`/${company().issuePrefix}/connections`}>
          Cancel
        </A>
        <span class="ap-actions-end">
          <Show when={problem() && method()}>
            <span class="cx-note">{problem()}</span>
          </Show>
          <Button type="submit" variant="primary" disabled={Boolean(problem()) || flow.isPending}>
            {flow.isPending
              ? viaVercel
                ? "Checking…"
                : signsIn()
                  ? "Opening sign-in…"
                  : "Connecting…"
              : viaVercel
                ? signsIn()
                  ? "Validate and continue"
                  : "Validate and connect"
                : signsIn()
                  ? `Sign in with ${props.app.name}`
                  : "Connect"}
          </Button>
        </span>
      </div>
    </form>
  );
}

/** One field from an app's definition: text, password, textarea, select or checkbox. */
function FieldInput(props: { field: FieldDef; value: string | boolean; onChange: (value: string | boolean) => void; secret?: boolean; link?: string }) {
  const id = () => `ap-field-${props.field.key}`;
  const help = () => (
    <>
      {props.field.helperMd ? <Markdown class="ap-field-help" source={props.field.helperMd} /> : null}
      <Show when={props.link}>
        {(url) => (
          <a href={url()} target="_blank" rel="noopener noreferrer">
            Get a key
          </a>
        )}
      </Show>
    </>
  );
  const label = () => `${props.field.label}${props.field.required ? "" : " (optional)"}`;
  return (
    <Switch>
      <Match when={props.field.type === "checkbox"}>
        <label class="ap-check">
          <input type="checkbox" checked={props.value === true || props.value === "true"} onChange={(event) => props.onChange(event.currentTarget.checked)} />
          <span>{props.field.label}</span>
        </label>
      </Match>
      <Match when={props.field.type === "select"}>
        <Field label={label()} for={id()} help={help()}>
          <select id={id()} class="input" value={String(props.value)} onChange={(event) => props.onChange(event.currentTarget.value)}>
            <option value="">Choose…</option>
            <For each={props.field.options ?? []}>{(option) => <option value={option.value}>{option.label}</option>}</For>
          </select>
        </Field>
      </Match>
      <Match when={props.field.type === "textarea"}>
        <Field label={label()} for={id()} help={help()}>
          <TextArea id={id()} rows={4} placeholder={props.field.placeholder} value={String(props.value)} onInput={(event) => props.onChange(event.currentTarget.value)} />
        </Field>
      </Match>
      <Match when={true}>
        <Field label={label()} for={id()} help={help()}>
          <TextInput
            id={id()}
            type={props.secret || props.field.type === "password" || props.field.secret ? "password" : props.field.type === "datetime" ? "datetime-local" : "text"}
            autocomplete={props.secret || props.field.secret ? "new-password" : "off"}
            placeholder={props.field.placeholder}
            maxLength={props.field.validation?.maxLength}
            value={String(props.value)}
            onInput={(event) => props.onChange(event.currentTarget.value)}
          />
        </Field>
      </Match>
    </Switch>
  );
}

// ---------------------------------------------------------------------------------------------

/** Extra guidance for an option's fields, behind the option's "i" with its description. */
const SIGN_IN_TIPS: Partial<Record<ByoAuth, string>> = {
  bearer: "Grant the key access to what your agents need. Paperclip can't increase its permissions.",
  custom_headers: "Values are stored as secrets and can't be read back.",
};

const MACHINE_TIP =
  "Your organization's automation signs in as its own registered client, so no person signs in. For connections shared with the organization, which this one is.";

/*
 * Your own MCP server (`/connections/byo`), after upstream #21469's sign-in step: the address alone
 * is the default path. How the server signs in is a stated default with Change; the choices are
 * radio cards with each one's fields right below it, and the choice stays open while the picked
 * option still needs something typed, so a disabled Connect always has its reason on screen.
 * Machine sign-in (MachineSignIn.tsx) is a sixth choice with its own footer: it creates a draft,
 * then tests it, instead of connecting at once.
 */
export function ByoConnect() {
  const company = useCompany();
  const navigate = useNavigate();
  const refresh = useRefreshTools();
  const gallery = useGallery();
  const [draft, setDraft] = createStore<ByoDraft>(newByoDraft());
  const [failure, setFailure] = createSignal<string | null>(null);
  const [choosing, setChoosing] = createSignal(false);
  const [clientFields, setClientFields] = createSignal(false);
  const [machine, setMachine] = createSignal(false);
  const [machineSetup, setMachineSetup] = createSignal<MachineSignInSetupResult | null>(null);
  const flow = useConnectFlow((message, code) => {
    setFailure(message);
    // The server's answer says where to look: the key, or a client you register yourself.
    const focus = byoFailureFocus(code);
    if (focus === "key") {
      if (draft.auth === "auto") setDraft("needsKey", true);
      setChoosing(true);
    } else if (focus === "client") {
      setDraft(byoAuthChange(draft, "oauth"));
      setClientFields(true);
      setChoosing(true);
    }
  });
  const problem = () => byoProblem(draft);
  const needsInput = () => !machine() && (draft.auth === "bearer" || draft.auth === "custom_headers") && Boolean(byoSignInProblem(draft));
  const expanded = () => choosing() || needsInput() || machine();
  const showClientFields = () => clientFields() || Boolean(draft.oauthClientId.trim() || draft.oauthClientSecret.trim());
  const base = () => `/${company().issuePrefix}/connections`;

  const pick = (auth: ByoAuth) => {
    setMachine(false);
    setFailure(null);
    setDraft(byoAuthChange(draft, auth));
  };
  const submit = (event: Event) => {
    event.preventDefault();
    if (machine() || problem()) return;
    setFailure(null);
    flow.mutate({ payload: byoPayload(draft), access: draft.access });
  };
  const machineConnected = async (result: ConnectToolAppResult) => {
    await finishConnected(company().id, result, draft.access);
    void refresh();
    pushToast({ title: "Connected", body: "Machine sign-in works. Review its actions and who can use it.", tone: "success" });
    navigate(`${base()}/${result.connectionId}/permissions`);
  };

  const keyInput = (id: string, label: string) => (
    <TextInput id={id} aria-label={label} type="password" autocomplete="new-password" placeholder="Paste the key or token" value={draft.key} onInput={(event) => setDraft("key", event.currentTarget.value)} />
  );
  const accessField = () => (
    <Field label="Which agents can use it">
      <AgentAccessPicker
        value={draft.access}
        onChange={(next) => setDraft("access", next)}
        disabled={flow.isPending}
        allDescription="Current and future agents can use it, and carry its tools on every run."
      />
    </Field>
  );

  const optionFields = (auth: ByoAuth): JSX.Element => (
    <Switch>
      <Match when={auth === "bearer"}>{keyInput("ap-byo-key", "Key or token")}</Match>
      <Match when={auth === "custom_headers"}>
        <div class="ap-headers" role="group" aria-label="Headers">
          <Index each={draft.headers}>
            {(row, index) => (
              <div class="ap-header-row">
                <TextInput
                  aria-label={`Header ${index + 1} name`}
                  placeholder="X-API-Key"
                  autocomplete="off"
                  spellcheck={false}
                  value={row().name}
                  onInput={(event) => setDraft("headers", index, "name", event.currentTarget.value)}
                />
                <TextInput
                  aria-label={`Header ${index + 1} value`}
                  type="password"
                  autocomplete="new-password"
                  placeholder="Value"
                  value={row().value}
                  onInput={(event) => setDraft("headers", index, "value", event.currentTarget.value)}
                />
                <Button
                  variant="icon"
                  size="compact"
                  aria-label={`Remove header ${index + 1}`}
                  disabled={draft.headers.length === 1}
                  onClick={() => setDraft("headers", (rows) => rows.filter((_, i) => i !== index))}
                >
                  <Trash2 size={14} aria-hidden="true" />
                </Button>
              </div>
            )}
          </Index>
          <div>
            <Button size="compact" variant="quiet" icon={<Plus size={14} aria-hidden="true" />} onClick={() => setDraft("headers", (rows) => [...rows, { name: "", value: "" }])}>
              Add a header
            </Button>
          </div>
        </div>
      </Match>
      <Match when={auth === "oauth" && !showClientFields()}>
        <button type="button" class="ap-signin-link" onClick={() => setClientFields(true)}>
          Use your own client ID
        </button>
      </Match>
      <Match when={auth === "oauth"}>
        <div class="ap-oauth-client">
          <span class="info-line">
            <b>Your own client ID</b>
            <InfoTip label="About your own client ID">
              Paperclip sets sign-in up by itself whenever the server allows it. Fill these in only when the server's docs tell you to register Paperclip yourself first, using
              this callback address.
            </InfoTip>
          </span>
          <Show when={gallery.data?.oauthCallbackUrl} fallback={<p class="cx-note cx-note--error">This Paperclip has no public address for sign-in callbacks.</p>}>
            {(url) => <CopyBlock value={url()} label="Callback address" inline />}
          </Show>
          <div class="ap-signin-pair">
            <Field label="Client ID" for="ap-byo-client">
              <TextInput id="ap-byo-client" autocomplete="off" spellcheck={false} placeholder="Optional" value={draft.oauthClientId} onInput={(event) => setDraft("oauthClientId", event.currentTarget.value)} />
            </Field>
            <Field label="Client secret" for="ap-byo-secret">
              <TextInput
                id="ap-byo-secret"
                type="password"
                autocomplete="new-password"
                placeholder="Optional"
                value={draft.oauthClientSecret}
                onInput={(event) => setDraft("oauthClientSecret", event.currentTarget.value)}
              />
            </Field>
          </div>
        </div>
      </Match>
    </Switch>
  );

  return (
    <form class="card ap-connect" onSubmit={submit}>
      <header class="ap-connect-head">
        <div class="ap-connect-title">
          <span class="info-line">
            <h2 class="disp">Connect your own MCP server</h2>
            <InfoTip label="About connecting your own MCP server">
              Any remote MCP server reachable from this Paperclip. You choose which of its tools agents may use once it's connected.
            </InfoTip>
          </span>
        </div>
      </header>

      <Field label="Server address" for="ap-byo-link" help={machineSetup() ? "Its machine sign-in draft is tied to this address. Start over to change it." : undefined}>
        <TextInput
          id="ap-byo-link"
          type="url"
          placeholder="https://mcp.example.com/mcp"
          autocomplete="off"
          disabled={Boolean(machineSetup())}
          value={draft.link}
          onInput={(event) => setDraft("link", event.currentTarget.value)}
        />
      </Field>
      <Field label="Name (optional)" for="ap-byo-name">
        <TextInput
          id="ap-byo-name"
          maxLength={160}
          placeholder={defaultServerName(draft.link.trim()) ?? ""}
          disabled={Boolean(machineSetup())}
          value={draft.name}
          onInput={(event) => setDraft("name", event.currentTarget.value)}
        />
      </Field>

      {/* The server's own check asked for a key: it shows now, rather than as a guess beforehand. */}
      <Show when={!machine() && draft.auth === "auto" && draft.needsKey}>
        <Field label="App key" for="ap-byo-app-key">
          {keyInput("ap-byo-app-key", "App key")}
        </Field>
      </Show>

      <section class="ap-signin" aria-label="Sign-in">
        <div class="ap-signin-line">
          <span class="ap-signin-summary">{expanded() ? "How does this server sign in?" : byoSignInSummary(draft)}</span>
          <button
            type="button"
            class="ap-signin-change"
            data-testid="byo-sign-in-toggle"
            aria-expanded={expanded()}
            disabled={flow.isPending || needsInput() || machine()}
            onClick={() => setChoosing(!expanded())}
          >
            {expanded() ? "Done" : "Change"}
          </button>
        </div>
        <Show when={expanded()}>
          <ul class="ap-signin-options" role="radiogroup" aria-label="How this server signs in">
            <For each={BYO_SIGN_IN_OPTIONS}>
              {(option) => {
                const on = () => !machine() && draft.auth === option.value;
                return (
                  <li>
                    <ChoiceCard
                      name="ap-byo-auth"
                      title={option.title}
                      info={`${option.description}${SIGN_IN_TIPS[option.value] ? ` ${SIGN_IN_TIPS[option.value]}` : ""}`}
                      checked={on()}
                      disabled={flow.isPending}
                      onSelect={() => pick(option.value)}
                    />
                    <Show when={on() && option.value !== "auto" && option.value !== "none"}>
                      <div class="ap-signin-fields">{optionFields(option.value)}</div>
                    </Show>
                  </li>
                );
              }}
            </For>
            <li>
              <ChoiceCard
                name="ap-byo-auth"
                title="Machine sign-in"
                info={MACHINE_TIP}
                checked={machine()}
                disabled={flow.isPending}
                onSelect={() => {
                  setMachine(true);
                  setFailure(null);
                }}
              />
            </li>
          </ul>
        </Show>
      </section>

      <Show
        when={machine()}
        fallback={
          <>
            {accessField()}
            <Show when={failure()}>
              {(text) => (
                <p class="cx-note cx-note--error" role="alert">
                  {text()}
                </p>
              )}
            </Show>
            <div class="cx-actions">
              <A class={buttonClass({ variant: "quiet" })} href={base()}>
                Cancel
              </A>
              <span class="ap-actions-end">
                <Show when={problem() && draft.link.trim()}>
                  <span class="cx-note">{problem()}</span>
                </Show>
                <Button type="submit" variant="primary" disabled={Boolean(problem()) || flow.isPending}>
                  {flow.isPending ? "Checking the server…" : "Connect"}
                </Button>
              </span>
            </div>
          </>
        }
      >
        <MachineSignInSetup
          link={draft.link}
          name={draft.name}
          setup={machineSetup()}
          onSetup={setMachineSetup}
          onConnected={machineConnected}
          access={accessField()}
          cancelHref={base()}
        />
      </Show>
    </form>
  );
}

// ---------------------------------------------------------------------------------------------

/** An app the company has (`/connections/app/:applicationId`): its accounts, and a way to add one. */
export function ApplicationPage(props: { applicationId: string }) {
  const company = useCompany();
  const base = () => `/${company().issuePrefix}/connections`;
  const applications = useApplications();
  const connections = useConnections();
  const gallery = useGallery();
  const application = () => applications.data?.applications.find((entry) => entry.id === props.applicationId) ?? null;
  const rows = createMemo(() =>
    connectionRows(
      (connections.data?.connections ?? []).filter((connection) => connection.applicationId === props.applicationId),
      applications.data?.applications ?? [],
      gallery.data?.apps ?? [],
    ),
  );
  const app = () => rows()[0]?.app ?? gallery.data?.apps.find((entry) => application()?.applicationKey === `app-gallery:${entry.slug}`) ?? null;
  const addHref = () =>
    app() ? `${base()}/connect?source=${encodeURIComponent(app()!.slug)}&applicationId=${encodeURIComponent(props.applicationId)}` : `${base()}/byo`;

  return (
    <Switch>
      <Match when={applications.isPending}>
        <p class="ap-empty card" role="status">
          Loading the app…
        </p>
      </Match>
      <Match when={!application()}>
        <section class="card ap-later">
          <h2 class="disp">App not found</h2>
          <p>
            It may have been removed. <A href={base()}>Back to Connections</A>
          </p>
        </section>
      </Match>
      <Match when={application()}>
        {(entry) => (
          <section class="card ap-connect">
            <header class="ap-connect-head">
              <AppLogo app={app()} name={entry().name} size={48} />
              <div class="ap-connect-title">
                <h2 class="disp">{entry().name}</h2>
                <p>{entry().description ?? app()?.description ?? "An app this company has added."}</p>
              </div>
              <A class={buttonClass({ variant: "primary", size: "compact" })} href={addHref()}>
                {rows().length > 0 ? "Add account" : "Connect"}
              </A>
            </header>
            <Show when={rows().length > 0} fallback={<p class="cx-note">No accounts are connected for this app.</p>}>
              <ul class="ap-rows">
                <For each={rows()}>
                  {(row) => (
                    <li class="ap-row ap-row--link">
                      <AppLogo app={row.app} name={row.name} />
                      <div class="ap-row-main">
                        <A class="ap-row-name" href={`${base()}/${row.connection.id}/permissions`}>
                          {row.name}
                        </A>
                      </div>
                      <StateTag state={row.state} />
                    </li>
                  )}
                </For>
              </ul>
            </Show>
          </section>
        )}
      </Match>
    </Switch>
  );
}
