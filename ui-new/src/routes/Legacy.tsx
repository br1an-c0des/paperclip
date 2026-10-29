import type { Company } from "@paperclipai/shared";
import { A, Navigate, useLocation, useParams } from "@solidjs/router";
import { createQuery } from "@tanstack/solid-query";
import { Match, Show, Switch } from "solid-js";
import { casesApi } from "@/api/cases";
import { api, ApiError } from "@/api/client";
import { executionWorkspacesApi } from "@/api/execution-workspaces";
import { issuesApi } from "@/api/issues";
import { queryKeys } from "@/api/queryKeys";
import { findCompanyByPrefix, lastCompanyPrefix, useCompaniesQuery, useCompany } from "@/lib/company";
import { useProjectsQuery } from "@/lib/company-data";
import { projectGoalIds } from "@/projects/settings/settings-model";
import { PageHeader } from "@/ui/PageHeader";
import { PlannedNote } from "./Planned";
import { Splash } from "./Splash";
import { caseLinkTarget, companyLegacyTarget, identifierPrefix, isUuid, withSearchAndHash } from "./legacy-model";

/*
 * The old UI's addresses that have no page of their own here (legacy-model.ts has the mapping):
 *
 * - Under a company, `CompanyLegacyRedirect` sends retired pages to their new home: the old task
 *   views, `/tasks`, `/dashboard/live`, Decisions, `/approvals`, Goals, Tools, `/companies`,
 *   `/board-chat`, Artifacts and the old status-card addresses.
 * - Without a company, a task (`/issues/PAP-12`) or case (`/cases/PAP-C3`) opens in the company its
 *   identifier names; a workspace, approval or case given by id asks the API which company it's in.
 *   Everything else goes to the company you were last in (activity/redirects.tsx).
 * - `/cases/:id` opens the case's main task on its Case section, and `/cases` the task list grouped
 *   by case: there's no cases page (decision F).
 * - `/status*` holds the status cards' place until they're built (D3).
 */

/** `/:prefix/<old address>`. */
export function CompanyLegacyRedirect() {
  const location = useLocation();
  const company = useCompany();
  const target = () => {
    const rest = location.pathname.split("/").slice(2).join("/");
    const to = companyLegacyTarget(decodeURI(rest)) ?? "dashboard";
    return withSearchAndHash(to.startsWith("/") ? to : `/${company().issuePrefix}/${to}`, location.search, location.hash);
  };
  return <Navigate href={target()} />;
}

/** `/:prefix/goals/:goalId`: the project the goal belongs to, in its settings' Goals section. */
export function GoalRedirect() {
  const params = useParams<{ goalId: string }>();
  const company = useCompany();
  const projects = useProjectsQuery();
  const target = () => {
    const project = projects.data?.find((entry) => projectGoalIds(entry).includes(params.goalId));
    return project ? `projects/${project.urlKey}/settings/goals` : "dashboard";
  };
  return (
    <Show when={!projects.isPending}>
      <Navigate href={`/${company().issuePrefix}/${target()}`} />
    </Show>
  );
}

/**
 * `/:prefix/execution-workspaces/:id` and its old tabs: the Workspaces tab, asked to show that
 * workspace (`?workspace=`).
 */
export function ExecutionWorkspaceRedirect() {
  const params = useParams<{ workspaceId: string }>();
  const company = useCompany();
  return <Navigate href={`/${company().issuePrefix}/workspaces?workspace=${encodeURIComponent(params.workspaceId)}`} />;
}

/**
 * `/:prefix/cases/:caseId` (and its old tabs): there's no case page (decision F), so the case's
 * main task opens on its Case section; a case with no work yet opens the task list grouped by case
 * (legacy-model.ts `caseLinkTarget`). With cases turned off the server refuses, and the page says so.
 */
