import { A, Navigate, useLocation, useParams } from "@solidjs/router";
import { createMemo, Match, Show, Switch } from "solid-js";
import { isCompact } from "@/layout/breakpoints";
import { useCompany } from "@/lib/company";
import { OrgHeader } from "@/org/OrgHeader";
import { AiConnections } from "./AiConnections";
import { AppDetail } from "./AppDetail";
import { appsView, type AppsView } from "./apps-model";
import { Browse } from "./Browse";
import { ApplicationPage, ByoConnect, GalleryConnect } from "./Connect";
import { ReviewPage } from "./Review";
import { usePendingRequests } from "./shared";
import "@/activity/Activity.css";
import "@/connectors/Connectors.css";
import "./Apps.css";

/*
 * `/:prefix/apps/*`, the organization's Apps tab (Tier 2, the old UI's Apps and tools pages):
 *
 * - Browse (`/apps`): your connections, then the gallery of apps to connect.
 * - AI connections (`/apps/ai`): the accounts agents run on. This was the temporary Connectors page
 *   (decision 23); `/connectors` sends you here.
 * - Review (`/apps/review`): Ask-first app calls waiting for your OK.
 * - Connect (`/apps/connect?source=…`, `/apps/byo`, `/apps/app/:applicationId`): a gallery app, your
 *   own MCP server, or one more account for an app you have.
 * - A connection (`/apps/:connectionId/:tab`): its tools and who may use them, its review queue, and
 *   its settings.
 *
 * The old UI's assistant connection, gateways, advanced (tool profiles, custom servers) and chat
 * endpoint pages aren't here yet; their addresses say so.
 */

/** `/:prefix/connectors`, the temporary Connectors page's address: its content is AI connections now. */
export function ConnectorsRedirect() {
  const company = useCompany();
  return <Navigate href={`/${company().issuePrefix}/apps/ai`} />;
}

export function AppsPage() {
  const params = useParams<{ rest?: string }>();
  const location = useLocation();
  const company = useCompany();
  const base = () => `/${company().issuePrefix}/apps`;
  const view = createMemo(() => appsView(params.rest ?? ""));
  const pending = usePendingRequests();
  const pendingCount = () => pending.data?.actionRequests.length ?? 0;
  const pick = <S extends AppsView["section"]>(name: S) => {
    const current = view();
    return current.section === name ? (current as Extract<AppsView, { section: S }>) : null;
  };
  const redirect = createMemo(() => pick("redirect"));
  const detail = createMemo(() => pick("detail"));
  const application = createMemo(() => pick("application"));
  const later = createMemo(() => pick("later"));
  const tab = () => {
    const section = view().section;
    // A connection and the connect pages sit under Browse, where they're reached from.
    return section === "ai" || section === "review" ? section : section === "later" ? null : "browse";
  };
  const search = () => new URLSearchParams(location.search);
  const target = (to: string) => (to.startsWith("/") ? `/${company().issuePrefix}${to}` : `${base()}${to ? `/${to}` : ""}`);

  return (
    <Show when={!redirect()} fallback={<Navigate href={target(redirect()!.to)} />}>
      <div class="org-page act-page ap-page">
        <Show when={!isCompact()} fallback={<h1 class="org-phone-title disp">Apps</h1>}>
          <OrgHeader />
        </Show>
        <nav class="act-subnav" aria-label="Apps">
          <A href={base()} activeClass="" inactiveClass="" classList={{ active: tab() === "browse" }} aria-current={tab() === "browse" ? "page" : undefined}>
            Browse
          </A>
          <A href={`${base()}/ai`} activeClass="" inactiveClass="" classList={{ active: tab() === "ai" }} aria-current={tab() === "ai" ? "page" : undefined}>
            AI connections
          </A>
          <A href={`${base()}/review`} activeClass="" inactiveClass="" classList={{ active: tab() === "review" }} aria-current={tab() === "review" ? "page" : undefined}>
            Review
            <Show when={pendingCount() > 0}>
              <span class="ap-count">{pendingCount()}</span>
            </Show>
          </A>
        </nav>
        <Switch>
          <Match when={view().section === "browse"}>
            <Browse />
          </Match>
          <Match when={view().section === "ai"}>
            <AiConnections />
          </Match>
          <Match when={view().section === "review"}>
            <ReviewPage />
          </Match>
          <Match when={view().section === "connect"}>
            <GalleryConnect source={search().get("source")} resume={search().get("resume")} applicationId={search().get("applicationId")} />
          </Match>
          <Match when={view().section === "byo"}>
            <ByoConnect />
          </Match>
          <Match when={application()} keyed>
            {(current) => <ApplicationPage applicationId={current.applicationId} />}
          </Match>
          <Match when={detail()}>
            {(current) => <AppDetail connectionId={current().connectionId} tab={current().tab} success={search().get("success") === "1"} oauth={search().get("oauth")} />}
          </Match>
          <Match when={later()}>
            {(current) => (
              <section class="card ap-later">
                <h2 class="disp">{current().name} isn't here yet</h2>
                <p>
                  This part of Apps and tools comes in a later round. <A href={base()}>Back to Apps</A>
                </p>
              </section>
            )}
          </Match>
        </Switch>
      </div>
    </Show>
  );
}
