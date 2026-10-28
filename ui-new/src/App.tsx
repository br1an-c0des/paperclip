import { Navigate, Route, Router, type RouteSectionProps } from "@solidjs/router";
import { QueryClientProvider } from "@tanstack/solid-query";
import { lazy } from "solid-js";
import { watchViewport } from "@/layout/breakpoints";
import { queryClient } from "@/lib/query";
import { SessionGate } from "@/lib/session";
import { GrainFilter } from "@/ui/Grain";
import { ToastViewport } from "@/ui/Toast";
import { Companies, CompanyRootRedirect } from "./routes/Companies";
import { CompanyLayout } from "./routes/CompanyLayout";
import { NotBuiltYet, NotFound } from "./routes/NotFound";
import { InboxPage } from "./inbox/InboxPage";
import { OrgDashboard, OrgRedirect } from "./org/OrgDashboard";
import { AgentsTabRedirect, OrgAgents } from "./org/OrgAgents";
import { LEGACY_AGENT_TABS } from "./org/org-model";
import { AgentPage } from "./agents/AgentPage";
import { ChatRedirect, ChatsHomeRedirect } from "./chat/ChatRedirect";
import { NewAgentPage, UnprefixedNewAgent } from "./agents/new/NewAgentPage";
import { CompanySettingsPage, CompanyTransferRedirect } from "./settings/company/CompanySettingsPage";
import { ProjectPage } from "./routes/Project";
import { RoutineRedirect } from "./recurring/RoutineRedirect";
import { SignIn } from "./routes/SignIn";
import { TaskPage, TasksPage } from "./routes/Tasks";
import { RunRoute } from "./runs/RunRoute";
import { SearchPage } from "./search/SearchPage";
import { AppSettingsPage, CompanySettingsRedirect, UnprefixedSettingsRedirect } from "./settings/app/AppSettingsPage";
import { CompanyWorkload } from "./workload/CompanyWorkload";
import { ActivityPage } from "./activity/ActivityPage";
import { LegacyActivityRedirect, UnprefixedCompanyRedirect } from "./activity/redirects";
import { SkillsPage } from "./skills/SkillsPage";
import { AppsPage, ConnectorsRedirect } from "./apps/AppsPage";
import { BoardClaimPage } from "./auth/BoardClaim";
import { ChatIdentityPage } from "./auth/ChatIdentity";
import { CliAuthPage } from "./auth/CliAuth";
import { InvitePage } from "./auth/Invite";
import { AssistantConnectionsPage, McpConnectPage, McpDevicePage } from "./auth/McpConnect";
import { OAuthHandoffPage } from "./auth/OAuthHandoff";
import { OnboardingPage } from "./onboarding/OnboardingPage";

const StyleGuide = lazy(() => import("./routes/StyleGuide").then((m) => ({ default: m.StyleGuide })));

/*
 * Routes keep the old UI's URL shapes (`/:companyPrefix/issues/:id`, `/:companyPrefix/agents/:id`,
 * …): agents, Slack messages and emails link to them. Pages that don't exist yet render
 * <NotBuiltYet> inside the shell rather than a 404.
 *
 * `/style-guide`, sign-in and the other pages someone may open before they belong to a company sit
 * outside the session gate, as in the old UI: board claim, CLI approval, invites, MCP connect, the
 * Cloud sign-in handoff and chat-identity linking (which checks the session itself, since a
 * non-member may ask for access there). Each decides what needs a session. Everything else needs a
 * session (or a local_trusted instance), onboarding included.
 */

function Root(props: RouteSectionProps) {
  watchViewport();
  return (
    <>
      <GrainFilter />
      {props.children}
      <ToastViewport />
    </>
  );
}

