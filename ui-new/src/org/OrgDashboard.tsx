import type { AttentionItem } from "@paperclipai/shared";
import { A, Navigate } from "@solidjs/router";
import { createQuery } from "@tanstack/solid-query";
import { ArrowRightLeft, BadgeCheck, CircleHelp, Pause, Play, ShieldCheck, Sparkles, UserPlus, type LucideProps } from "lucide-solid";
import { createMemo, For, Show, type JSX } from "solid-js";
import { budgetsApi } from "@/api/budgets";
import { costsApi } from "@/api/costs";
import { orgApi } from "@/api/org";
import { openProjects } from "@/api/projects";
import { queryKeys } from "@/api/queryKeys";
import { useChatIndex } from "@/chat/chat-index";
import { groupFeed, feedKind } from "@/inbox/inbox-model";
import { useAttentionFeed } from "@/inbox/needs-you";
import { useCompany } from "@/lib/company";
import { useProjectsQuery } from "@/lib/company-data";
import { formatCents, monthWindow, projectSpend } from "@/projects/dashboard-model";
import { currentPolicy, projectPolicies } from "@/projects/settings/settings-model";
import { KIND_LABEL, type RequestKind } from "@/requests/request-model";
import { useTaskPeople } from "@/tasks/people";
import { AgentAvatar, InitialsDisc } from "@/ui/Avatar";
import { buttonClass } from "@/ui/Button";
import { gradientVar, type Gradient } from "@/ui/status-meta";
import { useAgentActions } from "./actions";
import { OrgChartCard } from "./OrgChart";
import { OrgHeader } from "./OrgHeader";
import { DashboardWidgets } from "@/plugins/DashboardPlugins";
import { activityLine, type ActivityLine } from "@/activity/activity-line";
import { chartMax, projectProgress, runDayBars, runTotals, shortAgo, taskRef, topSpenders } from "./org-model";
import { useMinute, useOrgData } from "./queries";
import "./Org.css";

/*
 * `/:prefix/dashboard`, the company's home (board 19): the organization header and tabs, key
 * numbers, the org chart with its inspector, then what needs you and recent activity beside runs
 * over the last 14 days, projects, and this month's spend by agent.
 *
 * Requests: the dashboard summary (`GET /companies/:id/dashboard`: task counts, month spend against
 * the company budget, 14 days of runs), the attention feed the Inbox reads, company activity, the
 * org tree, recent runs, the company task list, this month's spend by project, and budgets.
 */

/** The old UI's `/:prefix/org` (its org chart page): the chart lives on the dashboard now. */
export function OrgRedirect() {
  const company = useCompany();
  return <Navigate href={`/${company().issuePrefix}/dashboard`} />;
}

const ACTIVITY_LIMIT = 30;
const ACTIVITY_SHOWN = 7;
const NEEDS_SHOWN = 5;

const KIND_ICON: Record<RequestKind, (props: LucideProps) => JSX.Element> = {
  question: CircleHelp,
  proposal: Sparkles,
  approval: ShieldCheck,
  signoff: BadgeCheck,
};

type Kpi = { label: string; value: string; note: string; href: string; dot?: Gradient; live?: boolean; meter?: { percent: number; warn: boolean } };

