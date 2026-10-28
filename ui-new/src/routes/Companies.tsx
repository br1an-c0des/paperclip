import type { Company } from "@paperclipai/shared";
import { A, Navigate } from "@solidjs/router";
import { createQuery } from "@tanstack/solid-query";
import { Plus } from "lucide-solid";
import { For, Match, Show, Switch } from "solid-js";
import { companiesApi, statsFor } from "@/api/companies";
import { queryKeys } from "@/api/queryKeys";
import { useCanCreateCompany } from "@/onboarding/can-create";
import { findCompanyByPrefix, lastCompanyPrefix, useCompaniesQuery } from "@/lib/company";
import { InitialsDisc } from "@/ui/Avatar";
import { buttonClass } from "@/ui/Button";
import { Grain } from "@/ui/Grain";
import { Splash } from "./Splash";
import "./Companies.css";

/** `/`: open the last company used, or the first one; with none yet, onboarding creates the first. */
export function CompanyRootRedirect() {
  const companies = useCompaniesQuery();
  const target = () => {
    const list = companies.data;
    if (!list?.length) return null;
    return findCompanyByPrefix(list, lastCompanyPrefix() ?? undefined) ?? list[0]!;
  };
  return (
    <Switch fallback={<Navigate href={companies.data?.length === 0 ? "/onboarding" : "/companies"} />}>
      <Match when={companies.isLoading}>
        <Splash title="Loading companies" quiet />
      </Match>
      <Match when={target()}>{(company) => <Navigate href={`/${company().issuePrefix}`} />}</Match>
    </Switch>
  );
}

/** A company's logo, or a disc with its initial. */
export function CompanyMark(props: { company: Pick<Company, "id" | "name" | "logoUrl">; size?: number }) {
  const size = () => props.size ?? 40;
  return (
    <Show
      when={props.company.logoUrl}
      fallback={
        <span class="company-mark grained" aria-hidden="true" style={{ width: `${size()}px`, height: `${size()}px` }}>
          <InitialsDisc name={props.company.name.slice(0, 1)} seed={props.company.id} size={size()} />
          <Grain />
        </span>
      }
    >
      {(src) => <img class="company-mark" src={src()} alt="" width={size()} height={size()} style={{ width: `${size()}px`, height: `${size()}px` }} />}
    </Show>
  );
}

/** `/companies`: every company the user can enter. */
export function Companies() {
  const companies = useCompaniesQuery();
  const stats = createQuery(() => ({ queryKey: queryKeys.companies.stats, queryFn: companiesApi.stats }));
  const canCreate = useCanCreateCompany();

  return (
    <div class="companies-page">
      <header class="companies-head">
        <span class="mono cap">Paperclip</span>
        <div class="companies-title">
          <h1 class="disp">Companies</h1>
          <Show when={canCreate().allowed}>
            <A class={buttonClass({ size: "compact" })} href="/onboarding">
              <Plus size={15} aria-hidden="true" />
              New organization
            </A>
          </Show>
        </div>
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
            <Show when={canCreate().allowed} fallback={<p>{canCreate().reason}</p>}>
              <p>Create your first organization and its first agent.</p>
              <A class={buttonClass({ variant: "primary", size: "compact" })} href="/onboarding">
                New organization
              </A>
            </Show>
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
