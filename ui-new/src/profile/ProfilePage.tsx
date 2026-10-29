import type { IssueStatus, UserProfileResponse, UserProfileWindowStats } from "@paperclipai/shared";
import { A, useParams } from "@solidjs/router";
import { createQuery } from "@tanstack/solid-query";
import { UserRoundPen } from "lucide-solid";
import { createMemo, createSignal, For, Match, Show, Switch } from "solid-js";
import { queryKeys } from "@/api/queryKeys";
import { userProfilesApi } from "@/api/user-profiles";
import { formatTokens, providerLabel } from "@/activity/costs-model";
import { formatCents } from "@/agents/agent-model";
import { useCompany } from "@/lib/company";
import { useSession } from "@/lib/session";
import { updatedLabel } from "@/tasks/list-model";
import { InitialsDisc } from "@/ui/Avatar";
import { buttonClass } from "@/ui/Button";
import { PageHeader } from "@/ui/PageHeader";
import { Segmented } from "@/ui/Segmented";
import { StatusCapsule } from "@/ui/Status";
import { STATUS_META } from "@/ui/status-meta";
import { actionLabel, chartDays, completionRate, displayName, profileSlug, totalTokens, windowOf } from "./profile-model";
import "./Profile.css";

/*
 * `/:prefix/u/:slug`, a person's profile in this company (decision 39, D4; after
 * ui/src/pages/UserProfile.tsx): read-only, from one request (`GET /companies/:id/users/:slug/profile`).
 * `me` is you; the You menu's View profile opens it. No board draws it, so it's built from Capsule
 * Stack pieces: the page header with the headline numbers, the windows (7 days, 30 days, all time)
 * in a segmented card, fourteen days of token use as capsule bars with the days' completions, recent
 * tasks and actions, and what agents spent on this person's tasks, by agent and by provider.
 */

const WINDOWS = [
  { value: "last7", label: "7 days" },
  { value: "last30", label: "30 days" },
  { value: "all", label: "All time" },
] as const;

type WindowKey = UserProfileWindowStats["key"];

export function ProfilePage() {
  const params = useParams<{ slug: string }>();
  const company = useCompany();
  const session = useSession();
  const slug = () => profileSlug(params.slug, session.youId());
  const profile = createQuery(() => ({
    queryKey: queryKeys.userProfile(company().id, slug()),
    queryFn: ({ signal }) => userProfilesApi.get(company().id, slug(), signal),
    retry: false,
  }));

  return (
    <Switch>
      <Match when={profile.isPending}>
        <PageHeader crumbs={<span>People</span>} title={params.slug === "me" ? "You" : params.slug} />
        <p class="card prof-note" role="status">
          Loading the profile…
        </p>
      </Match>
      <Match when={profile.isError}>
        <PageHeader crumbs={<span>People</span>} title={params.slug} />
        <p class="card prof-note">There's no one with this address in {company().name}, or you can't see their profile.</p>
      </Match>
      <Match when={profile.data}>{(data) => <Profile data={data()} />}</Match>
    </Switch>
  );
}

