import type { CompanySkillDetail, CompanySkillListItem, FolderListItem } from "@paperclipai/shared";
import { A, useNavigate, useSearchParams } from "@solidjs/router";
import { BookOpen, ChevronDown, FileText, FolderSearch, GitBranch, GitFork, Link, Pencil, Plus, Search, Star, X } from "lucide-solid";
import { createMemo, createSignal, For, Match, Show, Switch } from "solid-js";
import { PickMenu } from "@/activity/PickMenu";
import { PAPERCLIP_CORE_SKILL_KEY } from "@/agents/agent-model";
import { CodeView } from "@/files/CodeView";
import { useCompany } from "@/lib/company";
import { useAgentsQuery } from "@/lib/company-data";
import { agoLabel, dayLabel } from "@/runs/run-model";
import { AgentAvatar } from "@/ui/Avatar";
import { Button, buttonClass } from "@/ui/Button";
import { Dialog } from "@/ui/Dialog";
import { Markdown } from "@/ui/Markdown";
import { Menu } from "@/ui/Menu";
import { TonePill, type Tone } from "@/ui/Status";
import { useSkillDetail, useSkillFile, useSkillFolders, useSkillList, useSkillVersions } from "./queries";
import { CompareVersionsDialog, ForkDialog, StarButton, UpdateBlock } from "./SkillActions";
import { FolderMenu, MoveToFolder } from "./SkillFolders";
import { ImportDialog, ScanProjectsDialog } from "./SkillImport";
import {
  folderSubtree,
  isCoreSkill,
  isLibraryFilter,
  isLibrarySort,
  leadsWithout,
  LIBRARY_FILTERS,
  LIBRARY_SORTS,
  libraryCounts,
  matchesFolder,
  matchesLibrary,
  matchesQuery,
  ORIGIN_LABEL,
  skillOrigin,
  sortedFiles,
  sortSkills,
  sourceLine,
  versionName,
  type FolderPick,
  type LibraryFilter,
  type LibrarySort,
  type SkillOrigin,
} from "./skills-model";

