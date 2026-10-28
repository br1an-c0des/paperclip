import type { CompanySkillDetail, CompanySkillListItem } from "@paperclipai/shared";
import { A, useNavigate, useSearchParams } from "@solidjs/router";
import { FileText, Pencil, Plus, Search, Star, X } from "lucide-solid";
import { createMemo, createSignal, For, Match, Show, Switch } from "solid-js";
import { CodeView } from "@/files/CodeView";
import { useCompany } from "@/lib/company";
import { useAgentsQuery } from "@/lib/company-data";
import { agoLabel, dayLabel } from "@/runs/run-model";
import { AgentAvatar } from "@/ui/Avatar";
import { buttonClass } from "@/ui/Button";
import { Dialog } from "@/ui/Dialog";
import { Markdown } from "@/ui/Markdown";
import { TonePill, type Tone } from "@/ui/Status";
import { useSkillDetail, useSkillFile, useSkillList, useSkillVersions } from "./queries";
import {
  isCoreSkill,
  isLibraryFilter,
  leadsWithout,
  LIBRARY_FILTERS,
  libraryCounts,
  matchesLibrary,
  matchesQuery,
  ORIGIN_LABEL,
  PAPERCLIP_SKILL_KEY,
  skillOrigin,
  sortedFiles,
  sortLibrary,
  sourceLine,
  versionName,
  type LibraryFilter,
  type SkillOrigin,
} from "./skills-model";

/*
 * The skill library (`/:prefix/skills`): every skill the company has, with where it comes from
 * (bundled with Paperclip, imported, or authored here), how many agents use it, and its version.
 * Filters by origin and "not in use", and a search. The core Paperclip skills come first, marked
 * as recommended for lead agents.
 *
 * Opening a skill (`/skills/:skillId`) shows its detail beside the list: what it's for, the agents
 * using it (`GET /skills/:id`, `usedByAgents`), the lead agents without a core skill, its source,
 * versions and files. Skills are turned on per agent in the agent's Skills settings, which the
 * agent links lead there; authored skills open in the Studio for editing.
 */

const ORIGIN_TONE: Record<SkillOrigin, Tone> = { bundled: "violet", imported: "cyan", authored: "green" };

export function OriginPill(props: { origin: SkillOrigin }) {
  return (
    <TonePill tone={ORIGIN_TONE[props.origin]} compact>
      {props.origin === "bundled" ? "Bundled" : props.origin === "imported" ? "Imported" : "Authored"}
    </TonePill>
  );
}

