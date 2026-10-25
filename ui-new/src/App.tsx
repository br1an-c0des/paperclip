import { Route, Router, type RouteSectionProps } from "@solidjs/router";
import { QueryClientProvider } from "@tanstack/solid-query";
import { lazy } from "solid-js";
import { watchViewport } from "@/layout/breakpoints";
import { queryClient } from "@/lib/query";
import { SessionGate } from "@/lib/session";
import { GrainFilter } from "@/ui/Grain";
import { Companies, CompanyRootRedirect } from "./routes/Companies";
import { CompanyHome } from "./routes/CompanyHome";
import { CompanyLayout } from "./routes/CompanyLayout";
import { NotBuiltYet, NotFound } from "./routes/NotFound";
import { SignIn } from "./routes/SignIn";

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
            <Route path="/" component={CompanyHome} />
            <Route path="/*rest" component={NotBuiltYet} />
          </Route>
        </Route>
        <Route path="*404" component={NotFound} />
      </Router>
    </QueryClientProvider>
  );
}
