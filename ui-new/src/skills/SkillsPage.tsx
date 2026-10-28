import { A, Navigate, useParams } from "@solidjs/router";
import { createMemo, Match, Show, Switch } from "solid-js";
import { isCompact } from "@/layout/breakpoints";
import { useCompany } from "@/lib/company";
import { OrgHeader } from "@/org/OrgHeader";
import { skillsView, type SkillsView } from "./skills-model";
import { SkillLibrary } from "./SkillLibrary";
import { SkillSources } from "./SkillSources";
import { NewSkill, SkillStudio, StudioHome } from "./SkillStudio";
import "@/activity/Activity.css";
import "./Skills.css";

/*
 * `/:prefix/skills/*`, the organization's Skills tab (Tier 2, the old UI's skills pages):
 *
 * - Library (`/skills`, `/skills/:skillId`): the company's skills, where each comes from, which
 *   agents use it and its versions; the core Paperclip skills are marked for lead agents.
 * - Sources (`/skills/sources`, `/:sourceId`): the repositories the library imports from.
 * - Studio (`/skills/studio`, `/new`, `/:skillId`): skills written here, their files and versions.
 *
 * The old `/skills/:skillId/studio` address opens the Studio. Turning a skill on for an agent is the
 * agent page's Skills section.
 */

export function SkillsPage() {
  const params = useParams<{ rest?: string }>();
  const company = useCompany();
  const base = () => `/${company().issuePrefix}/skills`;
  const view = createMemo(() => skillsView(params.rest ?? ""));
  const section = () => view().section;
  const pick = <S extends SkillsView["section"]>(name: S) => {
    const current = view();
    return current.section === name ? (current as Extract<SkillsView, { section: S }>) : null;
  };
  const library = createMemo(() => pick("library"));
  const sources = createMemo(() => pick("sources"));
  const studio = createMemo(() => pick("studio"));
  const redirect = createMemo(() => pick("redirect"));

  return (
    <Show when={!redirect()} fallback={<Navigate href={`${base()}/${redirect()!.to}`} />}>
      <div class="org-page act-page">
        <Show when={!isCompact()} fallback={<h1 class="org-phone-title disp">Skills</h1>}>
          <OrgHeader />
        </Show>
        <nav class="act-subnav" aria-label="Skills">
          <A href={base()} activeClass="" inactiveClass="" classList={{ active: section() === "library" }} aria-current={section() === "library" ? "page" : undefined}>
            Library
          </A>
          <A href={`${base()}/sources`} activeClass="" inactiveClass="" classList={{ active: section() === "sources" }} aria-current={section() === "sources" ? "page" : undefined}>
            Sources
          </A>
          <A href={`${base()}/studio`} activeClass="" inactiveClass="" classList={{ active: section() === "studio" }} aria-current={section() === "studio" ? "page" : undefined}>
            Studio
          </A>
        </nav>
        <Switch>
          <Match when={library()}>{(current) => <SkillLibrary skillId={current().skillId} />}</Match>
          <Match when={sources()}>{(current) => <SkillSources sourceId={current().sourceId} />}</Match>
          <Match when={studio()?.creating}>
            <NewSkill />
          </Match>
          <Match when={studio()?.skillId} keyed>
            {(skillId) => <SkillStudio skillId={skillId} />}
          </Match>
          <Match when={studio()}>
            <StudioHome />
          </Match>
        </Switch>
      </div>
    </Show>
  );
}
