import type { AgentDetail } from "@paperclipai/shared";
import { A } from "@solidjs/router";
import { createQuery } from "@tanstack/solid-query";
import { Brain, File } from "lucide-solid";
import { createMemo, createSignal, For, Match, Show, Switch } from "solid-js";
import { agentsApi } from "@/api/agents";
import { queryKeys } from "@/api/queryKeys";
import { useCompany } from "@/lib/company";
import { useExperimentalSettingsQuery } from "@/lib/company-data";
import { SettingsCard, SettingsRow } from "@/ui/Field";
import { Markdown } from "@/ui/Markdown";
import { TonePill } from "@/ui/Status";
import { isMemoryFile, memoryFor, runtimeIdentity } from "../agent-model";
import { failure, SectionTitle, useAdapters } from "../shared";

/*
 * Memory (decision 5, option 4): which memory applies to the agent's harness and runner, and what
 * of it the API can show.
 *
 * - The agent's folder (`AGENT_HOME`, its instructions bundle) lasts between runs on `claude_local`
 *   and on the Paperclip Runner; the `para-memory-files` skill keeps notes in MEMORY.md, memory/
 *   and life/ there, which are listed and readable here.
 * - Claude Code's own auto memory runs outside the API: for `claude_local` it's shared per working
 *   directory; through the Runner (isolated mode) it lasts one session. The interim fix is
 *   `CLAUDE_CODE_DISABLE_AUTO_MEMORY=1`, which this section checks the agent's variables for.
 * - Memory connectors (Mem0, Zep, …) are tool connections assigned to the agent.
 */

const MEMORY_CONNECTORS = new Set(["mem0", "zep", "supermemory", "cognee", "honcho"]);