function Profile(props: { data: UserProfileResponse }) {
  const company = useCompany();
  const session = useSession();
  const user = () => props.data.user;
  const name = () => displayName(user());
  const own = () => user().id === session.youId();
  const all = () => windowOf(props.data, "all");
  const week = () => windowOf(props.data, "last7");
  const joined = () => new Date(user().joinedAt).toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" });
  return (
    <>
      <PageHeader
        crumbs={<span>{company().name} · People</span>}
        mark={
          <Show when={user().image} fallback={<InitialsDisc name={name()} you={own()} size={44} />}>
            {(src) => <img class="prof-avatar" src={src()} alt="" width={44} height={44} />}
          </Show>
        }
        title={name()}
        numbers={
          <>
            <span class="mono muted">@{user().slug}</span>
            <span class="muted">{[user().membershipRole ?? "member", user().membershipStatus, `joined ${joined()}`].join(" · ")}</span>
            <Show when={user().email}>{(email) => <span class="muted">{email()}</span>}</Show>
          </>
        }
        actions={
          <Show when={own()}>
            <A class={buttonClass({ size: "compact" })} href={`/${company().issuePrefix}/company/settings/instance/account`}>
              <UserRoundPen size={14} aria-hidden="true" />
              Edit profile
            </A>
          </Show>
        }
      />

      <section class="card prof-hero" aria-label="Headline numbers">
        <Hero label="All-time tokens" value={formatTokens(all() ? totalTokens(all()!) : 0)} hint={`${formatCents(all()?.costCents ?? 0)} spent`} />
        <Hero label="Completed" value={String(all()?.completedIssues ?? 0)} hint={all() ? `${completionRate(all()!)}% of what they touched` : undefined} />
        <Hero label="Open, assigned" value={String(all()?.assignedOpenIssues ?? 0)} hint={`${all()?.createdIssues ?? 0} created`} />
        <Hero label="Actions this week" value={String(week()?.activityCount ?? 0)} hint={`${week()?.commentCount ?? 0} comments`} />
      </section>

      <div class="prof-grid">
        <Windows data={props.data} />
        <Chart data={props.data} />
      </div>

      <div class="prof-grid">
        <RecentTasks data={props.data} />
        <RecentActivity data={props.data} />
      </div>

      <div class="prof-grid">
        <Usage
          title="Agent attribution"
          note="What agents spent working on this person's tasks."
          empty="No task-linked token use yet."
          rows={props.data.topAgents.map((row) => ({
            key: row.agentId ?? "services",
            label: row.agentName ?? (row.agentId ? row.agentId.slice(0, 8) : "Paperclip services"),
            sub: "Task-linked use",
            ...row,
          }))}
        />
        <Usage
          title="Provider mix"
          note="The models behind that spend."
          empty="No provider use attributed yet."
          rows={props.data.topProviders.map((row) => ({
            key: `${row.provider}:${row.biller}:${row.model}`,
            label: `${providerLabel(row.provider)} · ${row.model}`,
            sub: `Billed through ${providerLabel(row.biller)}`,
            ...row,
          }))}
        />
      </div>
    </>
  );
}

function Hero(props: { label: string; value: string; hint?: string }) {
  return (
    <div class="prof-hero-cell">
      <b class="disp">{props.value}</b>
      <span class="lbl">{props.label}</span>
      <Show when={props.hint}>
        <small class="muted">{props.hint}</small>
      </Show>
    </div>
  );
}

function Windows(props: { data: UserProfileResponse }) {
  const [key, setKey] = createSignal<WindowKey>("last7");
  const stats = () => windowOf(props.data, key());
  return (
    <section class="card prof-card" aria-labelledby="prof-windows-h">
      <div class="prof-card-head">
        <h2 id="prof-windows-h" class="prof-h">
          Work
        </h2>
        <Segmented label="Window" options={WINDOWS} value={key()} onChange={setKey} />
      </div>
      <Show when={stats()}>
        {(entry) => (
          <>
            <div class="prof-metrics">
              <Metric value={entry().touchedIssues} label="Touched" />
              <Metric value={entry().completedIssues} label="Completed" />
              <Metric value={entry().commentCount} label="Comments" />
              <Metric value={entry().activityCount} label="Actions" />
            </div>
            <dl class="prof-facts">
              <div>
                <dt>Done</dt>
                <dd>{completionRate(entry())}%</dd>
              </div>
              <div>
                <dt>Tokens</dt>
                <dd>{formatTokens(totalTokens(entry()))}</dd>
              </div>
              <div>
                <dt>Spend</dt>
                <dd>{formatCents(entry().costCents)}</dd>
              </div>
              <div>
                <dt>Created</dt>
                <dd>{entry().createdIssues}</dd>
              </div>
              <div>
                <dt>Open</dt>
                <dd>{entry().assignedOpenIssues}</dd>
              </div>
            </dl>
          </>
        )}
      </Show>
    </section>
  );
}

function Metric(props: { value: number; label: string }) {
  return (
    <div class="prof-metric">
      <b class="disp">{props.value.toLocaleString()}</b>
      <span class="cap">{props.label}</span>
    </div>
  );
}