export function SkillLibrary(props: { skillId: string | null }) {
  const company = useCompany();
  const base = () => `/${company().issuePrefix}/skills`;
  const skills = useSkillList();
  const [search, setSearch] = useSearchParams<{ filter?: string }>();
  const filter = (): LibraryFilter => (isLibraryFilter(search.filter) ? search.filter : "all");
  const [query, setQuery] = createSignal("");

  const counts = createMemo(() => libraryCounts(skills.data ?? []));
  const shown = createMemo(() => sortLibrary((skills.data ?? []).filter((skill) => matchesLibrary(skill, filter()) && matchesQuery(skill, query()))));
  const keep = () => (search.filter ? `?filter=${search.filter}` : "");

  return (
    <section class="act-section" aria-label="Skill library">
      <div class="act-toolbar">
        <div class="org-filters" role="group" aria-label="Filter skills">
          <For each={LIBRARY_FILTERS}>
            {(entry) => (
              <button type="button" class="org-ftab" aria-pressed={filter() === entry.value} onClick={() => setSearch({ filter: entry.value === "all" ? undefined : entry.value }, { replace: true })}>
                {entry.label}
                <span class="org-ftab-count">{counts()[entry.value]}</span>
              </button>
            )}
          </For>
        </div>
        <div class="act-toolbar-end">
          <label class="org-search">
            <Search size={14} aria-hidden="true" />
            <input type="search" placeholder="Search skills" aria-label="Search skills" value={query()} onInput={(event) => setQuery(event.currentTarget.value)} />
          </label>
          <A class={buttonClass({ variant: "primary", size: "compact" })} href={`${base()}/studio/new`}>
            <Plus size={14} stroke-width={2.2} aria-hidden="true" />
            New skill
          </A>
        </div>
      </div>

      <div class="sk-library" classList={{ "sk-library--open": props.skillId !== null }}>
        <section class="card act-card sk-list" aria-label="Skills">
          <Switch>
            <Match when={skills.isPending}>
              <p class="org-empty">Loading skills…</p>
            </Match>
            <Match when={skills.isError}>
              <p class="org-empty">Couldn't load the skills. {skills.error instanceof Error ? skills.error.message : ""}</p>
            </Match>
            <Match when={shown().length === 0}>
              <p class="org-empty">{(skills.data ?? []).length === 0 ? "No skills yet." : "No skills match."}</p>
            </Match>
          </Switch>
          <ul class="act-list">
            <For each={shown()}>{(skill) => <SkillRow skill={skill} href={`${base()}/${skill.id}${keep()}`} selected={props.skillId === skill.id} />}</For>
          </ul>
        </section>
        <Show when={props.skillId} keyed>
          {(skillId) => <SkillDetail skillId={skillId} closeHref={`${base()}${keep()}`} />}
        </Show>
      </div>
      <p class="org-foot">Bundled skills update with Paperclip and imported ones with their source. Turn a skill on for an agent in the agent's Skills settings.</p>
    </section>
  );
}

function SkillRow(props: { skill: CompanySkillListItem; href: string; selected: boolean }) {
  const origin = () => skillOrigin(props.skill);
  return (
    <li>
      <A class="sk-row" classList={{ "sk-row--selected": props.selected }} href={props.href} aria-current={props.selected ? "true" : undefined}>
        <span class="sk-row-main">
          <span class="sk-row-name">
            <span class="org-strong org-ellipsis">{props.skill.name}</span>
            <Show when={isCoreSkill(props.skill.key)}>
              <span class="sk-core" title="Recommended for lead agents">
                <Star size={12} aria-hidden="true" />
                Core
              </span>
            </Show>
          </span>
          <span class="org-muted sk-row-desc">{props.skill.description ?? props.skill.slug}</span>
        </span>
        <span class="sk-row-origin">
          <OriginPill origin={origin()} />
        </span>
        <span class="org-muted sk-row-num">
          {props.skill.attachedAgentCount === 0 ? "No agents" : `${props.skill.attachedAgentCount} ${props.skill.attachedAgentCount === 1 ? "agent" : "agents"}`}
        </span>
      </A>
    </li>
  );
}

