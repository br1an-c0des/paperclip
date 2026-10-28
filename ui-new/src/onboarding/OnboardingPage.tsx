import type { Company } from "@paperclipai/shared";
import { A, useNavigate, useParams } from "@solidjs/router";
import { useQueryClient } from "@tanstack/solid-query";
import { createSignal, Match, Show, Switch } from "solid-js";
import { adminApi } from "@/api/admin";
import { queryKeys } from "@/api/queryKeys";
import { failure } from "@/agents/shared";
import { CompanyProvider, findCompanyByPrefix, rememberCompany, useCompaniesQuery } from "@/lib/company";
import { Splash } from "@/routes/Splash";
import { Button, buttonClass } from "@/ui/Button";
import { Field, TextInput } from "@/ui/Field";
import { AgentOnboarding } from "./AgentOnboarding";
import { useCanCreateCompany } from "./can-create";
import { OnboardingFrame } from "./OnboardingFrame";
import { organizationNameProblem } from "./onboarding-model";

/*
 * `/onboarding` and `/:companyPrefix/onboarding`: first-run setup, after the old UI's wizard. Name
 * the organization, set up its first agent (New agent's harness and model step), and leave on its
 * first task. A standalone page, outside the company shell. `/onboarding` always starts a new
 * organization; `/:prefix/onboarding` adds an agent and a first task to one, and is where onboarding
 * resumes after the organization exists (see onboarding-model.ts).
 */
export function OnboardingPage() {
  const params = useParams<{ companyPrefix?: string }>();
  const companies = useCompaniesQuery();
  const company = () => (params.companyPrefix ? findCompanyByPrefix(companies.data, params.companyPrefix) : undefined);

  return (
    <Switch fallback={<OrganizationStep />}>
      <Match when={params.companyPrefix && companies.isLoading}>
        <Splash title="Loading" quiet />
      </Match>
      <Match when={params.companyPrefix && companies.error}>
        {(error) => <Splash title="Couldn't load your organizations">{failure(error(), "Refresh to try again.")}</Splash>}
      </Match>
      <Match when={params.companyPrefix && !company()}>
        <Splash
          title="No organization at this address"
          actions={
            <A class={buttonClass({ variant: "primary", size: "compact" })} href="/onboarding">
              Start a new organization
            </A>
          }
        >
          There's no organization {params.companyPrefix} you can open.
        </Splash>
      </Match>
      <Match when={company()} keyed>
        {(found: Company) => (
          <CompanyProvider company={found}>
            <AgentOnboarding />
          </CompanyProvider>
        )}
      </Match>
    </Switch>
  );
}

/** Step 1: name the organization (`POST /companies`), then go on at its own onboarding address. */
function OrganizationStep() {
  const client = useQueryClient();
  const navigate = useNavigate();
  const companies = useCompaniesQuery();
  const creation = useCanCreateCompany();
  const [name, setName] = createSignal("");
  const [problem, setProblem] = createSignal<string | null>(null);
  const [busy, setBusy] = createSignal(false);

  const create = async (event: SubmitEvent) => {
    event.preventDefault();
    const found = organizationNameProblem(name());
    if (found) return setProblem(found);
    if (busy()) return;
    setBusy(true);
    setProblem(null);
    try {
      const company = await adminApi.createCompany({ name: name().trim() });
      rememberCompany(company.issuePrefix);
      await client.invalidateQueries({ queryKey: queryKeys.companies.all });
      navigate(`/${company.issuePrefix}/onboarding`, { replace: true });
    } catch (caught) {
      setProblem(failure(caught, "Couldn't create the organization."));
    } finally {
      setBusy(false);
    }
  };

  const hasCompanies = () => (companies.data?.length ?? 0) > 0;

  return (
    <OnboardingFrame
      step="organization"
      title={hasCompanies() ? "Create another organization" : "Create your first organization"}
      leave={
        <Show when={hasCompanies()}>
          <A class="ps-link" href="/companies">
            Back to your organizations
          </A>
        </Show>
      }
    >
      <section class="card settings-card ob-card">
        <Show
          when={creation().allowed}
          fallback={
            <div class="ob-blocked">
              <p class="ob-lede">{creation().reason}</p>
              <Show when={creation().cloudUrl}>
                {(url) => (
                  <a class={buttonClass({ variant: "primary", size: "compact" })} href={url()}>
                    Create it in Paperclip Cloud
                  </a>
                )}
              </Show>
            </div>
          }
        >
          <form class="ob-form" onSubmit={create}>
            <p class="ob-lede">An organization holds your agents, projects and tasks. You set up its first agent next.</p>
            <Field label="What's the organization called?" for="ob-org-name" error={problem() ?? undefined}>
              <TextInput
                id="ob-org-name"
                variant="title"
                placeholder="e.g. Northwind Labs"
                autocomplete="organization"
                maxLength={100}
                value={name()}
                onInput={(event) => {
                  setName(event.currentTarget.value);
                  setProblem(null);
                }}
              />
            </Field>
            <footer class="na-foot">
              <span />
              <span class="na-foot-end">
                <Button type="submit" variant="primary" disabled={busy()}>
                  {busy() ? "Creating…" : "Continue"}
                </Button>
              </span>
            </footer>
          </form>
        </Show>
      </section>
    </OnboardingFrame>
  );
}
