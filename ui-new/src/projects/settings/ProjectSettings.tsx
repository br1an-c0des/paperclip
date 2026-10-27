import type { Project } from "@paperclipai/shared";
import { Navigate } from "@solidjs/router";
import { Archive } from "lucide-solid";
import { Match, Show, Switch } from "solid-js";
import { RailLayout, SectionRail } from "@/ui/PageHeader";
import { AccessSection } from "./AccessSection";
import { ArchiveSection } from "./ArchiveSection";
import { BudgetSection } from "./BudgetSection";
import { CodeSection } from "./CodeSection";
import { DetailsSection } from "./DetailsSection";
import { EnvironmentSection } from "./EnvironmentSection";
import { GitAuthorizationSection } from "./GitAuthorizationSection";
import { GoalsSection } from "./GoalsSection";
import { SETTINGS_SECTIONS, settingsSection } from "./settings-model";
import "./ProjectSettings.css";

/*
 * The project's Settings tab (boards 10 and 11): a section rail with a URL per section under
 * `/projects/:key/settings`, and the section's cards beside it. Details, members and goals save as
 * you make each change; the code, environment and budget forms have a Save button, since they're
 * edited as a set. An archived project opens here too, so it can be restored.
 */

export function ProjectSettings(props: { project: Project; base: string; rest: string }) {
  const settingsBase = () => `${props.base}/settings`;
  const section = () => settingsSection(props.rest);
  return (
    <Show when={section()} fallback={<Navigate href={settingsBase()} />}>
      <RailLayout
        rail={
          <SectionRail
            label="Project settings"
            entries={SETTINGS_SECTIONS.map((entry) => ({
              label: entry.key === "archive" ? <span class="ps-rail-danger">{entry.label}</span> : entry.label,
              href: `${settingsBase()}${entry.path}`,
              end: entry.path === "",
            }))}
          />
        }
      >
        <Show when={props.project.archivedAt && section() !== "archive"}>
          <div class="ps-banner" role="status">
            <Archive size={16} aria-hidden="true" />
            This project is archived. Restore it under Archive to bring it back to the sidebar.
          </div>
        </Show>
        <Switch>
          <Match when={section() === "details"}>
            <DetailsSection project={props.project} base={settingsBase()} />
          </Match>
          <Match when={section() === "access"}>
            <AccessSection project={props.project} />
          </Match>
          <Match when={section() === "goals"}>
            <GoalsSection project={props.project} />
          </Match>
          <Match when={section() === "code"}>
            <CodeSection project={props.project} />
          </Match>
          <Match when={section() === "git"}>
            <GitAuthorizationSection project={props.project} />
          </Match>
          <Match when={section() === "environment"}>
            <EnvironmentSection project={props.project} base={settingsBase()} />
          </Match>
          <Match when={section() === "budget"}>
            <BudgetSection project={props.project} />
          </Match>
          <Match when={section() === "archive"}>
            <div class="ps-archive-card">
              <ArchiveSection project={props.project} />
            </div>
          </Match>
        </Switch>
      </RailLayout>
    </Show>
  );
}