/*
 * The skill library (`/:prefix/skills`): every skill the company has, with where it comes from
 * (bundled with Paperclip, imported, or authored here), how many agents use it, and its version.
 * Filters by origin and "not in use", a folder (SkillFolders.tsx), a sort and a search, all but
 * the search kept in the address. The core Paperclip skills come first when sorted by name.
 * "Add skills" opens the catalog, an import from a path or URL, a project scan (SkillImport.tsx),
 * Sources, or a new skill in the Studio.
 *
 * Opening a skill (`/skills/:skillId`) shows its detail beside the list: what it's for, the agents
 * using it (`GET /skills/:id`, `usedByAgents`), the lead agents without a core skill, its source,
 * update status, forks, versions (compared in a dialog) and files. Star, Fork and its folder sit
 * under the title (SkillActions.tsx). Skills are turned on per agent in the agent's Skills
 * settings, which the agent links lead there; authored skills open in the Studio for editing.
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
  const navigate = useNavigate();
  const skills = useSkillList();
  const folders = useSkillFolders();
  const [search, setSearch] = useSearchParams<{ filter?: string; folder?: string; sort?: string }>();
  const filter = (): LibraryFilter => (isLibraryFilter(search.filter) ? search.filter : "all");
  const folder = (): FolderPick => search.folder || "all";
  const sort = (): LibrarySort => (isLibrarySort(search.sort) ? search.sort : "name");
  const [query, setQuery] = createSignal("");
  const [adding, setAdding] = createSignal<"import" | "scan" | null>(null);

  const folderList = () => folders.data?.folders ?? [];
  const subtree = createMemo(() => (folder() === "all" || folder() === "unfiled" ? null : folderSubtree(folderList(), folder())));
  const inFolder = createMemo(() => (skills.data ?? []).filter((skill) => matchesFolder(skill, folder(), subtree())));
  const counts = createMemo(() => libraryCounts(inFolder()));
  const shown = createMemo(() => sortSkills(inFolder().filter((skill) => matchesLibrary(skill, filter()) && matchesQuery(skill, query())), sort()));
  const keep = () => {
    const params = new URLSearchParams();
    if (search.filter) params.set("filter", search.filter);
    if (search.folder) params.set("folder", search.folder);
    if (search.sort) params.set("sort", search.sort);
    const text = params.toString();
    return text ? `?${text}` : "";
  };

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
        <FolderMenu
          folders={folderList()}
          allCount={folders.data?.allCount ?? skills.data?.length ?? 0}
          unfiledCount={folders.data?.unfiledCount ?? 0}
          value={folder()}
          onPick={(pick) => setSearch({ folder: pick === "all" ? undefined : pick }, { replace: true })}
        />
        <PickMenu
          label="Sort"
          value={sort() === "name" ? undefined : sort()}
          allLabel="Name"
          options={LIBRARY_SORTS.filter((entry) => entry.value !== "name")}
          onPick={(value) => setSearch({ sort: value }, { replace: true })}
        />
        <div class="act-toolbar-end">
          <label class="org-search">
            <Search size={14} aria-hidden="true" />
            <input type="search" placeholder="Search skills" aria-label="Search skills" value={query()} onInput={(event) => setQuery(event.currentTarget.value)} />
          </label>
          <Menu>
            <Menu.Trigger as={Button} variant="primary" size="compact" icon={<Plus size={14} stroke-width={2.2} aria-hidden="true" />}>
              Add skills
              <ChevronDown size={13} aria-hidden="true" />
            </Menu.Trigger>
            <Menu.Content label="Add skills" width={300} class="sk-add-menu">
              <Menu.Item icon={<BookOpen size={14} />} description="Paperclip's recommended and optional skills" onSelect={() => navigate(`${base()}/catalog`)}>
                Browse the catalog
              </Menu.Item>
              <Menu.Item icon={<Link size={14} />} description="A folder, a GitHub address or a skills.sh link" onSelect={() => setAdding("import")}>
                Import from a path or URL
              </Menu.Item>
              <Menu.Item icon={<FolderSearch size={14} />} description="Skill folders in a project's workspaces" onSelect={() => setAdding("scan")}>
                Scan a project
              </Menu.Item>
              <Menu.Item icon={<GitBranch size={14} />} description="A repository whose skills stay up to date" onSelect={() => navigate(`${base()}/sources`)}>
                Add a source
              </Menu.Item>
              <Menu.Separator />
              <Menu.Item icon={<Pencil size={14} />} description="Write one in the Studio" onSelect={() => navigate(`${base()}/studio/new`)}>
                New skill
              </Menu.Item>
            </Menu.Content>
          </Menu>
        </div>
      </div>
      <ImportDialog open={adding() === "import"} onOpenChange={(open) => setAdding(open ? "import" : null)} />
      <ScanProjectsDialog open={adding() === "scan"} onOpenChange={(open) => setAdding(open ? "scan" : null)} />

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
          {(skillId) => <SkillDetail skillId={skillId} closeHref={`${base()}${keep()}`} folders={folderList()} />}
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

function SkillDetail(props: { skillId: string; closeHref: string; folders: readonly FolderListItem[] }) {
  const company = useCompany();
  const prefix = () => `/${company().issuePrefix}`;
  const navigate = useNavigate();
  const detail = useSkillDetail(() => props.skillId);
  const versions = useSkillVersions(() => props.skillId);
  const agents = useAgentsQuery();
  const [file, setFile] = createSignal<string | null>(null);
  const [forking, setForking] = createSignal(false);
  const [comparing, setComparing] = createSignal<{ targetId: string | null } | null>(null);

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
                  <button type="button" class={buttonClass({ variant: "icon", size: "compact", ghost: true })} aria-label="Close" onClick={() => navigate(props.closeHref)}>
                    <X size={15} aria-hidden="true" />
                  </button>
                </header>
                <div class="org-row sk-detail-actions">
                  <StarButton skill={skill()} />
                  <Show when={origin() === "authored" && skill().editable}>
                    <A class={buttonClass({ size: "compact" })} href={`${prefix()}/skills/studio/${skill().id}`}>
                      <Pencil size={14} aria-hidden="true" />
                      Edit in Studio
                    </A>
                  </Show>
                  <Button size="compact" icon={<GitFork size={14} aria-hidden="true" />} onClick={() => setForking(true)}>
                    Fork
                  </Button>
                  <MoveToFolder skillId={skill().id} folderId={skill().folderId} folderPath={skill().folderPath} folders={props.folders} />
                </div>
                <Show when={skill().description}>
                  <p class="sk-desc">{skill().description}</p>
                </Show>

                <Show when={isCoreSkill(skill().key)}>
                  <div class="sk-note">
                    <p>
                      <Star size={13} aria-hidden="true" /> <b>Recommended for lead agents.</b> It's one of Paperclip's core skills: how a lead agent works with tasks, the
                      board, plans and hiring.
                      <Show when={skill().key === PAPERCLIP_CORE_SKILL_KEY}> Paperclip Runner agents don't need it: the Runner provides it.</Show>
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
                    <Show when={skill().starCount > 0 || skill().forkCount > 0 || skill().installCount > 0}>
                      <dt>Activity</dt>
                      <dd>
                        {[
                          skill().starCount ? `${skill().starCount} ${skill().starCount === 1 ? "star" : "stars"}` : null,
                          skill().forkCount ? `${skill().forkCount} ${skill().forkCount === 1 ? "fork" : "forks"}` : null,
                          skill().installCount ? `${skill().installCount} ${skill().installCount === 1 ? "install" : "installs"}` : null,
                        ]
                          .filter(Boolean)
                          .join(" · ")}
                      </dd>
                    </Show>
                  </dl>
                </section>

                <Show when={origin() !== "authored"}>
                  <UpdateBlock skill={skill()} />
                </Show>

                <Show when={skill().existingForks.length > 0}>
                  <section class="sk-block" aria-labelledby="sk-forks-h">
                    <h3 class="sk-block-head" id="sk-forks-h">
                      Forks
                    </h3>
                    <ul class="sk-agents">
                      <For each={skill().existingForks}>
                        {(fork) => (
                          <li>
                            <A class="sk-agent" href={`${prefix()}/skills/${fork.id}`}>
                              <GitFork size={14} aria-hidden="true" />
                              <span>{fork.name}</span>
                              <span class="org-muted">{fork.diverged ? "· changed since" : "· unchanged"}</span>
                            </A>
                          </li>
                        )}
                      </For>
                    </ul>
                  </section>
                </Show>

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
                  <div class="sk-versions-head">
                    <h3 class="sk-block-head" id="sk-versions-h">
                      Versions
                    </h3>
                    <Show when={(versions.data ?? []).length > 1}>
                      <button type="button" class="act-linkish" onClick={() => setComparing({ targetId: null })}>
                        Compare
                      </button>
                    </Show>
                  </div>
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
                            <Show when={version.revisionNumber > 1}>
                              <button type="button" class="act-linkish" aria-label={`What changed in ${versionName(version)}`} onClick={() => setComparing({ targetId: version.id })}>
                                Changes
                              </button>
                            </Show>
                          </li>
                        )}
                      </For>
                    </ul>
                  </Show>
                </section>
                <SkillFileDialog skill={skill()} path={file()} onClose={() => setFile(null)} />
                <ForkDialog open={forking()} onOpenChange={setForking} skill={skill()} />
                <CompareVersionsDialog
                  open={comparing() !== null}
                  onOpenChange={(open) => !open && setComparing(null)}
                  skillName={skill().name}
                  versions={versions.data ?? []}
                  targetId={comparing()?.targetId}
                />
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
