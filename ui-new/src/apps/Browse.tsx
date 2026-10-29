import { A } from "@solidjs/router";
import { createQuery } from "@tanstack/solid-query";
import { ArrowRight, Mail, Search, ShieldQuestion } from "lucide-solid";
import { createMemo, createSignal, For, Match, Show, Switch } from "solid-js";
import { queryKeys } from "@/api/queryKeys";
import { toolsApi } from "@/api/tools";
import { useCompany } from "@/lib/company";
import { useAgentsQuery, useExperimentalSettingsQuery } from "@/lib/company-data";
import { Button, buttonClass } from "@/ui/Button";
import { TextInput } from "@/ui/Field";
import {
  CATEGORY_LABELS,
  categoriesIn,
  connectionCounts,
  connectionGroup,
  connectionRows,
  galleryApps,
  hostedAt,
  matchesApp,
  type AppCategory,
  type ConnectionRow,
} from "./apps-model";
import { AppLogo, StateTag, useApplications, useConnections, useGallery, usePendingRequests } from "./shared";
import { ChatEndpointGroup } from "./chat/ChatRoutes";
import { poolPluginKey } from "./pools/pool-model";
import { chatConnectHref, galleryChatProvider, withChatApps } from "./chat/chat-model";

/*
 * Browse (`/apps`): the company's connections, then the gallery. Connections are grouped as the old
 * UI's landing page groups them: tools and MCP servers, AI accounts (managed in AI connections),
 * chat endpoints when the instance has `enableChatConnectors` on, and email inboxes. Each opens its
 * own page. The gallery lists the apps ui-new can connect, searchable and by category.
 */

export function Browse() {
  const company = useCompany();
  const base = () => `/${company().issuePrefix}/apps`;
  const gallery = useGallery();
  const connections = useConnections();
  const applications = useApplications();
  const pending = usePendingRequests();
  const inboxes = createQuery(() => ({
    queryKey: queryKeys.tools.emailInboxes(company().id),
    queryFn: ({ signal }) => toolsApi.emailInboxes(company().id, signal),
    retry: false,
  }));
  const agents = useAgentsQuery();
  const agentName = (id: string) => agents.data?.find((agent) => agent.id === id)?.name ?? "an agent";

  const rows = createMemo(() =>
    connectionRows(connections.data?.connections ?? [], applications.data?.applications ?? [], gallery.data?.apps ?? []),
  );
  const tools = () => rows().filter((row) => connectionGroup(row.connection) === "tools");
  const ai = () => rows().filter((row) => connectionGroup(row.connection) === "ai");
  const counts = createMemo(() => connectionCounts(rows()));
  const pendingCount = () => pending.data?.actionRequests.length ?? 0;

  return (
    <>
      <Show when={pendingCount() > 0}>
        <A class="card ap-banner" href={`${base()}/review`}>
          <ShieldQuestion size={18} aria-hidden="true" />
          <span>
            <b>{pendingCount()}</b> {pendingCount() === 1 ? "app call is" : "app calls are"} waiting for your OK
          </span>
          <ArrowRight size={16} aria-hidden="true" />
        </A>
      </Show>

      <section class="card ap-card" aria-labelledby="ap-yours">
        <header class="chead ap-chead">
          <div>
            <h3 id="ap-yours" class="disp">
              Your connections
            </h3>
            <p>Apps, MCP servers and accounts your agents can use.</p>
          </div>
          <A class={buttonClass({ size: "compact" })} href={`${base()}/byo`}>
            Connect your own server
          </A>
        </header>
        <Switch>
          <Match when={connections.isPending}>
            <p class="ap-empty" role="status">
              Loading connections…
            </p>
          </Match>
          <Match when={connections.isError}>
            <div class="ap-empty" role="alert">
              <p>Could not load connections: {(connections.error as Error).message}</p>
              <Button size="compact" onClick={() => void connections.refetch()}>
                Retry
              </Button>
            </div>
          </Match>
          <Match when={rows().length === 0 && (inboxes.data?.length ?? 0) === 0}>
            <p class="ap-empty">Nothing connected yet. Pick an app below, or connect your own MCP server.</p>
          </Match>
          <Match when={true}>
            <ConnectionGroup title="Tools and MCP servers" rows={tools()} base={base()} />
            <ConnectionGroup title="AI accounts" rows={ai()} base={base()} hrefFor={(row) => (poolPluginKey(row.connection) ? `${base()}/${row.connection.id}/permissions` : `${base()}/ai`)} note="Managed in AI connections." />
            <ChatEndpointGroup />
            <Show when={(inboxes.data?.length ?? 0) > 0}>
              <div class="ap-group">
                <h4 class="ap-group-title">Email inboxes</h4>
                <ul class="ap-rows">
                  <For each={inboxes.data}>
                    {(inbox) => (
                      <li class="ap-row">
                        <span class="ap-logo ap-logo--icon" aria-hidden="true">
                          <Mail size={18} />
                        </span>
                        <div class="ap-row-main">
                          <A class="ap-row-name" href={`${base()}/chat/${inbox.id}/settings`}>{inbox.address ?? "Inbox being set up"}</A>
                          <span class="ap-row-meta">
                            Answered by {agentName(inbox.assignedAgentId)} · {inbox.receiveMode === "webhook" ? "Webhook" : "Live connection"}
                            {inbox.lastError ? ` · ${inbox.lastError}` : ""}
                          </span>
                        </div>
                        <span class="ap-state" classList={{ "ap-state--connected": inbox.status === "active", "ap-state--attention": inbox.status !== "active" }}>
                          <i aria-hidden="true" />
                          {inbox.status === "active" ? "Connected" : inbox.status.replace(/_/g, " ")}
                        </span>
                      </li>
                    )}
                  </For>
                </ul>
              </div>
            </Show>
          </Match>
        </Switch>
      </section>

      <Gallery counts={counts()} />
    </>
  );
}