export function MemorySection(props: { agent: AgentDetail; base: string }) {
  const company = useCompany();
  const adapters = useAdapters(() => props.agent);
  const experimental = useExperimentalSettingsQuery();
  const identity = createMemo(() => runtimeIdentity(props.agent));
  const memory = createMemo(() =>
    memoryFor(props.agent, props.agent.adapterType === "paperclip_runner" ? true : adapters.harness()?.capabilities.supportsInstructionsBundle),
  );
  const bundle = createQuery(() => ({
    queryKey: queryKeys.agents.instructionsBundle(props.agent.id),
    queryFn: ({ signal }) => agentsApi.instructionsBundle(props.agent.id, company().id, signal),
    enabled: memory().kind === "agent-files",
    retry: false,
  }));
  const skills = createQuery(() => ({
    queryKey: queryKeys.agents.part(props.agent.id, "skills"),
    queryFn: ({ signal }) => agentsApi.skills(props.agent.id, company().id, signal),
    retry: false,
  }));
  const tools = createQuery(() => ({
    queryKey: queryKeys.agents.part(props.agent.id, "effective-tools"),
    queryFn: ({ signal }) => agentsApi.effectiveTools(company().id, props.agent.id, signal),
    retry: false,
  }));
  const memoryFiles = createMemo(() => (bundle.data?.files ?? []).filter((file) => isMemoryFile(file.path)));
  const paraSkill = createMemo(() => (skills.data?.entries ?? []).find((entry) => entry.key.endsWith("/para-memory-files") || entry.runtimeName === "para-memory-files"));
  const connectors = createMemo(() =>
    (tools.data?.installedConnections ?? []).filter((connection) => MEMORY_CONNECTORS.has(String((connection.config as Record<string, unknown> | undefined)?.sourceTemplateKey ?? ""))),
  );
  const env = () => ((props.agent.adapterConfig as Record<string, unknown>).env ?? {}) as Record<string, unknown>;
  const autoMemoryOff = () => {
    const binding = env().CLAUDE_CODE_DISABLE_AUTO_MEMORY;
    if (typeof binding === "string") return binding === "1" || binding === "true";
    const value = (binding as { type?: string; value?: string } | undefined)?.value;
    return binding !== undefined && (value === undefined || value === "1" || value === "true");
  };
  const [open, setOpen] = createSignal<string | null>(null);

  return (
    <>
      <SectionTitle title="Memory">
        What {props.agent.name} remembers between runs, and where. It depends on the harness: {identity().label}.
      </SectionTitle>

      <SettingsCard title="What applies to this agent">
        <SettingsRow label="Its own folder" help="Notes the agent keeps in its folder, which Paperclip saves after each run.">
          <Switch>
            <Match when={memory().kind === "agent-files"}>
              <div class="ps-stack">
                <TonePill tone="green" compact>
                  Kept between runs
                </TonePill>
                <span class="fhelp">
                  The para-memory-files skill writes MEMORY.md, memory/ and life/ here.{" "}
                  {paraSkill()?.desired ? "It's assigned to this agent." : "It isn't assigned to this agent, so nothing tells it to keep notes there."}
                </span>
              </div>
            </Match>
            <Match when={memory().kind === "none"}>
              <div class="ps-stack">
                <TonePill tone="amber" compact>
                  No folder
                </TonePill>
                <span class="fhelp">{identity().harnessLabel} has no agent folder, so each session starts with no memory unless it has a memory connector.</span>
              </div>
            </Match>
            <Match when={memory().kind === "unknown"}>
              <span class="ag-static-text">Checking the harness…</span>
            </Match>
          </Switch>
        </SettingsRow>
        <Show when={memory().claudeAutoMemory}>
          <SettingsRow label="Claude Code auto memory" help="Claude Code's built-in memory. Paperclip can't read it.">
            <div class="ps-stack">
              <Show
                when={!autoMemoryOff()}
                fallback={
                  <TonePill tone="green" compact>
                    Turned off for this agent
                  </TonePill>
                }
              >
                <TonePill tone="amber" compact>
                  {memory().claudeAutoMemory === "per-session" ? "On, for one session at a time" : "On, shared per working directory"}
                </TonePill>
              </Show>
              <span class="fhelp">
                {memory().claudeAutoMemory === "per-session"
                  ? "Through the Paperclip Runner, Claude gets a fresh config folder each session, so these notes don't carry over."
                  : "Notes land in Claude's config folder by project, outside the API, and every agent in the same project shares them."}{" "}
                <Show when={!autoMemoryOff()}>
                  To rely on the agent's folder alone, set CLAUDE_CODE_DISABLE_AUTO_MEMORY=1 under{" "}
                  <A class="ps-link" href={`${props.base}/secrets`}>
                    Secrets and variables
                  </A>
                  .
                </Show>
              </span>
            </div>
          </SettingsRow>
        </Show>
        <SettingsRow label="Memory connectors" help="Mem0, Zep, Supermemory, Cognee or Honcho, assigned like any tool connection.">
          <Show
            when={connectors().length > 0}
            fallback={
              <span class="ag-static-text">
                None assigned.{experimental.data?.enableMemoryConnectors === false ? " Memory connectors are off on this instance." : ""}
              </span>
            }
          >
            <div class="ps-inline">
              <For each={connectors()}>
                {(connection) => (
                  <TonePill tone="cyan" compact>
                    {connection.name}
                  </TonePill>
                )}
              </For>
            </div>
          </Show>
        </SettingsRow>
      </SettingsCard>

      <Show when={memory().kind === "agent-files"}>
        <SettingsCard title="Memory files" description="What the agent has written to MEMORY.md, memory/ and life/. Edit them under Instructions.">
          <Show when={bundle.isError}>
            <p class="ps-list-note" role="alert">
              Couldn't load the agent's files. {failure(bundle.error, "")}
            </p>
          </Show>
          <Show when={memoryFiles().length > 0} fallback={<Show when={bundle.isSuccess}><p class="ps-list-note">No memory files yet.</p></Show>}>
            <ul class="ps-list ag-memory-files">
              <For each={memoryFiles()}>
                {(file) => (
                  <li class="ps-list-row">
                    <button type="button" class="ag-memory-file" aria-expanded={open() === file.path} onClick={() => setOpen(open() === file.path ? null : file.path)}>
                      <File size={14} aria-hidden="true" />
                      <span class="mono">{file.path}</span>
                      <span class="ps-list-meta">{file.size} bytes</span>
                    </button>
                    <Show when={open() === file.path}>
                      <MemoryFile agent={props.agent} path={file.path} />
                    </Show>
                  </li>
                )}
              </For>
            </ul>
          </Show>
        </SettingsCard>
      </Show>

      <div class="ag-note ag-note--quiet" role="note">
        <span class="ag-note-icon" aria-hidden="true">
          <Brain size={18} />
        </span>
        <div class="ag-note-text">
          <b>One memory for every harness is still to come</b>
          <span>These three don't know about each other yet, so a lesson saved in one isn't seen by the others.</span>
        </div>
      </div>
    </>
  );
}

function MemoryFile(props: { agent: AgentDetail; path: string }) {
  const company = useCompany();
  const file = createQuery(() => ({
    queryKey: queryKeys.agents.instructionsFile(props.agent.id, props.path),
    queryFn: ({ signal }) => agentsApi.instructionsFile(props.agent.id, props.path, company().id, signal),
    retry: false,
  }));
  return (
    <div class="ag-memory-body">
      <Show when={file.data} fallback={<p class="ps-list-note">{file.isError ? failure(file.error, "Couldn't open the file.") : "Loading…"}</p>}>
        {(found) => (found().markdown ? <Markdown source={found().content} /> : <pre class="ag-pre mono">{found().content}</pre>)}
      </Show>
    </div>
  );
}
