import type { ClaudeRunManifest } from "@paperclipai/shared";
import { For, Show } from "solid-js";
import { InfoTip } from "@/ui/InfoTip";
import { shortId } from "./run-model";
import { accessText, claudeMdText, credentialText, instructionsText, repoSkillsSkipped, sessionText, skillGroups } from "./run-manifest";

/*
 * "What this run got" (step 4b, design section 8): a sealed claude_local CLI run's manifest, one line
 * per part, above the raw command in the Input tab. Set-aside files and overridden variables show
 * only when there are any. Older runs, and runs on other engines, record no manifest and show
 * nothing here.
 */

export function RunManifest(props: { manifest: ClaudeRunManifest }) {
  const groups = () => skillGroups(props.manifest);
  const claudeMd = () => claudeMdText(props.manifest);
  const repoSkipped = () => repoSkillsSkipped(props.manifest);
  const mcpNames = () => (Array.isArray(props.manifest.mcpServers) ? props.manifest.mcpServers.map((server) => server.name) : []);
  const setAside = () => (props.manifest.setAside && props.manifest.setAside.entries?.length ? props.manifest.setAside : null);
  const overridden = () => (Array.isArray(props.manifest.overriddenEnv) ? props.manifest.overriddenEnv : []);
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
      <ul class="ri-kvl">
        <li>
          <span class="ri-k">Credential</span>
          <span>{credentialText(props.manifest.credential)}</span>
        </li>
        <li>
          <span class="ri-k info-line">
            Skills
            <InfoTip label="About Skills">
              Names as on the Skills page. Claude sees each one under its group's prefix, such as paperclip:paperclip, company:&lt;name&gt; or project:&lt;name&gt;. A name
              marked "loaded twice" came from more than one group. Claude Code's built-in skills load too.
            </InfoTip>
          </span>
          <Show when={groups().length > 0} fallback={<span>None</span>}>
            <ul class="ri-groups">
              <For each={groups()}>
                {(group) => (
                  <li>
                    <span class="ri-gk">{group.label}</span>
                    <span class="ri-gv">
                      <For each={group.skills}>
                        {(skill, index) => (
                          <>
                            <span class="mono">{skill.name}</span>
                            <Show when={skill.clash}>
                              <span class="ri-clash"> (loaded twice)</span>
                            </Show>
                            {index() < group.skills.length - 1 ? ", " : ""}
                          </>
                        )}
                      </For>
                    </span>
                  </li>
                )}
              </For>
            </ul>
          </Show>
        </li>
        <Show when={repoSkipped()}>
          {(reason) => (
            <li>
              <span class="ri-k">Repo skills</span>
              <span>Not loaded: {reason().replace(/^./, (c) => c.toLowerCase())}</span>
            </li>
          )}
        </Show>
        <li>
          <span class="ri-k info-line">
            MCP servers
            <InfoTip label="About MCP servers">Only these servers load: the run ignores any other MCP configuration.</InfoTip>
          </span>
          <span>{mcpNames().length > 0 ? <span class="mono ri-wrap">{mcpNames().join(", ")}</span> : "None"}</span>
        </li>
        <li>
          <span class="ri-k">Access</span>
          <span>{accessText(props.manifest.access)}</span>
        </li>
        <li>
          <span class="ri-k">CLAUDE.md</span>
          <span class={claudeMd().loaded ? "mono ri-wrap" : undefined}>{claudeMd().text}</span>
        </li>
        <li>
          <span class="ri-k">Instructions</span>
          <span>{instructionsText(props.manifest.instructions)}</span>
        </li>
        <li>
          <span class="ri-k">Session</span>
          <span>{sessionText(props.manifest.session, shortId)}</span>
        </li>
        <li>
          <span class="ri-k">Auto memory</span>
          <span>Off</span>
        </li>
        <Show when={setAside()}>
          {(aside) => (
            <li>
              <span class="ri-k info-line">
                Set aside
                <InfoTip label="About Set aside">
                  Files Paperclip moved out of the agent's Claude config folder before the run, into <span class="mono">{aside().dir}</span>. Nothing was deleted.
                </InfoTip>
              </span>
              <span class="mono ri-wrap">{aside().entries.join(", ")}</span>
            </li>
          )}
        </Show>
        <Show when={overridden().length > 0}>
          <li>
            <span class="ri-k info-line">
              Overridden
              <InfoTip label="About Overridden">Variables from the agent's environment that the launch replaced with its own values.</InfoTip>
            </span>
            <span class="mono ri-wrap">{overridden().join(", ")}</span>
          </li>
        </Show>
      </ul>
    </section>
  );
}