function ConnectionGroup(props: { title: string; rows: ConnectionRow[]; base: string; hrefFor?: (row: ConnectionRow) => string; note?: string }) {
  return (
    <Show when={props.rows.length > 0}>
      <div class="ap-group">
        <h4 class="ap-group-title">
          {props.title}
          <Show when={props.note}>
            <span>{props.note}</span>
          </Show>
        </h4>
        <ul class="ap-rows">
          <For each={props.rows}>
            {(row) => {
              const href = () => props.hrefFor?.(row) ?? `${props.base}/${row.connection.id}/permissions`;
              const meta = () =>
                [row.app?.name !== row.name ? row.app?.name : null, hostedAt(row.connection) && !row.app ? hostedAt(row.connection) : null, row.state.message]
                  .filter(Boolean)
                  .join(" · ");
              return (
                <li class="ap-row ap-row--link">
                  <AppLogo app={row.app} name={row.name} />
                  <div class="ap-row-main">
                    <A class="ap-row-name" href={href()}>
                      {row.name}
                    </A>
                    <Show when={meta()}>
                      <span class="ap-row-meta">{meta()}</span>
                    </Show>
                  </div>
                  <StateTag state={row.state} />
                </li>
              );
            }}
          </For>
        </ul>
      </div>
    </Show>
  );
}

function Gallery(props: { counts: Map<string, number> }) {
  const company = useCompany();
  const base = () => `/${company().issuePrefix}/apps`;
  const gallery = useGallery();
  const flags = useExperimentalSettingsQuery();
  const [query, setQuery] = createSignal("");
  const [category, setCategory] = createSignal<AppCategory | null>(null);
  const apps = createMemo(() => withChatApps(galleryApps(gallery.data?.apps ?? [], flags.data), gallery.data?.apps ?? [], flags.data));
  const categories = createMemo(() => categoriesIn(apps()));
  const shown = createMemo(() => apps().filter((app) => matchesApp(app, query(), category())));

  return (
    <section class="card ap-card" aria-labelledby="ap-gallery">
      <header class="chead ap-chead">
        <div>
          <h3 id="ap-gallery" class="disp">
            Connect an app
          </h3>
          <p>Give agents tools from the apps you use. You choose which agents may use each one, and which actions ask you first.</p>
        </div>
      </header>
      <div class="ap-filters">
        <label class="ap-search">
          <Search size={15} aria-hidden="true" />
          <TextInput
            type="search"
            placeholder="Search apps"
            aria-label="Search apps"
            value={query()}
            onInput={(event) => setQuery(event.currentTarget.value)}
          />
        </label>
        <div class="ap-chips" role="group" aria-label="Category">
          <button type="button" class="ap-chip" aria-pressed={category() === null} onClick={() => setCategory(null)}>
            All
          </button>
          <For each={categories()}>
            {(value) => (
              <button type="button" class="ap-chip" aria-pressed={category() === value} onClick={() => setCategory(category() === value ? null : value)}>
                {CATEGORY_LABELS[value]}
              </button>
            )}
          </For>
        </div>
      </div>
      <Switch>
        <Match when={gallery.isPending}>
          <p class="ap-empty" role="status">
            Loading apps…
          </p>
        </Match>
        <Match when={gallery.isError}>
          <div class="ap-empty" role="alert">
            <p>Could not load the app gallery: {(gallery.error as Error).message}</p>
            <Button size="compact" onClick={() => void gallery.refetch()}>
              Retry
            </Button>
          </div>
        </Match>
        <Match when={shown().length === 0}>
          <p class="ap-empty">No apps match. Try another word, or connect your own MCP server.</p>
        </Match>
        <Match when={true}>
          <ul class="ap-grid">
            <For each={shown()}>
              {(app) => {
                const count = () => props.counts.get(app.slug) ?? 0;
                const unavailable = () => app.availability?.available === false;
                return (
                  <li class="ap-tile">
                    <div class="ap-tile-head">
                      <AppLogo app={app} name={app.name} size={40} />
                      <div class="ap-tile-title">
                        <span class="ap-tile-name">{app.name}</span>
                        <Show when={count() > 0}>
                          <span class="ap-tile-count">{count() === 1 ? "Connected" : `${count()} accounts`}</span>
                        </Show>
                      </div>
                    </div>
                    <p class="ap-tile-desc">{app.description}</p>
                    <Show
                      when={!unavailable()}
                      fallback={
                        <span class="ap-tile-off" title={app.availability?.reason}>
                          {app.availability?.reason ?? "Unavailable on this instance"}
                        </span>
                      }
                    >
                      <A class={buttonClass({ size: "compact" })} href={galleryChatProvider(app, flags.data) ? chatConnectHref(base(), galleryChatProvider(app, flags.data)!) : `${base()}/connect?source=${encodeURIComponent(app.slug)}`}>
                        {count() > 0 ? "Add account" : "Connect"}
                      </A>
                    </Show>
                  </li>
                );
              }}
            </For>
          </ul>
        </Match>
      </Switch>
    </section>
  );
}
