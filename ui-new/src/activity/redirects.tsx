import { Navigate, useLocation } from "@solidjs/router";
import { Show } from "solid-js";
import { findCompanyByPrefix, lastCompanyPrefix, useCompaniesQuery, useCompany } from "@/lib/company";
import { legacyActivityHref } from "./log-model";

/*
 * Where the old UI's addresses for these pages land.
 *
 * - Under a company: `/audit/*`, `/runs`, `/costs`, `/budgets`, `/timeline` and
 *   `/activity/budgets|timeline` go to the Activity tabs (`legacyActivityHref`).
 * - Without one (`/activity/*`, `/audit/*`, `/costs`, `/budgets`, `/skills/*`): the old UI sent these
 *   to the company you were last in, and so does this, keeping the rest of the address.
 */

export function LegacyActivityRedirect() {
  const location = useLocation();
  const company = useCompany();
  const target = () => {
    const rest = location.pathname.split("/").slice(2).join("/");
    return legacyActivityHref(rest, location.search) ?? "activity";
  };
  return <Navigate href={`/${company().issuePrefix}/${target()}`} />;
}

export function UnprefixedCompanyRedirect() {
  const location = useLocation();
  const companies = useCompaniesQuery();
  const prefix = () => {
    const list = companies.data;
    if (!list?.length) return null;
    return (findCompanyByPrefix(list, lastCompanyPrefix() ?? undefined) ?? list[0]!).issuePrefix;
  };
  return (
    <Show when={!companies.isLoading}>
      <Navigate href={prefix() ? `/${prefix()}${location.pathname}${location.search}${location.hash}` : "/companies"} />
    </Show>
  );
}