export function OrgDashboard() {
  const company = useCompany();
  const base = () => `/${company().issuePrefix}`;
  const data = useOrgData();
  const actions = useAgentActions();
  const feed = useAttentionFeed();
  const projects = useProjectsQuery();
  const month = () => monthWindow(new Date());

  const summary = createQuery(() => ({
    queryKey: queryKeys.dashboard(company().id),
    queryFn: ({ signal }) => orgApi.dashboard(company().id, signal),
  }));
  const projectCosts = createQuery(() => ({
    queryKey: queryKeys.costs(company().id, month().from),
    queryFn: ({ signal }) => costsApi.byProject(company().id, month().from, undefined, signal),
  }));
  const budgets = createQuery(() => ({
    queryKey: queryKeys.projectSettings.budgets(company().id),
    queryFn: ({ signal }) => budgetsApi.overview(company().id, signal),
  }));

  const needs = createMemo(() => groupFeed(feed.data?.items ?? []).needs);
  const kindCounts = createMemo(() => {
    const counts = new Map<RequestKind, number>();
    for (const item of needs()) counts.set(feedKind(item), (counts.get(feedKind(item)) ?? 0) + 1);
    return [...counts.entries()]
      .sort((a, b) => b[1] - a[1])
      .map(([kind, count]) => `${count} ${KIND_LABEL[kind].toLowerCase()}${count === 1 ? "" : "s"}`)
      .join(", ");
  });

  const working = createMemo(() => data.rows().filter((row) => row.state === "running"));
  const blockedTasks = createMemo(() => (data.tasks.data ?? []).filter((task) => task.status === "blocked"));
  const runs = createMemo(() => runTotals(summary.data?.runActivity));

  const kpis = createMemo<Kpi[]>(() => {
    const s = summary.data;
    const openProjectsCount = openProjects(projects.data).length;
    const spend = s?.costs.monthSpendCents ?? 0;
    const budget = s?.costs.monthBudgetCents ?? 0;
    return [
      {
        label: "Needs you",
        value: feed.data ? String(needs().length) : "–",
        note: needs().length ? kindCounts() : "Nothing waiting",
        href: `${base()}/inbox`,
        dot: "ember",
      },
      {
        label: "Working now",
        value: String(working().length),
        note: working().length ? working().map((row) => row.agent.name).join(", ") : "No agent is running",
        href: `${base()}/agents?filter=running`,
        dot: "ion",
        live: working().length > 0,
      },
      {
        label: "Tasks in progress",
        value: s ? String(s.tasks.inProgress) : "–",
        note: s ? `${s.tasks.open} open across ${openProjectsCount} ${openProjectsCount === 1 ? "project" : "projects"}` : "",
        href: `${base()}/issues`,
        dot: "ash",
      },
      {
        label: "Blocked",
        value: s ? String(s.tasks.blocked) : "–",
        note: blockedTasks().length ? blockedTasks().slice(0, 3).map(taskRef).join(", ") : "Nothing blocked",
        href: `${base()}/issues`,
        dot: "flare",
      },
      {
        label: "Run success",
        value: runs().rate === null ? "–" : `${runs().rate}%`,
        note: `${runs().total} ${runs().total === 1 ? "run" : "runs"} in 14 days, ${runs().failed} failed`,
        href: `${base()}/activity`,
        dot: "lagoon",
      },
      {
        label: `Spent in ${month().name}`,
        value: formatCents(spend, true),
        note: budget > 0 ? `${s?.costs.monthUtilizationPercent ?? 0}% of the ${formatCents(budget, true)} budget` : "No company budget set",
        href: `${base()}/company/settings/budgets`,
        meter: budget > 0 ? { percent: Math.min(100, Math.round((spend / budget) * 100)), warn: spend / budget >= 0.8 } : undefined,
      },
    ];
  });

  return (
    <div class="org-page">
      <OrgHeader />
      <Show when={company().description?.trim()}>{(text) => <p class="org-about">{text()}</p>}</Show>

      <section class="org-kpis" aria-label="Key numbers">
        <For each={kpis()}>
          {(kpi) => (
            <A class="org-kpi" href={kpi.href}>
              <span class="org-kpi-label">{kpi.label}</span>
              <span class="org-kpi-value">{kpi.value}</span>
              <Show when={kpi.meter}>
                {(meter) => (
                  <span class="org-meter" aria-hidden="true">
                    <span classList={{ "org-meter--warn": meter().warn }} style={{ width: `${meter().percent}%` }} />
                  </span>
                )}
              </Show>
              <span class="org-kpi-note">
                <Show when={kpi.dot}>
                  {(dot) => <span class="org-kpi-dot" classList={{ live: kpi.live }} style={{ background: gradientVar(dot()) }} aria-hidden="true" />}
                </Show>
                <span>{kpi.note}</span>
              </span>
            </A>
          )}
        </For>
      </section>

      <OrgChartCard data={data} actions={actions} />

      <div class="org-grid">
        <div class="org-col">
          <NeedsYou items={needs()} loading={feed.isPending} />
          <RecentActivity data={data} />
        </div>
        <div class="org-col">
          <section class="card org-card" aria-labelledby="org-runs-h">
            <div class="org-card-row">
              <h2 class="disp" id="org-runs-h">
                Runs, last 14 days
              </h2>
              <span class="org-muted">
                {runs().total} runs
                <Show when={runs().rate !== null}> · {runs().rate}% succeeded</Show>
              </span>
            </div>
            <RunsChart days={summary.data?.runActivity} />
          </section>

          <section class="card org-card" aria-labelledby="org-projects-h">
            <div class="org-card-row">
              <h2 class="disp" id="org-projects-h">
                Projects
              </h2>
              <A class="org-link org-push" href={`${base()}/issues`}>
                All tasks
              </A>
            </div>
            <ul class="org-projects">
              <For each={openProjects(projects.data)} fallback={<li class="org-muted">No projects yet.</li>}>
                {(project) => {
                  const progress = () => projectProgress(data.tasks.data, project.id);
                  const waiting = () => needs().filter((item) => item.project?.id === project.id).length;
                  const spend = () => projectSpend(projectCosts.data, project.id);
                  const policy = () => currentPolicy(projectPolicies(budgets.data, project.id).filter((p) => p.windowKind === "calendar_month_utc"));
                  return (
                    <li>
                      <div class="org-project-top">
                        <InitialsDisc name={project.name.slice(0, 1)} seed={project.id} size={20} />
                        <A class="org-project-name" href={`${base()}/projects/${project.urlKey}`}>
                          {project.name}
                        </A>
                        <span class="org-muted org-push">
                          {progress().done} of {progress().total} done
                        </span>
                      </div>
                      <span class="org-meter org-meter--done" aria-hidden="true">
                        <span style={{ width: `${progress().percent}%` }} />
                      </span>
                      <div class="org-project-meta">
                        <span>{progress().open} open</span>
                        <Show when={waiting() > 0}>
                          <span class="org-amber">
                            {waiting()} {waiting() === 1 ? "needs" : "need"} you
                          </span>
                        </Show>
                        <Show when={spend() !== null}>
                          <span>
                            {formatCents(spend() ?? 0, true)}
                            {policy() ? ` of ${formatCents(policy()!.amount, true)}` : " this month"}
                          </span>
                        </Show>
                      </div>
                    </li>
                  );
                }}
              </For>
            </ul>
          </section>

          <SpendByAgent data={data} />
        </div>
      </div>
      <DashboardWidgets />
    </div>
  );
}

