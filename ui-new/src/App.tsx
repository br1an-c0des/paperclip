import { Navigate, Route, Router, type RouteSectionProps } from "@solidjs/router";
import { QueryClientProvider } from "@tanstack/solid-query";
import { lazy } from "solid-js";
import { watchViewport } from "@/layout/breakpoints";
import { queryClient } from "@/lib/query";
import { SessionGate } from "@/lib/session";
import { GrainFilter } from "@/ui/Grain";
import { ToastViewport } from "@/ui/Toast";
import { Companies, CompanyRootRedirect } from "./routes/Companies";
import { CompanyHome } from "./routes/CompanyHome";
import { CompanyLayout } from "./routes/CompanyLayout";
import { ConnectorsPage } from "./connectors/ConnectorsPage";
import { NotBuiltYet, NotFound } from "./routes/NotFound";
import { AgentPage, InboxPage, SettingsPage } from "./routes/Planned";
import { ProjectPage } from "./routes/Project";
import { SignIn } from "./routes/SignIn";
import { TaskPage, TasksPage } from "./routes/Tasks";
import { RunRoute } from "./runs/RunRoute";

const StyleGuide = lazy(() => import("./routes/StyleGuide").then((m) => ({ default: m.StyleGuide })));

/*
 * Routes keep the old UI's URL shapes (`/:companyPrefix/issues/:id`, `/:companyPrefix/agents/:id`,
 * …): agents, Slack messages and emails link to them. Pages that don't exist yet render
 * <NotBuiltYet> inside the shell rather than a 404.
 *
 * `/style-guide` and `/auth` sit outside the session gate; everything else needs a session (or a
 * local_trusted instance).
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
        <Route path="/" component={SessionGate}>
          <Route path="/" component={CompanyRootRedirect} />
          <Route path="/companies" component={Companies} />
          <Route path="/:companyPrefix" component={CompanyLayout}>
            <Route path="/" component={() => <Navigate href="dashboard" />} />
            <Route path="/dashboard" component={CompanyHome} />
            <Route path="/inbox/*" component={InboxPage} />
            <Route path="/issues" component={TasksPage} />
            <Route path="/issues/:issueRef/*" component={TaskPage} />
            <Route path="/projects/:projectKey/*tab" component={ProjectPage} />
            <Route path="/agents/:agentKey/runs/:runId" component={RunRoute} />
            <Route path="/agents/:agentKey/*" component={AgentPage} />
            <Route path="/company/settings/*" component={SettingsPage} />
            <Route path="/connectors" component={ConnectorsPage} />
            <Route path="/*rest" component={NotBuiltYet} />
          </Route>
        </Route>
        <Route path="*404" component={NotFound} />
      </Router>
    </QueryClientProvider>
  );
}
