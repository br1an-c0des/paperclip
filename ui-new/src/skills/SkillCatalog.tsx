import type { CatalogSkill, CompanySkillListItem } from "@paperclipai/shared";
import { A, useNavigate, useSearchParams } from "@solidjs/router";
import { createQuery } from "@tanstack/solid-query";
import { Check, Download, FileText, Search, X } from "lucide-solid";
import { createEffect, createMemo, createSignal, For, Match, on, Show, Switch } from "solid-js";
import { agentsApi } from "@/api/agents";
import { queryKeys } from "@/api/queryKeys";
import { skillsApi } from "@/api/skills";
import { CodeView } from "@/files/CodeView";
import { useCompany } from "@/lib/company";
import { useAgentsQuery } from "@/lib/company-data";
import { AgentAvatar } from "@/ui/Avatar";
import { Button, buttonClass } from "@/ui/Button";
import { Dialog } from "@/ui/Dialog";
import { Field, TextInput } from "@/ui/Field";
import { Markdown } from "@/ui/Markdown";
import { TonePill } from "@/ui/Status";
import { pushToast } from "@/ui/Toast";
import { failureText, useRefreshSkills, useSkillCatalog, useSkillList } from "./queries";
import {
  CATALOG_FILTERS,
  catalogGroups,
  categoryLabel,
  installedFromCatalog,
  isCatalogFilter,
  matchesCatalog,
  sizeLabel,
  slugFor,
  slugProblem,
  type CatalogKindFilter,
} from "./skills-model";

/*
 * The catalog (`/:prefix/skills/catalog`): skills that ship with Paperclip (`GET /skills/catalog`),
 * recommended ones and optional extras, grouped by category, with what's already in the library.
 * Opening one shows what it's for, who it suits, its files (read with `GET …/catalog/:id/files`) and
 * where it comes from. Install (`POST /companies/:id/skills/install-catalog`) copies it into the
 * library, optionally under another name or over a skill with the same name, and turns it on for the
 * agents picked (`POST /agents/:id/skills/sync`, mode "add"), as the old install dialog does.
 */

export function SkillCatalog(props: { catalogId: string | null }) {
  const company = useCompany();
  const base = () => `/${company().issuePrefix}/skills/catalog`;
  const catalog = useSkillCatalog();
  const skills = useSkillList();
  const [search, setSearch] = useSearchParams<{ filter?: string }>();
  const filter = (): CatalogKindFilter => (isCatalogFilter(search.filter) ? search.filter : "all");
  const [query, setQuery] = createSignal("");
  const installed = createMemo(() => installedFromCatalog(catalog.data ?? [], skills.data ?? []));
  const counts = createMemo(() =>
    Object.fromEntries(CATALOG_FILTERS.map(({ value }) => [value, (catalog.data ?? []).filter((entry) => matchesCatalog(entry, value, installed().has(entry.id), "")).length])),
  );
  const groups = createMemo(() => catalogGroups((catalog.data ?? []).filter((entry) => matchesCatalog(entry, filter(), installed().has(entry.id), query()))));
  const keep = () => (search.filter ? `?filter=${search.filter}` : "");
  const selected = () => (props.catalogId ? (catalog.data ?? []).find((entry) => entry.id === props.catalogId) ?? null : null);

  return (
    <section class="act-section" aria-label="Skill catalog">
      <div class="act-toolbar">
        <div class="org-filters" role="group" aria-label="Filter the catalog">
          <For each={CATALOG_FILTERS}>
            {(entry) => (
              <button type="button" class="org-ftab" aria-pressed={filter() === entry.value} onClick={() => setSearch({ filter: entry.value === "all" ? undefined : entry.value }, { replace: true })}>
                {entry.label}
                <span class="org-ftab-count">{counts()[entry.value] ?? 0}</span>
              </button>
            )}
          </For>
        </div>
        <div class="act-toolbar-end">
          <label class="org-search">
            <Search size={14} aria-hidden="true" />
            <input type="search" placeholder="Search the catalog" aria-label="Search the catalog" value={query()} onInput={(event) => setQuery(event.currentTarget.value)} />
          </label>
        </div>
      </div>

      <div class="sk-library" classList={{ "sk-library--open": props.catalogId !== null }}>
        <section class="card act-card sk-list" aria-label="Catalog skills">
          <Switch>
            <Match when={catalog.isPending}>
              <p class="org-empty">Loading the catalog…</p>
            </Match>
            <Match when={catalog.isError}>
              <p class="org-empty">Couldn't load the catalog. {failureText(catalog.error, "")}</p>
            </Match>
            <Match when={groups().length === 0}>
              <p class="org-empty">No catalog skills match.</p>
            </Match>
          </Switch>
          <For each={groups()}>
            {(group) => (
              <div class="sk-group">
                <h3 class="sk-group-head">{group.label}</h3>
                <ul class="act-list">
                  <For each={group.skills}>
                    {(entry) => (
                      <li>
                        <A
                          class="sk-row"
                          classList={{ "sk-row--selected": props.catalogId === entry.id }}
                          href={`${base()}/${encodeURIComponent(entry.id)}${keep()}`}
                          aria-current={props.catalogId === entry.id ? "true" : undefined}
                        >
                          <span class="sk-row-main">
                            <span class="sk-row-name">
                              <span class="org-strong org-ellipsis">{entry.name}</span>
                            </span>
                            <span class="org-muted sk-row-desc">{entry.description}</span>
                          </span>
                          <span class="sk-row-origin">
                            <TonePill tone={entry.kind === "bundled" ? "violet" : "cyan"} compact>
                              {entry.kind === "bundled" ? "Recommended" : "Optional"}
                            </TonePill>
                          </span>
                          <span class="org-muted sk-row-num">{installed().has(entry.id) ? "Installed" : ""}</span>
                        </A>
                      </li>
                    )}
                  </For>
                </ul>
              </div>
            )}
          </For>
        </section>
        <Show when={props.catalogId}>
          <Show when={selected()} fallback={<aside class="card sk-detail"><p class="org-muted">{catalog.isPending ? "Loading…" : "That catalog skill wasn't found."}</p></aside>}>
            {(entry) => <CatalogDetail entry={entry()} installed={installed().get(entry().id) ?? null} closeHref={`${base()}${keep()}`} />}
          </Show>
        </Show>
      </div>
      <p class="org-foot">Recommended skills cover common work; optional ones add a tool or a practice. Installed skills update with Paperclip.</p>
    </section>
  );
}