function SkillDetail(props: { skillId: string; closeHref: string }) {
  const company = useCompany();
  const prefix = () => `/${company().issuePrefix}`;
  const navigate = useNavigate();
  const detail = useSkillDetail(() => props.skillId);
  const versions = useSkillVersions(() => props.skillId);
  const agents = useAgentsQuery();
  const [file, setFile] = createSignal<string | null>(null);

  const agentKey = (id: string) => agents.data?.find((agent) => agent.id === id)?.urlKey ?? id;
  const missing = createMemo(() => (detail.data ? leadsWithout(detail.data.key, detail.data.usedByAgents, agents.data ?? []) : []));

  return (
    <aside class="card sk-detail" aria-label="Skill">
      <Switch>
        <Match when={detail.isPending}>
          <p class="org-muted">Loading the skill…</p>
        </Match>
        <Match when={detail.isError}>
          <p class="org-muted" role="alert">
            Couldn't load this skill. {detail.error instanceof Error ? detail.error.message : ""}
          </p>
        </Match>
        <Match when={detail.data}>
          {(skill) => {
            const origin = () => skillOrigin(skill());
            return (
              <>
                <header class="sk-detail-head">
                  <div class="sk-detail-title">
                    <h2 class="disp">{skill().name}</h2>
                    <div class="org-row">
                      <OriginPill origin={origin()} />
                      <span class="mono org-muted sk-key">{skill().key}</span>
                    </div>
                  </div>
                  <Show when={origin() === "authored" && skill().editable}>
                    <A class={buttonClass({ size: "compact" })} href={`${prefix()}/skills/studio/${skill().id}`}>
                      <Pencil size={14} aria-hidden="true" />
                      Edit in Studio
                    </A>
                  </Show>
                  <button type="button" class={buttonClass({ variant: "icon", size: "compact", ghost: true })} aria-label="Close" onClick={() => navigate(props.closeHref)}>
                    <X size={15} aria-hidden="true" />
                  </button>
                </header>
                <Show when={skill().description}>
                  <p class="sk-desc">{skill().description}</p>
                </Show>

                <Show when={isCoreSkill(skill().key)}>
                  <div class="sk-note">
                    <p>
                      <Star size={13} aria-hidden="true" /> <b>Recommended for lead agents.</b> It's one of Paperclip's core skills: how a lead agent works with tasks, the
                      board, plans and hiring.
                      <Show when={skill().key === PAPERCLIP_SKILL_KEY}> Paperclip Runner agents don't need it: the Runner provides it.</Show>
                    </p>
                    <Show when={missing().length > 0}>
                      <p class="org-muted">Lead agents without it:</p>
                      <ul class="sk-agents">
                        <For each={missing()}>
                          {(agent) => (
                            <li>
                              <A class="sk-agent" href={`${prefix()}/agents/${agent.urlKey}/settings/skills`}>
                                <AgentAvatar agent={agent} size={20} />
                                <span>{agent.name}</span>
                              </A>
                            </li>
                          )}
                        </For>
                      </ul>
                    </Show>
                  </div>
                </Show>

                <section class="sk-block" aria-labelledby="sk-used-h">
                  <h3 class="sk-block-head" id="sk-used-h">
                    Used by
                  </h3>
                  <Show when={skill().usedByAgents.length > 0} fallback={<p class="org-muted">No agent has this skill turned on.</p>}>
                    <ul class="sk-agents">
                      <For each={skill().usedByAgents}>
                        {(agent) => (
                          <li>
                            <A class="sk-agent" href={`${prefix()}/agents/${agentKey(agent.id)}/settings/skills`}>
                              <AgentAvatar agent={{ id: agent.id, name: agent.name, appearance: agents.data?.find((entry) => entry.id === agent.id)?.appearance }} size={20} />
                              <span>{agent.name}</span>
                              <Show when={agent.versionId}>
                                {(versionId) => (
                                  <span class="org-muted">
                                    · pinned to {(() => {
                                      const found = versions.data?.find((version) => version.id === versionId());
                                      return found ? `v${found.revisionNumber}` : "an older version";
                                    })()}
                                  </span>
                                )}
                              </Show>
                            </A>
                          </li>
                        )}
                      </For>
                    </ul>
                  </Show>
                </section>

                <section class="sk-block" aria-labelledby="sk-about-h">
                  <h3 class="sk-block-head" id="sk-about-h">
                    About
                  </h3>
                  <dl class="sk-facts">
                    <dt>Origin</dt>
                    <dd>{origin() === "imported" ? `${ORIGIN_LABEL.imported} from ${sourceLine(skill())}` : ORIGIN_LABEL[origin()]}</dd>
                    <dt>Version</dt>
                    <dd>{skill().currentVersion ? versionName(skill().currentVersion!) : "Not versioned"}</dd>
                    <dt>Updated</dt>
                    <dd>{dayLabel(skill().updatedAt)}</dd>
                    <dt>Contains</dt>
                    <dd>{trustText(skill())}</dd>
                    <Show when={skill().categories.length > 0}>
                      <dt>Categories</dt>
                      <dd>{skill().categories.join(", ")}</dd>
                    </Show>
                    <Show when={!skill().editable && skill().editableReason}>
                      <dt>Editing</dt>
                      <dd>{skill().editableReason}</dd>
                    </Show>
                  </dl>
                </section>

                <section class="sk-block" aria-labelledby="sk-files-h">
                  <h3 class="sk-block-head" id="sk-files-h">
                    Files
                  </h3>
                  <ul class="sk-files">
                    <For each={sortedFiles(skill().fileInventory)}>
                      {(entry) => (
                        <li>
                          <button type="button" class="sk-file" onClick={() => setFile(entry.path)}>
                            <FileText size={14} aria-hidden="true" />
                            <span class="mono org-ellipsis">{entry.path}</span>
                            <span class="org-muted">{entry.kind === "skill" ? "Instructions" : entry.kind}</span>
                          </button>
                        </li>
                      )}
                    </For>
                  </ul>
                </section>

                <section class="sk-block" aria-labelledby="sk-versions-h">
                  <h3 class="sk-block-head" id="sk-versions-h">
                    Versions
                  </h3>
                  <Show when={(versions.data ?? []).length > 0} fallback={<p class="org-muted">{versions.isPending ? "Loading…" : "No saved versions."}</p>}>
                    <ul class="sk-versions">
                      <For each={(versions.data ?? []).slice(0, 8)}>
                        {(version) => (
                          <li>
                            <span class="org-strong">{versionName(version)}</span>
                            <Show when={version.id === skill().currentVersionId}>
                              <TonePill tone="green" compact>
                                Current
                              </TonePill>
                            </Show>
                            <span class="org-muted org-push">{whenLabel(version.createdAt)}</span>
                          </li>
                        )}
                      </For>
                    </ul>
                  </Show>
                </section>
                <SkillFileDialog skill={skill()} path={file()} onClose={() => setFile(null)} />
              </>
            );
          }}
        </Match>
      </Switch>
    </aside>
  );
}

