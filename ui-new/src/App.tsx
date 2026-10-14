import { Route, Router, A, type RouteSectionProps } from "@solidjs/router";
import { Home } from "./routes/Home";
import { NotFound } from "./routes/NotFound";

function Layout(props: RouteSectionProps) {
  return (
    <div class="app">
      <header class="app-header">
        <A href="/" class="brand">Paperclip</A>
        <span class="badge">ui-new</span>
      </header>
      <main class="app-main">{props.children}</main>
    </div>
  );
}

export function App() {
  return (
    <Router root={Layout}>
      <Route path="/" component={Home} />
      <Route path="*404" component={NotFound} />
    </Router>
  );
}
