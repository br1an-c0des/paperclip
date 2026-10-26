import { createQuery } from "@tanstack/solid-query";
import { Match, Show, Switch } from "solid-js";
import { companiesApi, statsFor } from "@/api/companies";
import { queryKeys } from "@/api/queryKeys";
import { useCompany } from "@/lib/company";
import { useLiveConnection } from "@/lib/live-events";
import { HeaderNumber, PageHeader } from "@/ui/PageHeader";
import { Capsule, TonePill } from "@/ui/Status";
import "./CompanyHome.css";

/*
 * `/:companyPrefix/dashboard`: a placeholder home for the selected company. The Org dashboard
 * (board 19) takes this route in M5; until then it shows the company's header and whether live
 * updates are connected.
 */

function LiveState() {
  const connection = useLiveConnection();
  return (
    <Switch>
      <Match when={connection() === "open"}>
        <TonePill tone="green" compact icon={<Capsule gradient="lagoon" size="tiny" />}>
          Live updates on
        </TonePill>
      </Match>
      <Match when={connection() === "reconnecting"}>
        <TonePill tone="amber" compact icon={<Capsule gradient="ember" size="tiny" live />}>
          Reconnecting
        </TonePill>
      </Match>
      <Match when={connection() === "connecting"}>
        <TonePill tone="run" compact icon={<Capsule gradient="ion" size="tiny" live />}>
          Connecting
        </TonePill>
      </Match>
      <Match when={connection() === "paused"}>
        <TonePill tone="cyan" compact>
          Paused while hidden
        </TonePill>
      </Match>
    </Switch>
  );
}

export function CompanyHome() {
  const company = useCompany();
  const stats = createQuery(() => ({ queryKey: queryKeys.companies.stats, queryFn: companiesApi.stats }));
  const counts = () => statsFor(stats.data, company().id);

  return (
    <>
      <PageHeader
        crumbs={
          <>
            <span>Company</span>
            <span aria-hidden="true">/</span>
            <span class="mono">{company().issuePrefix}</span>
            <LiveState />
          </>
        }
        title={company().name}
        numbers={
          <>
            <Show when={counts()} fallback={<span class="muted">Counting…</span>}>
              {(c) => (
                <>
                  <HeaderNumber value={c().agentCount} label="agents" />
                  <HeaderNumber value={c().issueCount} label="tasks" />
                </>
              )}
            </Show>
            <Show when={company().status !== "active"}>
              <span class="home-status">{company().status}</span>
            </Show>
          </>
        }
      />
      <section class="card home-note">
        <h2 class="disp">The Org dashboard arrives in M5</h2>
        <p>
          The shell is in place: the nav, search and commands (Ctrl+K), keyboard shortcuts (?), notifications, and the
          new-task dialog (C). The task list, inbox and the rest of the board arrive milestone by milestone.
        </p>
      </section>
    </>
  );
}