export function App() {
  return (
    <QueryClientProvider client={queryClient}>
      <Router root={Root}>
        <Route path="/style-guide" component={StyleGuide} />
        <Route path="/auth" component={SignIn} />
        <Route path="/board-claim/:token" component={BoardClaimPage} />
        <Route path="/cli-auth/:id" component={CliAuthPage} />
        <Route path="/invite/:token" component={InvitePage} />
        <Route path="/mcp-connect/:id" component={() => <McpConnectPage />} />
        <Route path="/dot-connect/:id" component={() => <McpConnectPage agentPairingOnly />} />
        <Route path="/mcp-device" component={McpDevicePage} />
        <Route path="/assistant-connections" component={AssistantConnectionsPage} />
        <Route path="/oauth-handoff" component={OAuthHandoffPage} />
        <Route path="/chat-identity/confirm" component={ChatIdentityPage} />
        <Route path="/" component={SessionGate}>
          <Route path="/" component={CompanyRootRedirect} />
          <Route path="/companies" component={Companies} />
          {/* Standalone pages outside the company shell; `/:prefix/onboarding` outranks the layout route. */}
          <Route path={["/onboarding", "/:companyPrefix/onboarding"]} component={OnboardingPage} />
          {/* The old UI's unprefixed hire link opens New agent in the last company. */}
          <Route path="/agents/new" component={UnprefixedNewAgent} />
          {/* The old UI's unprefixed skills, activity and costs links open in the last company. */}
          <Route path={["/skills/*", "/activity/*", "/audit/*", "/costs", "/budgets"]} component={UnprefixedCompanyRedirect} />
          {/* The old UI's unprefixed apps links (and OAuth returns) open in the last company too. */}
          <Route path="/apps/*" component={UnprefixedCompanyRedirect} />
          {/* The old UI's unprefixed instance-settings addresses open App settings in the last company. */}
          {/* `/instance/settings/*` must outrank the company's `/:companyPrefix/instance/*`. */}
          <Route path={["/instance", "/instance/settings/*rest", "/settings/*rest"]} component={UnprefixedSettingsRedirect} />
          <Route path="/:companyPrefix" component={CompanyLayout}>
            <Route path="/" component={() => <Navigate href="dashboard" />} />
            <Route path="/dashboard" component={OrgDashboard} />
            <Route path="/org" component={OrgRedirect} />
            <Route path="/inbox/*rest" component={InboxPage} />
            <Route path="/issues" component={TasksPage} />
            <Route path="/issues/:issueRef/*" component={TaskPage} />
            <Route path="/routines/:routineId?/*" component={RoutineRedirect} />
            <Route path="/projects/:projectKey/*tab" component={ProjectPage} />
            <Route path="/agents" component={OrgAgents} />
            {/* Before the agent routes, so "new" isn't taken for an agent's key. */}
            <Route path="/agents/new" component={NewAgentPage} />
            <Route path="/agents/:tab" matchFilters={{ tab: LEGACY_AGENT_TABS }} component={AgentsTabRedirect} />
            <Route path="/agents/:agentKey/runs/:runId" component={RunRoute} />
            <Route path="/agents/:agentKey/*rest" component={AgentPage} />
            {/* The old UI's chat addresses open the chat at the agent's address. */}
            <Route path="/chats" component={ChatsHomeRedirect} />
            <Route path="/chats/:agentRef/*" component={ChatRedirect} />
            <Route path="/company/settings/*rest" component={CompanySettingsPage} />
            <Route path="/company/export/*" component={() => <CompanyTransferRedirect kind="export" />} />
            <Route path="/company/import" component={() => <CompanyTransferRedirect kind="import" />} />
            {/* Apps and tools; the temporary Connectors page became Apps → AI connections. */}
            <Route path="/apps/*rest" component={AppsPage} />
            <Route path="/connectors" component={ConnectorsRedirect} />
            <Route path="/search" component={SearchPage} />
            <Route path="/workload" component={CompanyWorkload} />
            <Route path="/skills/*rest" component={SkillsPage} />
            {/* Activity's tabs; the old audit, runs, costs, budgets and timeline pages land on them. */}
            <Route path={["/activity/budgets", "/activity/timeline", "/audit/*", "/runs", "/costs", "/budgets", "/timeline"]} component={LegacyActivityRedirect} />
            <Route path="/activity/*tab" component={ActivityPage} />
            {/* App settings, at the old UI's instance-settings address (outranks /company/settings/*). */}
            <Route path="/company/settings/instance/*rest" component={AppSettingsPage} />
            <Route path="/instance/*rest" component={() => <CompanySettingsRedirect kind="instance" />} />
            <Route path="/settings/*rest" component={() => <CompanySettingsRedirect kind="settings" />} />
            <Route path="/*rest" component={NotBuiltYet} />
          </Route>
        </Route>
        <Route path="*404" component={NotFound} />
      </Router>
    </QueryClientProvider>
  );
}