function NeedsYou(props: { items: AttentionItem[]; loading: boolean }) {
  const company = useCompany();
  const base = () => `/${company().issuePrefix}`;
  const title = (item: AttentionItem) => {
    const subject = item.subject.kind === "issue" ? item.subject : item.relatedIssue;
    const name = item.subject.title ?? subject?.title ?? "Untitled";
    const id = subject?.identifier;
    return id && !name.startsWith(id) ? `${id} ${name}` : name;
  };
  const detail = (item: AttentionItem) => [item.originAgentName ? `${item.originAgentName} asked` : null, item.whyNow].filter(Boolean).join(" · ");
  const action = (kind: RequestKind) => (kind === "question" ? "Answer" : "Review");
  return (
    <section class="card org-card" aria-labelledby="org-needs-h">
      <div class="org-card-row">
        <h2 class="disp" id="org-needs-h">
          Needs you
        </h2>
        <Show when={props.items.length > 0}>
          <span class="org-count">{props.items.length}</span>
        </Show>
        <A class="org-link org-push" href={`${base()}/inbox`}>
          Open Inbox
        </A>
      </div>
      <ul class="org-needs">
        <For
          each={props.items.slice(0, NEEDS_SHOWN)}
          fallback={<li class="org-muted org-pad">{props.loading ? "Loading…" : "Nothing needs you right now."}</li>}
        >
          {(item) => {
            const kind = feedKind(item);
            const Icon = KIND_ICON[kind];
            return (
              <li class="org-need">
                <span class={`org-kind org-kind--${kind}`}>
                  <Icon size={12} aria-hidden="true" />
                  {KIND_LABEL[kind]}
                </span>
                <div class="org-need-text">
                  <Show when={item.subject.href ?? item.relatedIssue?.href} fallback={<span class="org-need-title">{title(item)}</span>}>
                    {(href) => (
                      <A class="org-need-title" href={href()}>
                        {title(item)}
                      </A>
                    )}
                  </Show>
                  <div class="org-muted org-ellipsis">{detail(item)}</div>
                </div>
                <A class={buttonClass({ size: "compact" })} href={`${base()}/inbox`}>
                  {action(kind)}
                </A>
              </li>
            );
          }}
        </For>
      </ul>
    </section>
  );
}

const ACTIVITY_ICON: Record<ActivityLine["tone"], (props: LucideProps) => JSX.Element> = {
  run: Play,
  green: BadgeCheck,
  amber: UserPlus,
  gray: ArrowRightLeft,
};

