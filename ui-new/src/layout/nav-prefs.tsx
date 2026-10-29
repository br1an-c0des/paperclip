import type { IssueStatus, IssueSummary, Project, ResourceMemberships, SidebarOrderPreference } from "@paperclipai/shared";
import { useLocation } from "@solidjs/router";
import { createMutation, createQuery, useQueryClient } from "@tanstack/solid-query";
import { Star } from "lucide-solid";
import { createEffect, createMemo, createSignal, on } from "solid-js";
import { api } from "@/api/client";
import { queryKeys } from "@/api/queryKeys";
import { resourceMembershipsApi } from "@/api/resource-memberships";
import { useCompany } from "@/lib/company";
import { useSession } from "@/lib/session";
import { useTaskByRef } from "@/tasks/TasksView";
import { buttonClass } from "@/ui/Button";
import { pushToast } from "@/ui/Toast";
import { inStoredOrder, moveId, openTaskRef, parseRecent, recordRecent, refreshRecent, type RecentTask } from "./nav-model";
import "@/agents/AgentStar.css";

/*
 * What the nav remembers for you (nav-model.ts has the rules):
 *
 * - Starred projects (your memberships, as agents' stars), with a star button for the project header
 *   and the projects list.
 * - The order of your projects and companies, kept on the server per person
 *   (`/companies/:id/sidebar-preferences/me`, `/sidebar-preferences/me`).
 * - Which nav sections you folded, and whether the nav is hidden (`[`), per browser.
 * - The tasks you opened lately, per browser and company, refreshed from
 *   `GET /companies/:id/issues/summaries`.
 */

// ---------------------------------------------------------------------------------------------
// Starred projects

export function useProjectStars() {
  const company = useCompany();
  const client = useQueryClient();
  const key = () => queryKeys.projectSettings.memberships(company().id);
  const memberships = createQuery(() => ({
    queryKey: key(),
    queryFn: ({ signal }) => resourceMembershipsApi.mine(company().id, signal),
    staleTime: 30_000,
    retry: false,
  }));
  const toggle = createMutation(() => ({
    mutationFn: (input: { projectId: string; name: string; starred: boolean }) =>
      resourceMembershipsApi.updateProject(company().id, input.projectId, input.starred ? { state: "joined", starred: true } : { starred: false }),
    onMutate: async (input) => {
      await client.cancelQueries({ queryKey: key() });
      const previous = client.getQueryData<ResourceMemberships>(key());
      if (previous) {
        const ids = (previous.starredProjectIds ?? []).filter((id) => id !== input.projectId);
        client.setQueryData<ResourceMemberships>(key(), {
          ...previous,
          projectMemberships: input.starred ? { ...previous.projectMemberships, [input.projectId]: "joined" } : previous.projectMemberships,
          starredProjectIds: input.starred ? [input.projectId, ...ids] : ids,
        });
      }
      return { previous };
    },
    onError: (error, input, context) => {
      if (context?.previous) client.setQueryData(key(), context.previous);
      pushToast({ tone: "error", title: `Couldn't ${input.starred ? "star" : "unstar"} ${input.name}`, body: error instanceof Error ? error.message : undefined });
    },
    onSettled: () => {
      void client.invalidateQueries({ queryKey: key() });
      void client.invalidateQueries({ queryKey: queryKeys.projects.all(company().id) });
    },
  }));
  const starred = (projectId: string) => memberships.data?.starredProjectIds?.includes(projectId) ?? false;
  return {
    memberships,
    starred,
    toggle: (project: Pick<Project, "id" | "name">) => toggle.mutate({ projectId: project.id, name: project.name, starred: !starred(project.id) }),
    /** Leaving a project takes it out of your nav (project settings → Members can bring it back). */
    leave: (project: Pick<Project, "id" | "name">) =>
      resourceMembershipsApi
        .updateProject(company().id, project.id, { state: "left" })
        .then(() => {
          void client.invalidateQueries({ queryKey: key() });
          pushToast({ tone: "success", title: `Left ${project.name}`, body: "It's out of your nav. Join again from the project's settings." });
        })
        .catch((error: Error) => pushToast({ tone: "error", title: `Couldn't leave ${project.name}`, body: error.message })),
  };
}

