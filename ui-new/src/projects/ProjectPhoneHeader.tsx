import type { Project } from "@paperclipai/shared";
import { A, useNavigate } from "@solidjs/router";
import { createQuery } from "@tanstack/solid-query";
import { CalendarDays, ChevronDown, Ellipsis, Gauge, Search, Settings2, Star } from "lucide-solid";
import { createEffect, createMemo, createSignal, For, on, onCleanup, Show, type JSX } from "solid-js";
import { ARTIFACTS_PAGE_SIZE, artifactsApi } from "@/api/artifacts";
import { queryKeys } from "@/api/queryKeys";
import { useCompany } from "@/lib/company";
import { useAgentsQuery, useLiveRunsQuery } from "@/lib/company-data";
import { useProjectStars } from "@/layout/nav-prefs";
import { openTasksSwitcher, tasksSwitcherOpener } from "@/layout/PhoneDock";
import { AgentAvatar } from "@/ui/Avatar";
import { Menu } from "@/ui/Menu";
import { crew, type CrewState, type ProjectTask } from "./dashboard-model";
import { docsNumbers, headerAgents, headerSearch, phoneView } from "./phone-header-model";
import type { CharacterState } from "@paperclipai/shared";
import "./ProjectPhoneHeader.css";

/*
 * The project header on a phone (design/mobile.md M1, M12, M13; boards Main, ProjectOverview and
 * ProjectDocs), in place of the desktop header card:
 *
 * - the crumb line: Projects, the project's status and target date, then search and More;
 * - the name, which opens the dock's Tasks switcher (all tasks and each project with its count);
 * - on Overview, the description;
 * - the key numbers (open, running, blocked) and the agents on the project, each with a state bar
 *   and a link to the agent (its chat, M9); on Docs, how many docs and files the tasks hold instead;
 * - the views a phone has, Overview, List and Docs, below a divider. Board, workload and settings
 *   stay on desktop (mobile.md, "Scope"); More still reaches workload, plugin tabs and settings.
 *
 * The list's Group and quick filters are the task list's own phone toolbar, under this card. The
 * list also has its own search there, so the header's search shows on Overview and Docs only.
 */

const POSE: Record<CrewState, CharacterState> = {
  running: "working",
  queued: "loading",
  blocked: "confused",
  error: "confused",
  paused: "sleepy",
  idle: "idle",
};

export type PhoneHeaderNumbers = { open: number; running: number; blocked: number };

export function ProjectPhoneHeader(props: {
  project: Project | undefined;
  /** Shown as the name until the project loads. */
  fallbackName: string;
  base: string;
  /** The route's tab, such as "issues" or "docs". */
  tab: string;
  status: JSX.Element;
  /** The target date, already formatted. */
  target: string | null;
  /** Null until the project's tasks load. */
  numbers: PhoneHeaderNumbers | null;
  tasks: readonly ProjectTask[] | undefined;
  pluginTabs: readonly { label: string; href: string }[];
  /** Plugins' toolbar buttons and launchers for the project. */
  plugins?: JSX.Element;
}) {
  const company = useCompany();
  const navigate = useNavigate();
  const agents = useAgentsQuery();
  const liveRuns = useLiveRunsQuery();
  const view = () => phoneView(props.tab);

  const members = createMemo(() => (props.tasks ? crew({ tasks: props.tasks, liveRuns: liveRuns.data, agents: agents.data }) : []));
  const crewShown = createMemo(() => headerAgents(members(), agents.data));
  const agentFor = (id: string) => agents.data?.find((agent) => agent.id === id);

  // Docs counts what the Docs tab lists; the same request, so it's read from the cache.
  const docs = createQuery(() => ({
    queryKey: queryKeys.artifacts.project(company().id, props.project?.id ?? ""),
    queryFn: ({ signal }) =>
      artifactsApi.list(company().id, { projectId: props.project!.id, groupBy: "task", limit: ARTIFACTS_PAGE_SIZE }, signal),
    enabled: view() === "docs" && !!props.project,
  }));
  const docCounts = () => docsNumbers(docs.data?.groups);

  const search = () => (props.project ? headerSearch(view(), company().issuePrefix, props.project.id) : null);

  let nameButton: HTMLButtonElement | undefined;
  const switchProject = () => {
    const scope = props.project ? { kind: "project" as const, key: props.project.urlKey } : null;
    if (!openTasksSwitcher(nameButton ?? null, scope)) navigate(`/${company().issuePrefix}/projects`);
  };

  return (
    <header class="card pph">
      <div class="pph-crumbs">
        <A class="pph-crumb" href={`/${company().issuePrefix}/projects`}>
          Projects
        </A>
        <span aria-hidden="true">/</span>
        <Show when={props.project}>
          {props.status}
          <Show when={props.target}>
            {(target) => (
              <span class="pph-target" title="Target date">
                <CalendarDays size={13} aria-hidden="true" />
                <span class="sr-only">Target</span>
                {target()}
              </span>
            )}
          </Show>
        </Show>
        <div class="pph-icons">
          <Show when={search()}>
            {(found) => (
              <A class="pph-ib" href={found().href} aria-label={found().label}>
                <Search size={18} stroke-width={1.9} aria-hidden="true" />
              </A>
            )}
          </Show>
          <Show when={props.project}>{(found) => <MoreMenu project={found()} base={props.base} pluginTabs={props.pluginTabs} />}</Show>
        </div>
      </div>

      <h1 class="pph-title">
        <button
          ref={nameButton}
          type="button"
          class="pph-name"
          aria-haspopup="dialog"
          aria-expanded={!!nameButton && tasksSwitcherOpener() === nameButton}
          aria-label={`${props.project?.name ?? props.fallbackName}, switch project`}
          onClick={switchProject}
        >
          <span class="pph-name-text disp">{props.project?.name ?? props.fallbackName}</span>
          <ChevronDown size={18} stroke-width={2.2} aria-hidden="true" class="pph-caret" />
        </button>
      </h1>

      <Show when={view() === "overview" && props.project?.description?.trim()}>{(text) => <Description text={text()} />}</Show>

      <Show
        when={view() !== "docs"}
        fallback={
          <Show when={docCounts()}>
            {(counts) => (
              <div class="pph-numbers">
                <span>
                  <b class="pph-num">{counts().items}</b> {counts().items === 1 ? "doc or file" : "docs and files"}
                </span>
                <span>
                  <b class="pph-num">{counts().tasks}</b> {counts().tasks === 1 ? "task with files" : "tasks with files"}
                </span>
              </div>
            )}
          </Show>
        }
      >
        <Show when={props.numbers || crewShown().shown.length > 0}>
          <div class="pph-stats">
            <Show when={props.numbers}>
              {(numbers) => (
                <div class="pph-numbers">
                  <span>
                    <b class="pph-num">{numbers().open}</b> open
                  </span>
                  <Show when={numbers().running > 0}>
                    <span>
                      <b class="pph-num">{numbers().running}</b> running
                    </span>
                  </Show>
                  <Show when={numbers().blocked > 0}>
                    <span class="pph-red">
                      <b class="pph-num">{numbers().blocked}</b> blocked
                    </span>
                  </Show>
                </div>
              )}
            </Show>
            <Show when={crewShown().shown.length > 0}>
              <div class="pph-agents" role="group" aria-label="Agents on this project">
                <For each={crewShown().shown}>
                  {(agent) => (
                    <A class="pph-av" href={`/${company().issuePrefix}/agents/${agent.key}`} title={agent.title}>
                      <AgentAvatar
                        agent={agentFor(agent.agentId) ?? { id: agent.agentId, name: agent.name }}
                        size={40}
                        pose={POSE[agent.state]}
                        ring={false}
                        label={agent.label}
                      />
                      <Show when={agent.bar}>{(bar) => <span class="pph-av-state" aria-hidden="true" style={{ background: bar() }} />}</Show>
                    </A>
                  )}
                </For>
                <Show when={crewShown().more > 0}>
                  <A class="pph-av pph-av-more" href={props.base} aria-label={`${crewShown().more} more agents, on the project overview`}>
                    +{crewShown().more}
                  </A>
                </Show>
              </div>
            </Show>
          </div>
        </Show>
      </Show>

      {props.plugins}

      <div class="pph-views">
        <nav class="tabs" aria-label="Project views">
          <A class="tab" href={props.base} end>
            Overview
          </A>
          <A class="tab" href={`${props.base}/issues`}>
            List
          </A>
          <A class="tab" href={`${props.base}/docs`}>
            Docs
          </A>
        </nav>
      </div>
    </header>
  );
}