function RecentActivity(props: { data: ReturnType<typeof useOrgData> }) {
  const company = useCompany();
  const base = () => `/${company().issuePrefix}`;
  const people = useTaskPeople();
  const chats = useChatIndex();
  const activity = createQuery(() => ({
    queryKey: queryKeys.org.activity(company().id),
    queryFn: ({ signal }) => orgApi.activity(company().id, ACTIVITY_LIMIT, signal),
  }));
  const lines = createMemo(() => {
    const agentsById = new Map((props.data.agents.data ?? []).map((agent) => [agent.id, agent]));
    const names = { agent: (id: string) => agentsById.get(id), person: people.personName, youId: people.youId(), chatAgent: chats.agentIdFor };
    return (activity.data ?? []).flatMap((event) => activityLine(event, names) ?? []).slice(0, ACTIVITY_SHOWN);
  });
  const minute = useMinute();
  return (
    <section class="card org-card" aria-labelledby="org-activity-h">
      <div class="org-card-row">
        <h2 class="disp" id="org-activity-h">
          Recent activity
        </h2>
        <A class="org-link org-push" href={`${base()}/activity`}>
          All activity
        </A>
      </div>
      <ol class="org-activity">
        <For each={lines()} fallback={<li class="org-muted">{activity.isPending ? "Loading…" : "No activity yet."}</li>}>
          {(line) => {
            const Icon = line.verb.startsWith("paused") ? Pause : ACTIVITY_ICON[line.tone];
            return (
              <li>
                <span class={`org-act-icon org-act-icon--${line.tone}`} aria-hidden="true">
                  <Icon size={13} />
                </span>
                <div class="org-act-text">
                  <span class="org-act-who">{line.who}</span> {line.verb}{" "}
                  <Show when={line.href} fallback={<span class="org-act-target">{line.target}</span>}>
                    {(href) => (
                      <A class="org-act-target" href={`${base()}${href()}`}>
                        {line.target}
                      </A>
                    )}
                  </Show>
                </div>
                <time class="org-muted" datetime={line.at}>
                  {shortAgo(line.at, new Date(minute()))}
                </time>
              </li>
            );
          }}
        </For>
      </ol>
    </section>
  );
}

function RunsChart(props: { days: Parameters<typeof runDayBars>[0] }) {
  const bars = createMemo(() => runDayBars(props.days));
  const totals = createMemo(() => runTotals(props.days));
  const max = createMemo(() => chartMax(bars()));
  const pct = (value: number) => `${(value / max()) * 100}%`;
  return (
    <>
      <ul class="org-run-legend">
        <li>
          <span class="org-swatch org-swatch--ok" aria-hidden="true" />
          Succeeded <b>{totals().succeeded}</b>
        </li>
        <li>
          <span class="org-swatch org-swatch--retry" aria-hidden="true" />
          Recovered on retry <b>{totals().recovered}</b>
        </li>
        <li>
          <span class="org-swatch org-swatch--fail" aria-hidden="true" />
          Failed <b>{totals().failed}</b>
        </li>
      </ul>
      <div class="org-chart">
        <div class="org-axis" aria-hidden="true">
          <span>
            <i>{max()}</i>
          </span>
          <span>
            <i>{max() / 2}</i>
          </span>
          <span>
            <i>0</i>
          </span>
        </div>
        <div
          class="org-bars"
          role="img"
          aria-label={`Runs per day over the last 14 days: ${totals().total} in all, ${totals().succeeded} succeeded, ${totals().failed} failed`}
        >
          <For each={bars()}>
            {(bar) => (
              <div class="org-bar" title={bar.tip} style={{ height: pct(bar.total) }}>
                <span class="org-bar-ok" style={{ "flex-grow": bar.succeeded + bar.other }} />
                <Show when={bar.recovered > 0}>
                  <span class="org-bar-retry" style={{ "flex-grow": bar.recovered }} />
                </Show>
                <Show when={bar.failed > 0}>
                  <span class="org-bar-fail" style={{ "flex-grow": bar.failed }} />
                </Show>
              </div>
            )}
          </For>
        </div>
        <div class="org-bar-labels" aria-hidden="true">
          <For each={bars()}>{(bar) => <span>{bar.label}</span>}</For>
        </div>
      </div>
    </>
  );
}

function SpendByAgent(props: { data: ReturnType<typeof useOrgData> }) {
  const company = useCompany();
  const spend = createMemo(() => topSpenders(props.data.rows()));
  const month = () => monthWindow(new Date()).name;
  return (
    <section class="card org-card" aria-labelledby="org-spend-h">
      <div class="org-card-row">
        <h2 class="disp" id="org-spend-h">
          {month()} spend by agent
        </h2>
        <A class="org-link org-push" href={`/${company().issuePrefix}/company/settings/budgets`}>
          Budgets
        </A>
      </div>
      <ul class="org-spend">
        <For each={spend().top} fallback={<li class="org-muted">No spend yet this month.</li>}>
          {(row) => (
            <li title={`${row.agent.name}: ${formatCents(row.spendCents)}${row.budgetCents > 0 ? ` of a ${formatCents(row.budgetCents, true)} budget` : ""}`}>
              <span class="org-spend-who">
                <AgentAvatar agent={row.agent} size={20} />
                <span class="org-ellipsis">{row.agent.name}</span>
              </span>
              <span class="org-spend-track" aria-hidden="true">
                <span style={{ width: `${spend().max ? (row.spendCents / spend().max) * 100 : 0}%` }} />
              </span>
              <span class="org-spend-amount">{formatCents(row.spendCents)}</span>
            </li>
          )}
        </For>
      </ul>
      <Show when={spend().rest.names.length > 0}>
        <div class="org-spend-rest">
          {spend().rest.names.join(", ")}: {formatCents(spend().rest.cents)}
        </div>
      </Show>
    </section>
  );
}
