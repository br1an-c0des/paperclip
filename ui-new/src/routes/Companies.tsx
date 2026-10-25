import type { Company } from "@paperclipai/shared";
import { A, Navigate } from "@solidjs/router";
import { createQuery } from "@tanstack/solid-query";
import { For, Match, Show, Switch } from "solid-js";
import { companiesApi, statsFor } from "@/api/companies";
import { queryKeys } from "@/api/queryKeys";
import { findCompanyByPrefix, lastCompanyPrefix, useCompaniesQuery } from "@/lib/company";
import { InitialsDisc } from "@/ui/Avatar";
import { Grain } from "@/ui/Grain";
import { Splash } from "./Splash";
import "./Companies.css";

/** `/`: open the last company used, or the first one, or the list when there's none. */
export function CompanyRootRedirect() {
  const companies = useCompaniesQuery();
  const target = () => {
    const list = companies.data;
    if (!list?.length) return null;
    return findCompanyByPrefix(list, lastCompanyPrefix() ?? undefined) ?? list[0]!;
  };
  return (
    <Switch fallback={<Navigate href="/companies" />}>
      <Match when={companies.isLoading}>
        <Splash title="Loading companies" quiet />
      </Match>
      <Match when={target()}>{(company) => <Navigate href={`/${company().issuePrefix}`} />}</Match>
    </Switch>
  );
}

function CompanyMark(props: { company: Company }) {
  return (
    <Show
      when={props.company.logoUrl}
      fallback={
        <span class="company-mark grained" aria-hidden="true">
          <InitialsDisc name={props.company.name.slice(0, 1)} seed={props.company.id} size={40} />
          <Grain />
        </span>
      }
    >
      {(src) => <img class="company-mark" src={src()} alt="" width="40" height="40" />}
    </Show>
  );
}

/** `/companies`: every company the user can enter. */
export function Companies() {
  const companies = useCompaniesQuery();
  const stats = createQuery(() => ({ queryKey: queryKeys.companies.stats, queryFn: companiesApi.stats }));

  return (
    <div class="companies-page">
      <header class="companies-head">
        <span class="mono cap">Paperclip</span>
        <h1 class="disp">Companies</h1>
      </header>
      <Switch>
        <Match when={companies.isLoading}>
          <p class="muted" role="status">Loading…</p>
        </Match>
        <Match when={companies.error}>
          {(error) => <p class="companies-error" role="alert">{(error() as Error).message}</p>}
        </Match>
        <Match when={companies.data?.length === 0}>
          <section class="card companies-empty">
            <h2 class="disp">No companies yet</h2>
            <p>Create one in the classic UI's onboarding for now. Onboarding in this UI comes later (M6).</p>
          </section>
        </Match>
        <Match when={companies.data}>
          {(list) => (
            <ul class="companies-list">
              <For each={list()}>
                {(company) => (
                  <li>
                    <A class="card company-card" href={`/${company.issuePrefix}`}>
                      <CompanyMark company={company} />
                      <span class="company-card-text">
                        <span class="company-card-name disp">{company.name}</span>
                        <span class="company-card-meta">
                          <span class="mono">{company.issuePrefix}</span>
                          <Show when={statsFor(stats.data, company.id)}>
                            {(s) => (
                              <>
                                <span>{s().agentCount} agents</span>
                                <span>{s().issueCount} tasks</span>
                              </>
                            )}
                          </Show>
                          <Show when={company.status !== "active"}>
                            <span class="company-card-status">{company.status}</span>
                          </Show>
                        </span>
                      </span>
                    </A>
                  </li>
                )}
              </For>
            </ul>
          )}
        </Match>
      </Switch>
    </div>
  );
}
