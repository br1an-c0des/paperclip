import type { Project } from "@paperclipai/shared";
import { createSignal } from "solid-js";
import { SettingsCard, SettingsRow } from "@/ui/Field";
import { Switch as Toggle } from "@/ui/Switch";
import { saveNote, useProjectSaver } from "./shared";

/*
 * Repository instructions (step 4b, fork/step-4b-sealed-runs.md section 5): two project switches for
 * sealed claude_local runs, `agentsReadClaudeMd` and `agentsUseRepoSkills` on `PATCH /projects/:id`.
 * Both default on; a project from an older server without them reads as on. Each switch saves on its
 * own as soon as it's flipped, showing its new position while the save runs and its saved one after.
 */

type SwitchKey = "agentsReadClaudeMd" | "agentsUseRepoSkills";

function RepoSwitchRow(props: { project: Project; field: SwitchKey; label: string; info: string }) {
  const saver = useProjectSaver(() => props.project);
  const [pending, setPending] = createSignal<boolean | null>(null);
  const saved = () => props.project[props.field] !== false;
  const change = async (value: boolean) => {
    setPending(value);
    await saver.save({ [props.field]: value });
    setPending(null);
  };
  return (
    <SettingsRow label={props.label} info={props.info} help={saveNote(saver.state(), saver.error())}>
      <Toggle checked={pending() ?? saved()} disabled={saver.state() === "saving"} onChange={(value) => void change(value)} label={props.label} labelHidden />
    </SettingsRow>
  );
}

export function RepoInstructionsCard(props: { project: Project }) {
  return (
    <SettingsCard
      title="Repository instructions"
      info="What Claude agent runs in this project's repository take from the repository itself. Anything else they get comes from Paperclip: the agent's own instructions and skills."
    >
      <RepoSwitchRow
        project={props.project}
        field="agentsReadClaudeMd"
        label="Agents read the repo's CLAUDE.md"
        info="When on, agent runs in this project's repository load the CLAUDE.md at the repository's root. Subfolder CLAUDE.md files don't load."
      />
      <RepoSwitchRow
        project={props.project}
        field="agentsUseRepoSkills"
        label="Agents use the repo's skills"
        info="When on, agent runs in this project's repository also get the skills in its .claude/skills folder, from the branch the run works on, alongside the agent's own. Nothing else in the repository's .claude folder loads: settings, hooks, agents and commands stay out."
      />
    </SettingsCard>
  );
}