function CatalogDetail(props: { entry: CatalogSkill; installed: CompanySkillListItem | null; closeHref: string }) {
  const company = useCompany();
  const navigate = useNavigate();
  const [file, setFile] = createSignal<string | null>(null);
  const [installing, setInstalling] = createSignal(false);
  return (
    <aside class="card sk-detail" aria-label="Catalog skill">
      <header class="sk-detail-head">
        <div class="sk-detail-title">
          <h2 class="disp">{props.entry.name}</h2>
          <div class="org-row">
            <TonePill tone={props.entry.kind === "bundled" ? "violet" : "cyan"} compact>
              {props.entry.kind === "bundled" ? "Recommended" : "Optional"}
            </TonePill>
            <span class="mono org-muted sk-key">{props.entry.key}</span>
          </div>
        </div>
        <button type="button" class={buttonClass({ variant: "icon", size: "compact", ghost: true })} aria-label="Close" onClick={() => navigate(props.closeHref)}>
          <X size={15} aria-hidden="true" />
        </button>
      </header>
      <p class="sk-desc">{props.entry.description}</p>

      <div class="org-row">
        <Show
          when={props.installed}
          fallback={
            <Button variant="primary" size="compact" icon={<Download size={14} aria-hidden="true" />} onClick={() => setInstalling(true)}>
              Install
            </Button>
          }
        >
          {(skill) => (
            <>
              <A class={buttonClass({ size: "compact" })} href={`/${company().issuePrefix}/skills/${skill().id}`}>
                <Check size={14} aria-hidden="true" />
                In the library
              </A>
              <Button size="compact" variant="quiet" onClick={() => setInstalling(true)}>
                Install again…
              </Button>
            </>
          )}
        </Show>
      </div>

      <section class="sk-block" aria-labelledby="sk-cat-about-h">
        <h3 class="sk-block-head" id="sk-cat-about-h">
          About
        </h3>
        <dl class="sk-facts">
          <dt>Category</dt>
          <dd>{categoryLabel(props.entry.category)}</dd>
          <Show when={props.entry.recommendedForRoles.length > 0}>
            <dt>Suits</dt>
            <dd>{props.entry.recommendedForRoles.join(", ")}</dd>
          </Show>
          <Show when={props.entry.tags.length > 0}>
            <dt>Tags</dt>
            <dd>{props.entry.tags.join(", ")}</dd>
          </Show>
          <Show when={props.entry.requires.length > 0}>
            <dt>Needs</dt>
            <dd>{props.entry.requires.join(", ")}</dd>
          </Show>
          <dt>Contains</dt>
          <dd>{props.entry.trustLevel === "scripts_executables" ? "Instructions, files and scripts" : props.entry.trustLevel === "assets" ? "Instructions and files" : "Instructions only"}</dd>
          <Show when={props.entry.packageName}>
            <dt>Package</dt>
            <dd class="mono">
              {props.entry.packageName}
              {props.entry.packageVersion ? `@${props.entry.packageVersion}` : ""}
            </dd>
          </Show>
          <Show when={props.entry.source}>
            {(source) => (
              <>
                <dt>Source</dt>
                <dd>
                  <a class="org-link" href={source().url} target="_blank" rel="noreferrer">
                    {source().owner}/{source().repo}
                  </a>{" "}
                  <span class="mono org-muted">{source().commit.slice(0, 7)}</span>
                </dd>
              </>
            )}
          </Show>
        </dl>
      </section>

      <section class="sk-block" aria-labelledby="sk-cat-files-h">
        <h3 class="sk-block-head" id="sk-cat-files-h">
          Files
        </h3>
        <ul class="sk-files">
          <For each={props.entry.files}>
            {(entry) => (
              <li>
                <button type="button" class="sk-file" onClick={() => setFile(entry.path)}>
                  <FileText size={14} aria-hidden="true" />
                  <span class="mono org-ellipsis">{entry.path}</span>
                  <span class="org-muted">{sizeLabel(entry.sizeBytes)}</span>
                </button>
              </li>
            )}
          </For>
        </ul>
      </section>
      <CatalogFileDialog entry={props.entry} path={file()} onClose={() => setFile(null)} />
      <InstallDialog open={installing()} onOpenChange={setInstalling} entry={props.entry} installed={props.installed} />
    </aside>
  );
}

