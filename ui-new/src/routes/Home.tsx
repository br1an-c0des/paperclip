import { createResource, For, Match, Show, Switch } from "solid-js";
// Type-only imports from the shared package keep the new UI in step with the
// server's API types without pulling shared runtime code into the bundle.
import type { Company } from "@paperclipai/shared";
import { api } from "@/api/client";

type CompanySummary = Pick<Company, "id" | "name" | "issuePrefix" | "status">;

export function Home() {
  const [health] = createResource(() => api.get<{ status?: string; version?: string }>("/health"));
  const [companies] = createResource(() => api.get<CompanySummary[]>("/companies"));

  return (
    <section class="stack">
      <div class="card">
        <h2>Server</h2>
        <Switch>
          <Match when={health.loading}>
            <p class="muted">Connecting…</p>
          </Match>
          <Match when={health.error}>
            <p class="error">
              Can't reach the API. Start the server with <code>pnpm dev</code> at the repo root.
            </p>
          </Match>
          <Match when={health()}>
            {(h) => (
              <p>
                Connected · status <code>{h().status ?? "unknown"}</code>
                <Show when={h().version}> · v{h().version}</Show>
              </p>
            )}
          </Match>
        </Switch>
      </div>

      <div class="card">
        <h2>Companies</h2>
        <Switch>
          <Match when={companies.loading}>
            <p class="muted">Loading…</p>
          </Match>
          <Match when={companies.error}>
            {(err) => <p class="error">{String(err().message ?? err())}</p>}
          </Match>
          <Match when={companies()?.length === 0}>
            <p class="muted">No companies yet.</p>
          </Match>
          <Match when={companies()}>
            {(list) => (
              <ul class="list">
                <For each={list()}>
                  {(company) => (
                    <li>
                      <span class="prefix">{company.issuePrefix}</span>
                      {company.name}
                      <span class="muted"> · {company.status}</span>
                    </li>
                  )}
                </For>
              </ul>
            )}
          </Match>
        </Switch>
      </div>
    </section>
  );
}
