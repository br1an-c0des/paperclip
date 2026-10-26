import { useNavigate } from "@solidjs/router";
import { createQuery, keepPreviousData } from "@tanstack/solid-query";
import { Search } from "lucide-solid";
import { createEffect, createMemo, createSignal, For, on, onCleanup, Show } from "solid-js";
import { activeAgents } from "@/api/agents";
import { issuePath, issuesApi } from "@/api/issues";
import { openProjects } from "@/api/projects";
import { queryKeys } from "@/api/queryKeys";
import { useCommands } from "@/lib/commands";
import { useCompany } from "@/lib/company";
import { useAgentsQuery, useProjectsQuery } from "@/lib/company-data";
import { theme, toggleTheme } from "@/lib/theme";
import { Dialog } from "@/ui/Dialog";
import { STATUS_META } from "@/ui/status-meta";
import { filterPalette, type PaletteGroup } from "./palette";
import "./CommandPalette.css";

/*
 * The command palette (Cmd/Ctrl+K, or the nav's search button), after
 * ui/src/components/CommandPalette.tsx: actions, pages, projects, agents, and a task search as you
 * type. Arrow keys move, Enter runs, Escape closes. The input is a combobox that owns the listbox
 * through `aria-activedescendant`, so focus stays in the field.
 *
 * There's no board for it yet ("Design still coming"); it uses the dialog and menu styles.
 */

const SEARCH_DEBOUNCE_MS = 200;
const TASK_LIMIT = 8;