function Chart(props: { data: UserProfileResponse }) {
  const days = createMemo(() => chartDays(props.data.daily));
  const total = () => days().reduce((sum, day) => sum + day.tokens, 0);
  return (
    <section class="card prof-card" aria-labelledby="prof-chart-h">
      <div class="prof-card-head">
        <h2 id="prof-chart-h" class="prof-h">
          Last 14 days
        </h2>
        <span class="muted">
          <b class="prof-strong">{formatTokens(total())}</b> tokens
        </span>
      </div>
      <ol class="prof-bars" aria-label="Tokens and completions per day">
        <For each={days()}>
          {(day) => (
            <li class="prof-day" title={`${day.label}: ${formatTokens(day.tokens)} tokens, ${day.completed} completed`}>
              <span class="sr-only">
                {day.label}: {formatTokens(day.tokens)} tokens, {day.completed} completed
              </span>
              <span class="prof-bar-track" aria-hidden="true">
                <span class="prof-bar" style={{ height: `${day.height}%` }} />
              </span>
              <span class="prof-done" aria-hidden="true" data-on={day.completed > 0 ? "" : undefined} />
              <span class="prof-tick" aria-hidden="true">
                {day.tick ? day.label : ""}
              </span>
            </li>
          )}
        </For>
      </ol>
      <div class="prof-legend" aria-hidden="true">
        <span>
          <i class="prof-key prof-key--bar" /> tokens a day
        </span>
        <span>
          <i class="prof-key prof-key--done" /> tasks completed
        </span>
      </div>
    </section>
  );
}

function RecentTasks(props: { data: UserProfileResponse }) {
  const company = useCompany();
  return (
    <section class="card prof-card" aria-labelledby="prof-tasks-h">
      <div class="prof-card-head">
        <h2 id="prof-tasks-h" class="prof-h">
          Recent tasks
        </h2>
        <span class="muted">{props.data.recentIssues.length}</span>
      </div>
      <Show when={props.data.recentIssues.length > 0} fallback={<p class="muted prof-empty">No tasks touched yet.</p>}>
        <ul class="prof-rows">
          <For each={props.data.recentIssues}>
            {(issue) => (
              <li>
                <A class="prof-row" href={`/${company().issuePrefix}/issues/${encodeURIComponent(issue.identifier ?? issue.id)}`}>
                  <Show when={issue.status in STATUS_META}>
                    <StatusCapsule status={issue.status as IssueStatus} size="row" />
                  </Show>
                  <span class="mono muted prof-id">{issue.identifier ?? issue.id.slice(0, 8)}</span>
                  <span class="prof-row-title">{issue.title}</span>
                  <span class="muted prof-when">{updatedLabel(new Date(issue.updatedAt))}</span>
                </A>
              </li>
            )}
          </For>
        </ul>
      </Show>
    </section>
  );
}

function RecentActivity(props: { data: UserProfileResponse }) {
  return (
    <section class="card prof-card" aria-labelledby="prof-activity-h">
      <div class="prof-card-head">
        <h2 id="prof-activity-h" class="prof-h">
          Recent activity
        </h2>
        <span class="muted">{props.data.recentActivity.length}</span>
      </div>
      <Show when={props.data.recentActivity.length > 0} fallback={<p class="muted prof-empty">No actions of their own recorded yet.</p>}>
        <ul class="prof-rows">
          <For each={props.data.recentActivity}>
            {(event) => (
              <li class="prof-row prof-row--static">
                <span class="prof-row-title">
                  {actionLabel(event.action)}
                  <small class="muted">
                    {event.entityType} · <span class="mono">{event.entityId.slice(0, 12)}</span>
                  </small>
                </span>
                <span class="muted prof-when">{updatedLabel(new Date(event.createdAt))}</span>
              </li>
            )}
          </For>
        </ul>
      </Show>
    </section>
  );
}

type UsageRow = { key: string; label: string; sub: string; costCents: number; inputTokens: number; cachedInputTokens: number; outputTokens: number };

function Usage(props: { title: string; note: string; empty: string; rows: UsageRow[] }) {
  const max = () => Math.max(1, ...props.rows.map((row) => totalTokens(row)));
  return (
    <section class="card prof-card" aria-label={props.title}>
      <div class="prof-card-head">
        <div>
          <h2 class="prof-h">{props.title}</h2>
          <p class="cap">{props.note}</p>
        </div>
        <span class="muted">{props.rows.length}</span>
      </div>
      <Show when={props.rows.length > 0} fallback={<p class="muted prof-empty">{props.empty}</p>}>
        <ul class="prof-rows">
          <For each={props.rows}>
            {(row) => (
              <li class="prof-row prof-row--static prof-usage">
                <span class="prof-row-title">
                  {row.label}
                  <small class="muted">{row.sub}</small>
                </span>
                <span class="prof-usage-nums">
                  <span class="muted">{formatTokens(totalTokens(row))}</span>
                  <b>{formatCents(row.costCents)}</b>
                </span>
                <span class="prof-meter" aria-hidden="true">
                  <span style={{ width: `${Math.round((totalTokens(row) / max()) * 100)}%` }} />
                </span>
              </li>
            )}
          </For>
        </ul>
      </Show>
    </section>
  );
}
