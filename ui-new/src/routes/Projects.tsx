import type { Project } from "@paperclipai/shared";
import { A } from "@solidjs/router";
import { Plus } from "lucide-solid";
import { createMemo, createSignal, For, Show } from "solid-js";
import { useCommands } from "@/lib/commands";
import { useCompany } from "@/lib/company";
import { useProjectsQuery } from "@/lib/company-data";
import { ProjectStarButton, useProjectStars } from "@/layout/nav-prefs";
import { InitialsDisc } from "@/ui/Avatar";
import { Button } from "@/ui/Button";
import { HeaderNumber, PageHeader } from "@/ui/PageHeader";
import { Segmented } from "@/ui/Segmented";
import { Capsule } from "@/ui/Status";
import { PROJECT_STATUS } from "./Project";
import "./Projects.css";

/*
 * `/:prefix/projects`, every project in the company (the old Projects page's address): open ones,
 * starred first, or the archived ones, which open to their settings to restore. No board draws a
 * project list; the nav lists open projects too, and each row here is a nav-style row in a card.
 */

type View = "open" | "archived";

const VIEWS = [
  { value: "open", label: "Open" },
  { value: "archived", label: "Archived" },
] as const;

export function ProjectsPage() {
  const company = useCompany();
  const commands = useCommands();
  const projects = useProjectsQuery();
  const stars = useProjectStars();
  const [view, setView] = createSignal<View>("open");
  const open = createMemo(() => (projects.data ?? []).filter((project) => !project.archivedAt));
  const archived = createMemo(() => (projects.data ?? []).filter((project) => project.archivedAt));
  const shown = createMemo(() => {
    const list = view() === "open" ? open() : archived();
    return [...list].sort(
      (a, b) => Number(stars.starred(b.id)) - Number(stars.starred(a.id)) || a.name.localeCompare(b.name, undefined, { sensitivity: "base" }),
    );
  });
  const href = (project: Project) => `/${company().issuePrefix}/projects/${project.urlKey}${project.archivedAt ? "/settings/archive" : ""}`;
  return (
    <>
      <PageHeader
        crumbs={<span>{company().name}</span>}
        title="Projects"
        numbers={
          <Show when={projects.data}>
            <HeaderNumber value={open().length} label="open" />
            <Show when={archived().length > 0}>
              <span class="muted">{archived().length} archived</span>
            </Show>
          </Show>
        }
        actions={
          <Button size="compact" icon={<Plus size={14} aria-hidden="true" />} onClick={() => commands.openNewProject()}>
            New project
          </Button>
        }
      />
      <section class="card projects-list">
        <div class="projects-list-head">
          <Segmented label="Show" options={VIEWS} value={view()} onChange={setView} />
        </div>
        <Show
          when={shown().length > 0}
          fallback={<p class="muted projects-empty">{projects.isPending ? "Loading projects…" : view() === "open" ? "No projects yet." : "No archived projects."}</p>}
        >
          <ul>
            <For each={shown()}>
              {(project) => {
                const status = () => PROJECT_STATUS[project.status] ?? PROJECT_STATUS.backlog;
                return (
                  <li class="projects-row">
                    <A class="projects-link" href={href(project)}>
                      <InitialsDisc name={project.name.slice(0, 1)} seed={project.id} size={28} />
                      <span class="projects-name">{project.name}</span>
                      <span class="projects-status">
                        <Capsule gradient={status().gradient} size="tiny" />
                        {status().label}
                      </span>
                      <Show when={project.taskCount !== undefined}>
                        <span class="muted projects-count">{project.taskCount} {project.taskCount === 1 ? "task" : "tasks"}</span>
                      </Show>
                    </A>
                    <Show when={!project.archivedAt}>
                      <ProjectStarButton project={project} />
                    </Show>
                  </li>
                );
              }}
            </For>
          </ul>
        </Show>
      </section>
    </>
  );
}
