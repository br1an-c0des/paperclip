import { A, Navigate, useParams } from "@solidjs/router";
import { Match, Show, Switch } from "solid-js";
import { isCompact } from "@/layout/breakpoints";
import { useCompany } from "@/lib/company";
import { OrgHeader } from "@/org/OrgHeader";
import { ActivityLog } from "./ActivityLog";
import { Commentary } from "./Commentary";
import { Costs } from "./Costs";
import { RunsList } from "./RunsList";
import "./Activity.css";

/*
 * `/:prefix/activity/*`, the organization's Activity tab (Tier 2, ported from the old Audit hub):
 *
 * - Log (`/activity`): the company's activity log, filtered and paged (ActivityLog.tsx).
 * - Runs (`/activity/runs`): the company's latest runs, by agent; each opens the run modal.
 * - Commentary (`/activity/commentary`): suggestions and complaints agents send in.
 * - Costs (`/activity/costs`): spend by agent, model, project and person over a range, and budgets;
 *   `?tab=` opens providers, billers, finance, or decision and fast-response call history.
 *
 * The old hub's Budgets section is the Costs tab's Budgets card (`/activity/budgets` lands there),
 * and its Timeline isn't ported: Workload (board 33) draws runs over time. Old `/audit`, `/costs`,
 * `/runs` and `/timeline` addresses redirect here (redirects.tsx).
 */

type Section = "log" | "runs" | "commentary" | "costs";

function sectionOf(tab: string | undefined): Section | null {
  const first = (tab ?? "").replace(/^\/+|\/+$/g, "").split("/")[0] ?? "";
  if (first === "" || first === "log") return "log";
  if (first === "runs" || first === "commentary" || first === "costs") return first;
  return null;
}

export function ActivityPage() {
  const params = useParams<{ tab?: string }>();
  const company = useCompany();
  const base = () => `/${company().issuePrefix}/activity`;
  const section = () => sectionOf(params.tab);

  return (
    <Show when={section()} fallback={<Navigate href={base()} />}>
      {(current) => (
        <div class="org-page act-page">
          <Show when={!isCompact()} fallback={<h1 class="org-phone-title disp">Activity</h1>}>
            <OrgHeader />
          </Show>
          <nav class="act-subnav" aria-label="Activity">
            <A href={base()} end>
              Log
            </A>
            <A href={`${base()}/runs`}>Runs</A>
            <A href={`${base()}/commentary`}>Commentary</A>
            <A href={`${base()}/costs`}>Costs</A>
          </nav>
          <Switch>
            <Match when={current() === "log"}>
              <ActivityLog />
            </Match>
            <Match when={current() === "runs"}>
              <RunsList />
            </Match>
            <Match when={current() === "commentary"}>
              <Commentary />
            </Match>
            <Match when={current() === "costs"}>
              <Costs />
            </Match>
          </Switch>
        </div>
      )}
    </Show>
  );
}