export function CommandPalette() {
  const commands = useCommands();
  const company = useCompany();
  const navigate = useNavigate();
  const projects = useProjectsQuery();
  const agents = useAgentsQuery();
  const [query, setQuery] = createSignal("");
  const [searchTerm, setSearchTerm] = createSignal("");
  const [active, setActive] = createSignal(0);

  createEffect(
    on(query, (value) => {
      const timer = window.setTimeout(() => setSearchTerm(value.trim()), SEARCH_DEBOUNCE_MS);
      onCleanup(() => window.clearTimeout(timer));
    }),
  );
  // Each opening starts fresh.
  createEffect(
    on(commands.paletteOpen, (open) => {
      if (!open) return;
      setQuery("");
      setSearchTerm("");
      setActive(0);
    }),
  );

  const tasks = createQuery(() => ({
    queryKey: queryKeys.issues.search(company().id, searchTerm(), TASK_LIMIT),
    queryFn: ({ signal }) => issuesApi.search(company().id, { q: searchTerm(), limit: TASK_LIMIT }, signal),
    enabled: commands.paletteOpen() && searchTerm().length > 0,
    placeholderData: keepPreviousData,
  }));

  const base = () => `/${company().issuePrefix}`;
  const close = () => commands.setPaletteOpen(false);
  const go = (path: string) => () => {
    close();
    navigate(path);
  };

  const groups = createMemo<PaletteGroup[]>(() => [
    {
      title: "Actions",
      commands: [
        { id: "new-task", label: "New task", hint: "C", keywords: "create add issue", run: () => commands.openNewTask() },
        {
          id: "theme",
          label: theme() === "dark" ? "Use light theme" : "Use dark theme",
          keywords: "appearance mode",
          run: () => {
            toggleTheme();
            close();
          },
        },
        {
          id: "shortcuts",
          label: "Keyboard shortcuts",
          hint: "?",
          keywords: "keys help cheatsheet",
          run: () => {
            close();
            commands.setShortcutsOpen(true);
          },
        },
      ],
    },
    {
      title: "Pages",
      commands: [
        { id: "dashboard", label: "Org dashboard", hint: "G D", keywords: "home company", run: go(`${base()}/dashboard`) },
        { id: "inbox", label: "Inbox", hint: "G I", keywords: "requests approvals questions", run: go(`${base()}/inbox`) },
        { id: "issues", label: "All tasks", keywords: "issues list", run: go(`${base()}/issues`) },
        { id: "settings", label: "Settings", keywords: "company organization", run: go(`${base()}/company/settings`) },
        { id: "companies", label: "All companies", keywords: "switch organization", run: go("/companies") },
      ],
    },
    {
      title: "Projects",
      idleLimit: 4,
      commands: openProjects(projects.data).map((project) => ({
        id: `project:${project.id}`,
        label: project.name,
        keywords: project.urlKey,
        run: go(`${base()}/projects/${project.urlKey}`),
      })),
    },
    {
      title: "Agents",
      idleLimit: 4,
      commands: activeAgents(agents.data).map((agent) => ({
        id: `agent:${agent.id}`,
        label: agent.name,
        keywords: `${agent.title ?? ""} ${agent.role}`,
        hint: agent.title ?? undefined,
        run: go(`${base()}/agents/${agent.urlKey}`),
      })),
    },
  ]);

  const taskGroup = createMemo<PaletteGroup | null>(() => {
    if (!query().trim() || !tasks.data?.length) return null;
    // The server already matched these, so they skip the local filter.
    return {
      title: "Tasks",
      commands: tasks.data.map((issue) => ({
        id: `task:${issue.id}`,
        label: issue.title,
        hint: [issue.identifier, STATUS_META[issue.status].label].filter(Boolean).join(" · "),
        run: go(issuePath(company().issuePrefix, issue)),
      })),
    };
  });

  const visible = createMemo(() => {
    const filtered = filterPalette(groups(), query());
    const found = taskGroup();
    return found ? [...filtered, found] : filtered;
  });
  const flat = createMemo(() => visible().flatMap((group) => group.commands));

  createEffect(on(flat, (list) => setActive((index) => Math.min(index, Math.max(0, list.length - 1)))));
  createEffect(on(query, () => setActive(0), { defer: true }));

  const optionId = (id: string) => `palette-${id.replace(/[^a-z0-9_-]/gi, "-")}`;
  const activeId = () => {
    const command = flat()[active()];
    return command ? optionId(command.id) : undefined;
  };

  let list: HTMLDivElement | undefined;
  createEffect(() => {
    const id = activeId();
    if (id) list?.querySelector(`#${id}`)?.scrollIntoView({ block: "nearest" });
  });

  const onKeyDown = (event: KeyboardEvent) => {
    const count = flat().length;
    if (event.key === "ArrowDown" || event.key === "ArrowUp") {
      event.preventDefault();
      if (count === 0) return;
      const step = event.key === "ArrowDown" ? 1 : -1;
      setActive((index) => (index + step + count) % count);
    } else if (event.key === "Enter" && !event.isComposing) {
      event.preventDefault();
      flat()[active()]?.run();
    }
  };

  const searching = () => tasks.isFetching && searchTerm().length > 0;

  return (
    <Dialog open={commands.paletteOpen()} onOpenChange={commands.setPaletteOpen} title="Search and commands" titleHidden hideClose width={640}>
      <div class="palette">
        <div class="palette-field">
          <Search size={16} aria-hidden="true" />
          <input
            class="palette-input"
            type="text"
            role="combobox"
            aria-expanded="true"
            aria-controls="palette-list"
            aria-activedescendant={activeId()}
            aria-autocomplete="list"
            aria-label="Search tasks, projects, agents and commands"
            placeholder="Search tasks, projects, agents and commands"
            autocomplete="off"
            spellcheck={false}
            value={query()}
            onInput={(event) => setQuery(event.currentTarget.value)}
            onKeyDown={onKeyDown}
          />
          <Show when={searching()}>
            <span class="palette-status" aria-live="polite">
              Searching…
            </span>
          </Show>
        </div>
        <div ref={list} id="palette-list" class="palette-list" role="listbox" aria-label="Results">
          <For
            each={visible()}
            fallback={
              <p class="palette-empty">
                {searching() ? "Searching tasks…" : `Nothing matches “${query().trim()}”.`}
              </p>
            }
          >
            {(group) => (
              <div role="group" aria-labelledby={`palette-group-${group.title}`}>
                <div id={`palette-group-${group.title}`} class="mh">
                  {group.title}
                </div>
                <For each={group.commands}>
                  {(command) => {
                    const selected = () => flat()[active()]?.id === command.id;
                    return (
                      <div
                        id={optionId(command.id)}
                        class="mi palette-option"
                        role="option"
                        aria-selected={selected()}
                        data-highlighted={selected() ? "" : undefined}
                        onPointerMove={() => setActive(flat().findIndex((entry) => entry.id === command.id))}
                        onClick={() => command.run()}
                      >
                        <span class="mi-text">
                          <span class="mi-label">{command.label}</span>
                        </span>
                        <Show when={command.hint}>
                          <small class="mi-hint">{command.hint}</small>
                        </Show>
                      </div>
                    );
                  }}
                </For>
              </div>
            )}
          </For>
        </div>
        <footer class="palette-foot" aria-hidden="true">
          <span>
            <kbd>↑</kbd>
            <kbd>↓</kbd> move
          </span>
          <span>
            <kbd>Enter</kbd> open
          </span>
          <span>
            <kbd>Esc</kbd> close
          </span>
        </footer>
      </div>
    </Dialog>
  );
}
