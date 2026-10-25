import type { Company } from "@paperclipai/shared";
import { createQuery } from "@tanstack/solid-query";
import { createContext, useContext, type ParentProps } from "solid-js";
import { companiesApi } from "@/api/companies";
import { queryKeys } from "@/api/queryKeys";
import { useSession } from "./session";

/*
 * Companies and the selected company. URLs carry the company's issue prefix
 * (`/:companyPrefix/...`), as in the old UI, so links from agents, Slack and email keep working.
 * The last company opened is remembered per browser, for `/`.
 */

const LAST_COMPANY_KEY = "paperclip.ui-new.last-company";

export function rememberCompany(prefix: string) {
  try {
    localStorage.setItem(LAST_COMPANY_KEY, prefix);
  } catch {
    // Storage unavailable: `/` then opens the first company.
  }
}

export function lastCompanyPrefix(): string | null {
  try {
    return localStorage.getItem(LAST_COMPANY_KEY);
  } catch {
    return null;
  }
}

/** The companies the signed-in user can enter. */
export function useCompaniesQuery() {
  const session = useSession();
  return createQuery(() => ({
    queryKey: queryKeys.companies.list(session.userId()),
    queryFn: companiesApi.list,
  }));
}

export function findCompanyByPrefix(companies: readonly Company[] | undefined, prefix: string | undefined) {
  if (!companies || !prefix) return undefined;
  const wanted = prefix.toLowerCase();
  return companies.find((company) => company.issuePrefix.toLowerCase() === wanted);
}

const CompanyContext = createContext<() => Company>();

export function CompanyProvider(props: ParentProps<{ company: Company }>) {
  return <CompanyContext.Provider value={() => props.company}>{props.children}</CompanyContext.Provider>;
}

/** The company the current page belongs to. */
export function useCompany() {
  const company = useContext(CompanyContext);
  if (!company) throw new Error("useCompany must be used inside a company route");
  return company;
}
