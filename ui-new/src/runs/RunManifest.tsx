import type { ClaudeRunManifest } from "@paperclipai/shared";
import { Show } from "solid-js";
import { InfoTip } from "@/ui/InfoTip";
import { AccessRow, AutoMemoryRow, CredentialRow, GitHubRow, ManifestList, ManifestRow, McpServersRow, MonoValue, OverriddenRow, SkillsRow } from "./ManifestRows";
import { shortId } from "./run-model";
import { claudeMdText, instructionsText, repoSkillsSkipped, sessionText } from "./run-manifest";

/*
 * "What this run got" (step 4b, design section 8): a sealed claude_local CLI run's manifest, one line
 * per part, above the raw command in the Input tab. Set-aside files and overridden variables show
 * only when there are any. Older runs, and runs on other engines, record no manifest and show
 * nothing here. The rows are shared with the agent's "What runs get" card (ManifestRows.tsx).
 */

export function RunManifest(props: { manifest: ClaudeRunManifest }) {
  const claudeMd = () => claudeMdText(props.manifest);
  const repoSkipped = () => repoSkillsSkipped(props.manifest);
  const setAside = () => (props.manifest.setAside && props.manifest.setAside.entries?.length ? props.manifest.setAside : null);
  return (
    <section class="ri-sec" aria-labelledby="ri-got">
      <div class="ri-sech">
        <h3 class="disp" id="ri-got">
          What this run got
        </h3>
        <InfoTip label="About What this run got">
          A sealed Claude run gets only what Paperclip gives it: this credential, these skills and MCP servers, and the repository's CLAUDE.md and skills when the project allows them.
          Nothing else from the machine's or the repository's Claude settings loads.
        </InfoTip>
      </div>
      <ManifestList>
        <CredentialRow credential={props.manifest.credential} />
        <SkillsRow manifest={props.manifest} />
        <Show when={repoSkipped()}>{(reason) => <ManifestRow label="Repo skills">Not loaded: {reason().replace(/^./, (c) => c.toLowerCase())}</ManifestRow>}</Show>
        <McpServersRow servers={props.manifest.mcpServers} />
        <GitHubRow github={props.manifest.github} />
        <AccessRow access={props.manifest.access} />
        <ManifestRow label="CLAUDE.md">
          <Show when={claudeMd().loaded} fallback={claudeMd().text}>
            <MonoValue>{claudeMd().text}</MonoValue>
          </Show>
        </ManifestRow>
        <ManifestRow label="Instructions">{instructionsText(props.manifest.instructions)}</ManifestRow>
        <ManifestRow label="Session">{sessionText(props.manifest.session, shortId)}</ManifestRow>
        <AutoMemoryRow />
        <Show when={setAside()}>
          {(aside) => (
            <ManifestRow
              label="Set aside"
              info={
                <>
                  Files Paperclip moved out of the agent's Claude config folder before the run, into <span class="mono">{aside().dir}</span>. Nothing was deleted.
                </>
              }
            >
              <MonoValue>{aside().entries.join(", ")}</MonoValue>
            </ManifestRow>
          )}
        </Show>
        <OverriddenRow names={props.manifest.overriddenEnv} />
      </ManifestList>
    </section>
  );
}
