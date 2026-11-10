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
import {
  clampNavWidth,
  inStoredOrder,
  moveId,
  NAV_AUTO_RAIL_BELOW,
  navRoomChanged,
  openTaskRef,
  parseNavMode,
  parseNavWidth,
  parseRecent,
  recordRecent,
  refreshRecent,
  setNavFoldMode,
  shownNavMode,
  toggleNavHidden,
  toggleNavRail,
  type NavFold,
  type NavMode,
  type RecentTask,
} from "./nav-model";
import "@/agents/AgentStar.css";

/*
 * What the nav remembers for you (nav-model.ts has the rules):
 *
 * - Starred projects (your memberships, as agents' stars), with a star button for the project header
 *   and the projects list.
 * - The order of your projects and companies, kept on the server per person
 *   (`/companies/:id/sidebar-preferences/me`, `/sidebar-preferences/me`).
 * - Which nav sections you folded, whether the nav is full or the icon rail (`[`), whether it's
 *   hidden (Shift+`[`), and how wide you dragged it, per browser. A window narrower than
 *   `NAV_AUTO_RAIL_BELOW` shows the rail by itself; `[` there switches it only until the window
 *   is wide again, and your saved choice is untouched (nav-model.ts `NavFold`).
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
    /** False while your order is loading for the first time (a fetch with nothing to show yet). */
    settled: () => !order.isLoading,
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

const MODE_KEY = "paperclip.ui-new.nav-mode";

const [fold, setFoldSignal] = createSignal<NavFold>({
  mode: parseNavMode(readJson<unknown>(MODE_KEY, null)),
  hidden: readJson<boolean>(HIDDEN_KEY, false) === true,
  override: null,
});

// Whether the window is too narrow for the full nav (nav-model.ts `autoRail`), kept by a media query.
const ROOM_QUERY = `(min-width: ${NAV_AUTO_RAIL_BELOW}px)`;
const narrowNow = () => typeof window !== "undefined" && typeof window.matchMedia === "function" && !window.matchMedia(ROOM_QUERY).matches;
const [narrow, setNarrow] = createSignal<boolean>(narrowNow());
if (typeof window !== "undefined" && typeof window.matchMedia === "function") {
  window.matchMedia(ROOM_QUERY).addEventListener("change", () => recheckNavRoom());
}

/** Reads the window's room again (the media query does it live; tests set `innerWidth` and call it). */
export function recheckNavRoom() {
  const next = narrowNow();
  if (next === narrow()) return;
  setNarrow(next);
  updateFold(navRoomChanged(fold()));
}

function updateFold(next: NavFold) {
  const before = fold();
  setFoldSignal(next);
  if (next.mode !== before.mode) writeJson(MODE_KEY, next.mode);
  if (next.hidden !== before.hidden) writeJson(HIDDEN_KEY, next.hidden);
}

/** Whether you hid the left nav (Shift+`[`, Hide navigation, or a drag past the edge). */
export const navHidden = () => fold().hidden;

/** Whether the window is too narrow for the full nav, so it shows the rail unless you said otherwise. */
export const navNarrow = narrow;

/** Full or rail, as the nav shows now: your saved choice, or the rail in a narrow window. */
export const navMode = () => shownNavMode(fold(), narrow());

export function setNavHidden(hidden: boolean) {
  if (hidden !== fold().hidden) updateFold(toggleNavHidden(fold()));
}

/** Shows the nav full or as the rail (saved; in a narrow window, until there's room again). */
export function setNavMode(mode: NavMode) {
  updateFold(setNavFoldMode(fold(), narrow(), mode));
}

/** `[`: full to rail and back, or a hidden nav back as it was. */
export function toggleNavRailPref() {
  updateFold(toggleNavRail(fold(), narrow()));
}

const WIDTH_KEY = "paperclip.ui-new.nav-width";
const [navWidth, setNavWidthSignal] = createSignal<number>(parseNavWidth(readJson<unknown>(WIDTH_KEY, null)));

/** How wide the left nav is, as you dragged it. */
export { navWidth };

/** Sets the nav's width; `save` keeps it for the next visit (at the end of a drag, not every move). */
export function setNavWidth(width: number, save = true) {
  const next = clampNavWidth(width);
  setNavWidthSignal(next);
  if (save) writeJson(WIDTH_KEY, next);
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