function CatalogFileDialog(props: { entry: CatalogSkill; path: string | null; onClose: () => void }) {
  const file = createQuery(() => ({
    queryKey: queryKeys.skills.catalogFile(props.entry.id, props.path ?? ""),
    queryFn: ({ signal }) => skillsApi.catalogFile(props.entry.id, props.path!, signal),
    enabled: props.path !== null,
    staleTime: 5 * 60_000,
  }));
  return (
    <Dialog open={props.path !== null} onOpenChange={(open) => !open && props.onClose()} width={820} title={props.path ?? ""} description={props.entry.name}>
      <Switch>
        <Match when={file.isPending}>
          <p class="org-muted">Loading…</p>
        </Match>
        <Match when={file.isError}>
          <p class="org-muted" role="alert">
            Couldn't open the file. {failureText(file.error, "")}
          </p>
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

function InstallDialog(props: { open: boolean; onOpenChange: (open: boolean) => void; entry: CatalogSkill; installed: CompanySkillListItem | null }) {
  const company = useCompany();
  const navigate = useNavigate();
  const refresh = useRefreshSkills();
  const skills = useSkillList();
  const agents = useAgentsQuery();
  const [slug, setSlug] = createSignal("");
  const [replace, setReplace] = createSignal(false);
  const [enableFor, setEnableFor] = createSignal<ReadonlySet<string>>(new Set());
  const [busy, setBusy] = createSignal(false);
  const [error, setError] = createSignal<string | null>(null);
  const eligible = createMemo(() =>
    (agents.data ?? []).filter((agent) => agent.status !== "terminated" && agent.status !== "pending_approval").sort((a, b) => a.name.localeCompare(b.name)),
  );
  // An authored or imported skill with the same name blocks the install unless it's renamed or replaced.
  const clash = createMemo(() => {
    const wanted = (slug().trim() || props.entry.slug).toLowerCase();
    return (skills.data ?? []).find((skill) => skill.slug.toLowerCase() === wanted && skill.key.toLowerCase() !== props.entry.key.toLowerCase()) ?? null;
  });
  const slugError = () => (slug().trim() ? slugProblem(slug()) : null);

  createEffect(
    on(
      () => props.open,
      (open) => {
        if (!open) return;
        setSlug("");
        setReplace(Boolean(props.installed));
        setEnableFor(new Set<string>());
        setError(null);
      },
    ),
  );

  const toggle = (agentId: string) =>
    setEnableFor((current) => {
      const next = new Set(current);
      if (next.has(agentId)) next.delete(agentId);
      else next.add(agentId);
      return next;
    });

  const install = async () => {
    setBusy(true);
    setError(null);
    try {
      const result = await skillsApi.installCatalog(company().id, { catalogSkillId: props.entry.id, slug: slug().trim() || null, force: replace() });
      // Turning it on for agents is best effort: the skill is in the library either way.
      let enabled = 0;
      let failed = 0;
      if (result.action === "created") {
        for (const agentId of enableFor()) {
          try {
            await agentsApi.syncSkills(agentId, [{ key: result.skill.key, versionId: null }], "add", company().id);
            enabled += 1;
          } catch {
            failed += 1;
          }
        }
      }
      refresh(result.skill.id);
      pushToast({
        tone: "success",
        title: result.action === "created" ? `Installed ${result.skill.name}` : result.action === "updated" ? `Updated ${result.skill.name}` : `${result.skill.name} is up to date`,
        body: result.action === "created" ? (enabled > 0 ? `Turned on for ${enabled} ${enabled === 1 ? "agent" : "agents"}.` : "Turn it on for agents in their Skills settings.") : undefined,
      });
      if (failed > 0) pushToast({ tone: "warn", title: "Some agents didn't get it", body: `Couldn't turn it on for ${failed} ${failed === 1 ? "agent" : "agents"}; try their Skills settings.` });
      if (result.warnings[0]) pushToast({ tone: "warn", title: "Installed with a warning", body: result.warnings[0] });
      props.onOpenChange(false);
      navigate(`/${company().issuePrefix}/skills/${result.skill.id}`);
    } catch (caught) {
      setError(failureText(caught, "Couldn't install the skill."));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Dialog
      open={props.open}
      onOpenChange={props.onOpenChange}
      width={540}
      title={`Install ${props.entry.name}`}
      description={props.installed ? "It's already in the library. Installing again brings it back to the catalog's version." : "Copies it into the library."}
      footer={
        <div class="org-dialog-foot">
          <Button variant="quiet" onClick={() => props.onOpenChange(false)} disabled={busy()}>
            Cancel
          </Button>
          <Button variant="primary" disabled={busy() || Boolean(slugError()) || (Boolean(clash()) && !replace())} onClick={() => void install()}>
            {busy() ? "Installing…" : "Install"}
          </Button>
        </div>
      }
    >
      <div class="sk-form">
        <Field label="Name in the library" for="sk-install-slug" error={slugError() ?? undefined} help={`Leave empty to use ${props.entry.slug}.`}>
          <TextInput id="sk-install-slug" value={slug()} placeholder={props.entry.slug} onInput={(event) => setSlug(event.currentTarget.value)} onBlur={() => slug().trim() && setSlug(slugFor(slug()))} />
        </Field>
        <Show when={clash() || props.installed}>
          <button type="button" role="checkbox" class="sk-candidate" aria-checked={replace()} onClick={() => setReplace(!replace())}>
            <span class="org-cbox" aria-hidden="true">
              <Show when={replace()}>
                <Check size={11} stroke-width={3.2} />
              </Show>
            </span>
            <span class="sk-candidate-text">
              <span class="org-strong">Replace the library's copy</span>
              <span class="org-muted">
                {clash() ? `“${clash()!.name}” already uses that name. Replacing overwrites its files.` : "Overwrites any changes made to it here."}
              </span>
            </span>
          </button>
        </Show>
        <Show when={!props.installed && eligible().length > 0}>
          <div class="org-row">
            <span class="org-muted">Turn it on for:</span>
            <button type="button" class="act-linkish" onClick={() => setEnableFor(new Set(eligible().map((agent) => agent.id)))}>
              Every agent
            </button>
            <button type="button" class="act-linkish" onClick={() => setEnableFor(new Set<string>())}>
              None
            </button>
          </div>
          <ul class="sk-candidates">
            <For each={eligible()}>
              {(agent) => (
                <li>
                  <button type="button" role="checkbox" class="sk-candidate" aria-checked={enableFor().has(agent.id)} onClick={() => toggle(agent.id)}>
                    <span class="org-cbox" aria-hidden="true">
                      <Show when={enableFor().has(agent.id)}>
                        <Check size={11} stroke-width={3.2} />
                      </Show>
                    </span>
                    <AgentAvatar agent={agent} size={20} />
                    <span class="sk-candidate-text">
                      <span class="org-strong">{agent.name}</span>
                    </span>
                  </button>
                </li>
              )}
            </For>
          </ul>
        </Show>
        <Show when={error()}>
          <p class="field-error" role="alert">
            {error()}
          </p>
        </Show>
      </div>
    </Dialog>
  );
}
