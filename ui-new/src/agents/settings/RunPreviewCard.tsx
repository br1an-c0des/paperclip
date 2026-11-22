import type { AgentDetail } from "@paperclipai/shared";
import { createQuery, keepPreviousData } from "@tanstack/solid-query";
import { TriangleAlert } from "lucide-solid";
import { createEffect, createMemo, createSignal, createUniqueId, For, on, Show } from "solid-js";
import { agentsApi } from "@/api/agents";
import { queryKeys } from "@/api/queryKeys";
import { useCompany } from "@/lib/company";
import { useProjectsQuery } from "@/lib/company-data";
import { AccessRow, AutoMemoryRow, GitHubRow, ManifestList, ManifestRow, McpServersRow, MonoValue, OverriddenRow, SkillsRow } from "@/runs/ManifestRows";
import { InfoHeading } from "@/ui/Field";
import { failure } from "../shared";
import {
  blockerLines,
  checkoutValue,
  chosenProject,
  claudeMdValue,
  credentialValue,
  engineValue,
  instructionsValue,
  previewManifest,
  projectChoices,
  readStoredProject,
  repoSkillsValue,
  SESSION_TEXT,
  storeProject,
  taskWorktreeValue,
  unsupportedText,
  type PreviewValue,
} from "./run-preview-model";
import "./RunPreviewCard.css";

/*
 * "What runs get" (step 4b part 2, fork/step-4b-parts-2-3.md): what the agent's next sealed run
 * would get, before any run, from `GET /agents/:id/run-preview?projectId=`. The rows are the run
 * modal's "What this run got" (runs/ManifestRows.tsx), plus the engine and the project's
 * repository; the session row says what happens instead, since that depends on the task.
 *
 * "For tasks in" picks the project whose CLAUDE.md and repo skills switches and checkout the
 * preview follows, remembered per agent on this device. The read sits under the agent's query
 * key, so saving the agent's settings (refreshAgent) refetches it; picking a project fetches that
 * project's.
 */