/** A star button: filled when the project is in your nav's Starred group. */
export function ProjectStarButton(props: { project: Pick<Project, "id" | "name">; size?: number }) {
  const stars = useProjectStars();
  const on = () => stars.starred(props.project.id);
  return (
    <button
      type="button"
      class={`${buttonClass({ variant: "icon", size: "compact", ghost: true })} agent-star`}
      classList={{ "agent-star--on": on() }}
      aria-pressed={on()}
      aria-label={on() ? `Unstar ${props.project.name}` : `Star ${props.project.name}`}
      title={on() ? "Starred: it's in your nav's Starred group. Click to unstar." : "Star: keep it in your nav's Starred group"}
      onClick={(event) => {
        event.preventDefault();
        event.stopPropagation();
        stars.toggle(props.project);
      }}
    >
      <Star size={props.size ?? 15} aria-hidden="true" fill={on() ? "currentColor" : "none"} />
    </button>
  );
}

// ---------------------------------------------------------------------------------------------
// Your order

const sidebarApi = {
  companyOrder: (signal?: AbortSignal) => api.get<SidebarOrderPreference>("/sidebar-preferences/me", { signal }),
  setCompanyOrder: (orderedIds: string[]) => api.put<SidebarOrderPreference>("/sidebar-preferences/me", { orderedIds }),
  projectOrder: (companyId: string, signal?: AbortSignal) => api.get<SidebarOrderPreference>(`/companies/${companyId}/sidebar-preferences/me`, { signal }),
  setProjectOrder: (companyId: string, orderedIds: string[]) => api.put<SidebarOrderPreference>(`/companies/${companyId}/sidebar-preferences/me`, { orderedIds }),
};

function useOrder(input: {
  key: () => readonly unknown[];
  enabled: () => boolean;
  read: (signal: AbortSignal) => Promise<SidebarOrderPreference>;
  write: (ids: string[]) => Promise<SidebarOrderPreference>;
  what: string;
}) {
  const client = useQueryClient();
  const order = createQuery(() => ({
    queryKey: input.key(),
    queryFn: ({ signal }) => input.read(signal),
    enabled: input.enabled(),
    staleTime: 60_000,
    retry: false,
  }));
  const save = createMutation(() => ({
    mutationFn: (ids: string[]) => input.write(ids),
    onMutate: (ids) => {
      const previous = client.getQueryData<SidebarOrderPreference>(input.key());
      client.setQueryData<SidebarOrderPreference>(input.key(), { orderedIds: ids, updatedAt: previous?.updatedAt ?? null });
      return { previous };
    },
    onError: (error, _ids, context) => {
      client.setQueryData(input.key(), context?.previous);
      pushToast({ tone: "error", title: `Couldn't save the ${input.what} order`, body: error instanceof Error ? error.message : undefined });
    },
    onSuccess: (saved) => client.setQueryData(input.key(), saved),
  }));
  return {
    ordered: <T extends { id: string }>(items: readonly T[]) => inStoredOrder(items, order.data?.orderedIds),
    /** Moves one item, saving the whole visible order (what isn't shown keeps its place after). */
    move: <T extends { id: string }>(items: readonly T[], id: string, delta: -1 | 1) => {
      const ids = inStoredOrder(items, order.data?.orderedIds).map((item) => item.id);
      const next = moveId(ids, id, delta);
      if (next.join() !== ids.join()) save.mutate(next);
    },
  };
}

export function useProjectOrder() {
  const company = useCompany();
  const session = useSession();
  return useOrder({
    key: () => queryKeys.sidebarPreferences.projectOrder(company().id, session.youId() ?? "anonymous"),
    enabled: () => !!session.youId(),
    read: (signal) => sidebarApi.projectOrder(company().id, signal),
    write: (ids) => sidebarApi.setProjectOrder(company().id, ids),
    what: "project",
  });
}