export function CaseRedirect() {
  const params = useParams<{ caseId: string }>();
  const company = useCompany();
  const location = useLocation();
  const found = createQuery(() => ({
    queryKey: queryKeys.cases.detail(company().id, params.caseId),
    queryFn: ({ signal }) => casesApi.get(params.caseId, signal),
    retry: false,
  }));
  const off = () => found.error instanceof ApiError && found.error.status === 403;
  return (
    <Switch>
      <Match when={found.data}>
        {(kase) => <Navigate href={withSearchAndHash(`/${company().issuePrefix}/${caseLinkTarget(kase())}`, "", location.hash)} />}
      </Match>
      <Match when={found.isError}>
        <PageHeader crumbs={<span>Cases</span>} title={<span class="mono">{params.caseId}</span>} />
        <section class="card planned">
          <p>
            {off()
              ? "Cases are turned off on this instance. An instance admin can turn them on in App settings → General → Features; then this link opens the case's main task."
              : `This case couldn't be opened: ${(found.error as Error).message}`}
          </p>
          <p>
            <A href={`/${company().issuePrefix}/issues`}>All tasks</A>
          </p>
        </section>
      </Match>
    </Switch>
  );
}

/** `/:prefix/status`, `/status/:cardId`: status cards (D3) come next round. */
export function StatusPlaceholder() {
  const company = useCompany();
  return (
    <>
      <PageHeader crumbs={<span>{company().name}</span>} title="Status" />
      <PlannedNote milestone="the next M7 round">
        Status cards (a board of tiles an agent keeps up to date, with history and dry runs) are being ported. Until then, the dashboard and Activity
        show what's happening.
      </PlannedNote>
    </>
  );
}

// ---------------------------------------------------------------------------------------------
// Without a company prefix

function lastOrFirst(companies: readonly Company[]) {
  return findCompanyByPrefix(companies, lastCompanyPrefix() ?? undefined) ?? companies[0];
}

/**
 * Sends an unprefixed address to a company: `company(companies)` picks it, or returns undefined
 * while it's still being worked out, or null to fall back to the last company.
 */
function PrefixRedirect(props: { company: (companies: readonly Company[]) => Company | null | undefined; path?: string }) {
  const location = useLocation();
  const companies = useCompaniesQuery();
  const target = (): string | undefined => {
    const list = companies.data;
    if (!list) return undefined;
    if (list.length === 0) return "/companies";
    const picked = props.company(list);
    if (picked === undefined) return undefined;
    const company = picked ?? lastOrFirst(list)!;
    return `/${company.issuePrefix}${props.path ?? location.pathname}${location.search}${location.hash}`;
  };
  return (
    <Show when={target()} fallback={<Splash title="Opening" quiet />}>
      {(href) => <Navigate href={href()} />}
    </Show>
  );
}

/** `/issues/:ref/*`: the company the identifier's prefix names, else the one the task is in. */
export function UnprefixedIssueRedirect() {
  const params = useParams<{ issueRef: string }>();
  const prefix = () => identifierPrefix(params.issueRef);
  const lookup = createQuery(() => ({
    queryKey: ["issues", "ref-company", params.issueRef] as const,
    queryFn: ({ signal }) => issuesApi.get(params.issueRef, signal),
    enabled: isUuid(params.issueRef),
    retry: false,
  }));
  return (
    <PrefixRedirect
      company={(companies) => {
        const byPrefix = findCompanyByPrefix(companies, prefix() ?? undefined);
        if (byPrefix) return byPrefix;
        if (!isUuid(params.issueRef)) return null;
        if (lookup.isPending) return undefined;
        return companies.find((company) => company.id === lookup.data?.companyId) ?? null;
      }}
    />
  );
}

/**
 * An unprefixed address for one record — `/execution-workspaces/:id/*`, `/approvals/:id`,
 * `/cases/:id` — in the company the record is in. A case's identifier names its company itself.
 */
export function UnprefixedRecordRedirect(props: { kind: "workspace" | "approval" | "case" }) {
  const params = useParams<{ id: string }>();
  const prefix = () => (props.kind === "case" ? identifierPrefix(params.id) : null);
  const lookup = createQuery(() => ({
    queryKey: ["legacy-record", props.kind, params.id] as const,
    queryFn: async ({ signal }): Promise<{ companyId: string }> => {
      if (props.kind === "workspace") return executionWorkspacesApi.get(params.id, signal);
      if (props.kind === "approval") return api.get<{ companyId: string }>(`/approvals/${encodeURIComponent(params.id)}`, { signal });
      return casesApi.get(params.id, signal);
    },
    retry: false,
  }));
  return (
    <PrefixRedirect
      company={(companies) => {
        const byPrefix = findCompanyByPrefix(companies, prefix() ?? undefined);
        if (byPrefix) return byPrefix;
        if (lookup.isPending) return undefined;
        return companies.find((company) => company.id === lookup.data?.companyId) ?? null;
      }}
    />
  );
}