export function RunPreviewCard(props: { agent: AgentDetail; dirty?: boolean }) {
  const company = useCompany();
  const projects = useProjectsQuery();
  const choices = createMemo(() => (projects.data ? projectChoices(projects.data) : undefined));
  const [stored, setStored] = createSignal(readStoredProject(props.agent.id));
  createEffect(on(() => props.agent.id, (id) => setStored(readStoredProject(id)), { defer: true }));
  const projectId = createMemo(() => chosenProject(stored(), choices()));
  const choose = (id: string) => {
    const next = id || null;
    storeProject(props.agent.id, next);
    setStored(next);
  };

  const preview = createQuery(() => ({
    queryKey: queryKeys.agents.part(props.agent.id, "run-preview", projectId() ?? "__none__"),
    queryFn: ({ signal }) => agentsApi.runPreview(props.agent.id, projectId(), company().id, signal),
    // Switching projects keeps the last rows on screen (dimmed) until the new ones arrive.
    placeholderData: keepPreviousData,
    retry: false,
  }));
  const manifest = createMemo(() => previewManifest(preview.data));
  const supported = () => preview.data?.supported === true;
  const project = () => (preview.data?.supported ? preview.data.project : null);
  const blockers = createMemo(() => (preview.data?.supported ? blockerLines(preview.data.blockers) : []));
  const selectId = createUniqueId();

  return (
    <section class="card settings-card rp" aria-labelledby={`${selectId}-title`}>
      <header class="chead rp-head">
        <InfoHeading
          level={3}
          class="disp"
          id={`${selectId}-title`}
          info="What a sealed Claude run of this agent gets from Paperclip, worked out from its saved settings the way a launch does, without starting anything. Each run's own list is in its Input tab."
        >
          What runs get
        </InfoHeading>
        <Show when={preview.data?.supported !== false}>
          <label class="rp-for" for={selectId}>
            <span>For tasks in</span>
            <select id={selectId} class="input rp-select" value={projectId() ?? ""} onChange={(event) => choose(event.currentTarget.value)}>
              <option value="" selected={!projectId()}>
                No project
              </option>
              <For each={choices() ?? []}>
                {(choice) => (
                  <option value={choice.id} selected={choice.id === projectId()}>
                    {choice.name}
                  </option>
                )}
              </For>
              {/* The remembered project, while the list loads. */}
              <Show when={!choices() && projectId()}>
                {(id) => (
                  <option value={id()} selected>
                    …
                  </option>
                )}
              </Show>
            </select>
          </label>
        </Show>
      </header>

      <Show when={blockers().length > 0}>
        <div class="rp-blockers" role="alert">
          <TriangleAlert size={16} aria-hidden="true" />
          <div>
            <b>A run would be refused before it starts</b>
            <For each={blockers()}>{(line) => <span>{line}</span>}</For>
          </div>
        </div>
      </Show>

      <Show when={props.dirty && supported()}>
        <p class="ps-list-note rp-note">These are the saved settings. Save to see your changes here.</p>
      </Show>

      <Show when={preview.isError && !preview.data}>
        <p class="ps-list-note" role="alert">
          Couldn't load what runs get. {failure(preview.error, "")}
        </p>
      </Show>
      <Show when={preview.isPending}>
        <p class="ps-list-note" role="status">
          Loading…
        </p>
      </Show>
      <Show when={preview.data && !preview.data.supported ? preview.data : null}>
        {(unsupported) => <p class="ps-list-note">{unsupportedText(unsupported().reason)}</p>}
      </Show>

      <Show when={manifest()}>
        {(got) => (
          <div class="rp-body" classList={{ "rp-body--stale": preview.isPlaceholderData }} aria-busy={preview.isFetching}>
            <ManifestList>
              <ManifestRow label="Engine" info="The CLI engine runs claude --print with only Paperclip's settings, read from this agent's own Claude config folder.">
                <Value value={engineValue(got())} />
              </ManifestRow>
              <ManifestRow label="Credential">{credentialValue(got().credential)}</ManifestRow>
              <SkillsRow manifest={got()} total />
              <McpServersRow servers={got().mcpServers} />
              <AccessRow access={got().access} />
              <GitHubRow github={got().github} />
              <Show when={project()}>
                {(chosen) => (
                  <ManifestRow label="Repository" info="Where a run on this project's tasks finds the repository's CLAUDE.md and skills: the project's primary workspace.">
                    <Value value={checkoutValue(chosen().checkout)} />
                  </ManifestRow>
                )}
              </Show>
              <Show when={taskWorktreeValue(project()?.checkout)}>
                {(worktree) => (
                  <ManifestRow
                    label="Task worktrees"
                    info="Each task gets its own git worktree of the repository, made on its first run. It holds only committed files, so CLAUDE.md and the repo skills are read from that commit. Their paths say <task branch>, the folder named after the task."
                  >
                    <Value value={worktree()} />
                  </ManifestRow>
                )}
              </Show>
              <ManifestRow label="CLAUDE.md">
                <Value value={claudeMdValue(got().claudeMd, project())} />
              </ManifestRow>
              <ManifestRow label="Repo skills">
                <Value value={repoSkillsValue(got().repoSkills, project())} />
              </ManifestRow>
              <ManifestRow label="Instructions" info="Sent at the start of each new session.">
                <Value value={instructionsValue(got().instructions)} />
              </ManifestRow>
              <ManifestRow label="Session">{SESSION_TEXT}</ManifestRow>
              <AutoMemoryRow />
              <OverriddenRow names={got().overriddenEnv} />
            </ManifestList>
          </div>
        )}
      </Show>
    </section>
  );
}

/** Words, a path in Fragment Mono, or words then a path. */
function Value(props: { value: PreviewValue }) {
  return (
    <>
      {props.value.text}
      <Show when={props.value.path}>
        {(path) => (
          <>
            {props.value.text ? " " : ""}
            <MonoValue>{path()}</MonoValue>
          </>
        )}
      </Show>
    </>
  );
}
