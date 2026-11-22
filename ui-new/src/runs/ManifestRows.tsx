import type { ClaudeRunManifest } from "@paperclipai/shared";
import { For, Show, type JSX, type ParentProps } from "solid-js";
import { InfoTip } from "@/ui/InfoTip";
import { accessText, credentialText, githubText, skillGroups } from "./run-manifest";
import "./ManifestRows.css";

/*
 * The rows of a sealed Claude run's manifest, shared by the run modal's "What this run got"
 * (RunManifest.tsx) and the agent's "What runs get" card (agents/settings/RunPreviewCard.tsx), so
 * the two read and look the same. Each row is a `<li>` for a `ManifestList`; the words come from
 * run-manifest.ts. A row that differs between a run and a preview (the session, CLAUDE.md) takes
 * its text from the caller through `ManifestRow`.
 */

export function ManifestList(props: ParentProps<{ class?: string }>) {
  return <ul class={`ri-kvl ${props.class ?? ""}`}>{props.children}</ul>;
}

/** One row: the label (with its "i" when there's help for it) and the value. */
export function ManifestRow(props: ParentProps<{ label: string; info?: JSX.Element }>) {
  return (
    <li>
      <Show when={props.info} fallback={<span class="ri-k">{props.label}</span>}>
        <span class="ri-k info-line">
          {props.label}
          <InfoTip label={`About ${props.label}`}>{props.info}</InfoTip>
        </span>
      </Show>
      <div class="ri-v">{props.children}</div>
    </li>
  );
}

/** A value in Fragment Mono that wraps anywhere: paths, names, variables. */
export function MonoValue(props: ParentProps) {
  return <span class="mono ri-wrap">{props.children}</span>;
}

export function CredentialRow(props: { credential: ClaudeRunManifest["credential"] | undefined }) {
  return <ManifestRow label="Credential">{credentialText(props.credential)}</ManifestRow>;
}

/**
 * The skills, one line per group (Paperclip, company, repository) by their plain names. `total`
 * adds a count under the groups, for the preview, which lists them before any run.
 */
export function SkillsRow(props: { manifest: Pick<ClaudeRunManifest, "skills" | "skillNameClashes">; total?: boolean }) {
  const groups = () => skillGroups(props.manifest);
  const count = () => groups().reduce((sum, group) => sum + group.skills.length, 0);
  return (
    <ManifestRow
      label="Skills"
      info={
        <>
          Names as on the Skills page. Claude sees each one under its group's prefix, such as paperclip:paperclip, company:&lt;name&gt; or project:&lt;name&gt;. A name marked "loaded
          twice" came from more than one group. Claude Code's built-in skills load too.
        </>
      }
    >
      <Show when={groups().length > 0} fallback="None">
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
          <Show when={props.total}>
            <li class="ri-count">{count() === 1 ? "1 skill" : `${count()} skills`}</li>
          </Show>
        </ul>
      </Show>
    </ManifestRow>
  );
}

export function McpServersRow(props: { servers: ClaudeRunManifest["mcpServers"] | undefined }) {
  const names = () => (Array.isArray(props.servers) ? props.servers.map((server) => server.name) : []);
  return (
    <ManifestRow label="MCP servers" info="Only these servers load: the run ignores any other MCP configuration.">
      <Show when={names().length > 0} fallback="None">
        <MonoValue>{names().join(", ")}</MonoValue>
      </Show>
    </ManifestRow>
  );
}

/** Shown only when the manifest records how the run gets GitHub (older runs don't). */
export function GitHubRow(props: { github: ClaudeRunManifest["github"] | undefined }) {
  return (
    <Show when={githubText(props.github)}>
      {(text) => (
        <ManifestRow
          label="GitHub"
          info={
            <>
              How git and gh got GitHub access: a GitHub connection in Paperclip, this server's own GitHub login (the agent's "Use this server's GitHub login"), or none, when they ran
              without credentials.
            </>
          }
        >
          {text()}
        </ManifestRow>
      )}
    </Show>
  );
}

export function AccessRow(props: { access: ClaudeRunManifest["access"] | undefined }) {
  return <ManifestRow label="Access">{accessText(props.access)}</ManifestRow>;
}

export function AutoMemoryRow() {
  return <ManifestRow label="Auto memory">Off</ManifestRow>;
}

/** Variables from the agent's environment the launch replaces; only when there are any. */
export function OverriddenRow(props: { names: string[] | undefined }) {
  const names = () => (Array.isArray(props.names) ? props.names : []);
  return (
    <Show when={names().length > 0}>
      <ManifestRow label="Overridden" info="Variables from the agent's environment that the launch replaced with its own values.">
        <MonoValue>{names().join(", ")}</MonoValue>
      </ManifestRow>
    </Show>
  );
}