/** "4m ago" within a day, else "Oct 12". */
export function whenLabel(value: string | Date) {
  return Date.now() - new Date(value).getTime() < 86_400_000 ? agoLabel(value) : dayLabel(value);
}

function trustText(skill: Pick<CompanySkillDetail, "trustLevel">) {
  if (skill.trustLevel === "scripts_executables") return "Instructions, files and scripts";
  if (skill.trustLevel === "assets") return "Instructions and files";
  return "Instructions only";
}

/** One file of a skill, read-only: Markdown rendered, anything else as source. */
export function SkillFileDialog(props: { skill: Pick<CompanySkillDetail, "id" | "name">; path: string | null; onClose: () => void }) {
  const file = useSkillFile(
    () => (props.path ? props.skill.id : null),
    () => props.path,
  );
  return (
    <Dialog open={props.path !== null} onOpenChange={(open) => !open && props.onClose()} width={820} title={props.path ?? ""} description={props.skill.name}>
      <Switch>
        <Match when={file.isPending}>
          <p class="org-muted">Loading…</p>
        </Match>
        <Match when={file.isError}>
          <p class="org-muted" role="alert">
            Couldn't open the file. {file.error instanceof Error ? file.error.message : ""}
          </p>
        </Match>
        <Match when={file.data?.encoding === "base64"}>
          <p class="org-muted">This file isn't text, so it can't be shown here.</p>
        </Match>
        <Match when={file.data?.markdown}>
          <div class="sk-file-view">
            <Markdown source={file.data!.content} />
          </div>
        </Match>
        <Match when={file.data}>
          {(data) => (
            <div class="sk-file-view">
              <CodeView value={data().content} filename={data().path} label={data().path} />
            </div>
          )}
        </Match>
      </Switch>
    </Dialog>
  );
}