/** The project's description (M12), folded to three lines with a way to read the rest. */
function Description(props: { text: string }) {
  const [open, setOpen] = createSignal(false);
  const [folds, setFolds] = createSignal(false);
  let body: HTMLParagraphElement | undefined;
  // Whether it runs past three lines, measured when it changes and when the card resizes.
  createEffect(
    on(
      () => props.text,
      () => {
        if (!body) return;
        const measure = () => !open() && setFolds(body!.scrollHeight > body!.clientHeight + 1);
        measure();
        if (typeof ResizeObserver === "undefined") return;
        const observer = new ResizeObserver(measure);
        observer.observe(body);
        onCleanup(() => observer.disconnect());
      },
    ),
  );
  return (
    <div class="pph-desc">
      <p ref={body} id="pph-desc" class="pph-desc-text" classList={{ "pph-desc-text--open": open() }}>
        {props.text}
      </p>
      <Show when={folds() || open()}>
        <button type="button" class="pph-desc-more" aria-expanded={open()} aria-controls="pph-desc" onClick={() => setOpen(!open())}>
          {open() ? "Show less" : "Show more"}
        </button>
      </Show>
    </div>
  );
}

/** More project actions: star, workload, plugin tabs and settings (on desktop). */
function MoreMenu(props: { project: Project; base: string; pluginTabs: readonly { label: string; href: string }[] }) {
  const navigate = useNavigate();
  const stars = useProjectStars();
  const starred = () => stars.starred(props.project.id);
  return (
    <Menu>
      <Menu.Trigger class="pph-ib" aria-label="More project actions">
        <Ellipsis size={18} aria-hidden="true" />
      </Menu.Trigger>
      <Menu.Content label="Project actions" width={260}>
        <Show when={!props.project.archivedAt}>
          <Menu.Item
            icon={<Star size={15} fill={starred() ? "currentColor" : "none"} />}
            description="Keeps it in your nav's Starred group"
            onSelect={() => stars.toggle(props.project)}
          >
            {starred() ? "Unstar project" : "Star project"}
          </Menu.Item>
        </Show>
        <Menu.Item icon={<Gauge size={15} />} onSelect={() => navigate(`${props.base}/workload`)}>
          Agent workload
        </Menu.Item>
        <Show when={props.pluginTabs.length > 0}>
          <Menu.Group label="From plugins">
            <For each={props.pluginTabs}>{(tab) => <Menu.Item onSelect={() => navigate(tab.href)}>{tab.label}</Menu.Item>}</For>
          </Menu.Group>
        </Show>
        <Menu.Separator />
        <Menu.Item icon={<Settings2 size={15} />} hint="On desktop" onSelect={() => navigate(`${props.base}/settings`)}>
          Project settings
        </Menu.Item>
      </Menu.Content>
    </Menu>
  );
}