export function useCompanyOrder() {
  const session = useSession();
  return useOrder({
    key: () => queryKeys.sidebarPreferences.companyOrder(session.youId() ?? "anonymous"),
    enabled: () => !!session.youId(),
    read: (signal) => sidebarApi.companyOrder(signal),
    write: (ids) => sidebarApi.setCompanyOrder(ids),
    what: "company",
  });
}


// ---------------------------------------------------------------------------------------------
// Folded sections and the hidden nav (per browser)

const COLLAPSED_KEY = "paperclip.ui-new.nav-collapsed";
const HIDDEN_KEY = "paperclip.ui-new.nav-hidden";

function readJson<T>(key: string, fallback: T): T {
  try {
    const raw = localStorage.getItem(key);
    return raw ? (JSON.parse(raw) as T) : fallback;
  } catch {
    return fallback;
  }
}

function writeJson(key: string, value: unknown) {
  try {
    localStorage.setItem(key, JSON.stringify(value));
  } catch {
    // Storage unavailable: the choice lasts until the page reloads.
  }
}

const [collapsed, setCollapsed] = createSignal<string[]>(readJson<string[]>(COLLAPSED_KEY, []));

/** Whether a nav section is folded, and a toggle. */
export function navSection(key: string) {
  return {
    folded: () => collapsed().includes(key),
    toggle: () => {
      const next = collapsed().includes(key) ? collapsed().filter((entry) => entry !== key) : [...collapsed(), key];
      setCollapsed(next);
      writeJson(COLLAPSED_KEY, next);
    },
  };
}

const [navHidden, setNavHiddenSignal] = createSignal<boolean>(readJson<boolean>(HIDDEN_KEY, false) === true);

/** Whether you hid the left nav (`[`, or its own button). */
export { navHidden };

export function setNavHidden(hidden: boolean) {
  setNavHiddenSignal(hidden);
  writeJson(HIDDEN_KEY, hidden);
}

// ---------------------------------------------------------------------------------------------
// The task open on the page, and the tasks you opened lately

/** The task the page has open (the full page or a list's panel), loaded as the page loads it. */
export function useOpenTask() {
  const company = useCompany();
  const location = useLocation();
  const ref = () => openTaskRef(location.pathname, location.search, company().issuePrefix);
  return useTaskByRef(ref).task;
}

const recentKey = (companyId: string, youId: string | null) => `paperclip.ui-new.recent-tasks:${companyId}:${youId ?? "anonymous"}`;
const [recentVersion, bumpRecent] = createSignal(0);

function readRecent(key: string) {
  try {
    return parseRecent(localStorage.getItem(key));
  } catch {
    return [];
  }
}

/** Records each task you open in this company, from any page (the full page, a panel or the modal's page). */
export function useRecordRecentTasks(task: () => { id: string; identifier: string | null; title: string; status: IssueStatus } | undefined) {
  const company = useCompany();
  const session = useSession();
  createEffect(
    on(
      () => task()?.id,
      () => {
        const current = task();
        if (!current) return;
        const key = recentKey(company().id, session.youId());
        writeJson(key, recordRecent(readRecent(key), current, Date.now()));
        bumpRecent((value) => value + 1);
      },
    ),
  );
}

/** Your recent tasks, with titles and statuses as the server has them now. */
export function useRecentTasks() {
  const company = useCompany();
  const session = useSession();
  const stored = createMemo<RecentTask[]>(() => {
    recentVersion();
    return readRecent(recentKey(company().id, session.youId()));
  });
  const ids = createMemo(() => stored().map((entry) => entry.id).sort(), [], { equals: (a, b) => a.join() === b.join() });
  const summaries = createQuery(() => ({
    queryKey: queryKeys.recentTasks(company().id, ids()),
    queryFn: ({ signal }) =>
      api.get<IssueSummary[]>(`/companies/${company().id}/issues/summaries?${new URLSearchParams({ ids: ids().join(",") })}`, { signal }),
    enabled: ids().length > 0,
    staleTime: 30_000,
    retry: false,
  }));
  return createMemo(() => refreshRecent(stored(), summaries.isError ? undefined : summaries.data));
}
