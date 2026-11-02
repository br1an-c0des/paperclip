import type { CompanyPortabilityCollisionStrategy, CompanyPortabilityEnvInput, CompanyPortabilityPreviewResult } from "@paperclipai/shared";
import type { CompanyImportTransferDeclaration } from "@paperclipai/shared/company-import-transfer";
import { useNavigate } from "@solidjs/router";
import { createQuery, useQueryClient } from "@tanstack/solid-query";
import { ChevronRight, FileArchive, Upload } from "lucide-solid";
import { createEffect, createMemo, createSignal, For, onCleanup, onMount, Show } from "solid-js";
import { createStore } from "solid-js/store";
import { agentsApi } from "@/api/agents";
import { companiesApi, type CompanyImportJobAccepted, type CompanyImportJobStatus, type CompanyImportMeta, type CompanyImportPreviewMeta } from "@/api/companies";
import { queryKeys } from "@/api/queryKeys";
import { harnessType } from "@/agents/agent-model";
import { ConfirmDialog } from "@/documents/ConfirmDialog";
import { useCompany } from "@/lib/company";
import { useAgentsQuery } from "@/lib/company-data";
import { Button } from "@/ui/Button";
import { SettingsRow, TextInput } from "@/ui/Field";
import { Segmented } from "@/ui/Segmented";
import { pushToast } from "@/ui/Toast";
import {
  adapterOverrides,
  clearImportJob,
  companyFilePath,
  defaultCheckedFiles,
  effectiveHarness,
  envInputKey,
  envInputScope,
  fileGroups,
  githubAddress,
  githubLabel,
  githubProblem,
  harnessNeedsModel,
  importAgents,
  importEnvInputs,
  importHarnessChoices,
  initialEnvValues,
  missingRequired,
  pollDelay,
  readImportJob,
  runningJobFrom,
  secretValuesPayload,
  selectedFilesPayload,
  storeImportJob,
  watchImportJob,
  type ImportAgent,
  type StoredImportJob,
} from "./import-model";
import { CardHead, failure, SwitchRow } from "./shared";
import { COLLISION_OPTIONS, importPlanLines, importTarget, packageProblem, transferDeclaration, transferProgressLine, uploadTransfer, usesChunkedTransfer, type ImportTarget } from "./transfer-model";

/*
 * Import (board 30's outline): bring in a company package as a new organization or into this one.
 *
 * The package is an uploaded .zip (a resumable transfer over 48 MB) or a GitHub address the server
 * reads. Preview first; nothing changes until the import runs. The preview then offers what the old
 * Import page did: which files come in, each agent's harness (kept, or moved to one installed
 * here), and values for the package's environment inputs (secret ones become company secrets).
 * Same-named agents, projects and skills follow one rule (keep both, skip, replace); the old page's
 * per-item renames aren't here.
 *
 * The import runs as a background job. Its id is kept for the session, so a reload, or coming back
 * to this page, picks the job up again instead of showing an empty form (import-model.ts). A second
 * import while one is running watches the running one (the server answers 409 with it).
 */

type Source = "zip" | "github";

export function ImportCard() {
  const company = useCompany();
  const client = useQueryClient();
  const navigate = useNavigate();
  const [source, setSource] = createSignal<Source>("zip");
  const [file, setFile] = createSignal<File | null>(null);
  const [address, setAddress] = createSignal("");
  const [target, setTarget] = createSignal<ImportTarget>("new");
  const [name, setName] = createSignal("");
  const [collision, setCollision] = createSignal<CompanyPortabilityCollisionStrategy>("rename");
  const [preview, setPreview] = createSignal<CompanyPortabilityPreviewResult | null>(null);
  const [checked, setChecked] = createSignal<ReadonlySet<string>>(new Set());
  const [picks, setPicks] = createStore<Record<string, string | undefined>>({});
  const [models, setModels] = createStore<Record<string, string | undefined>>({});
  const [values, setValues] = createStore<Record<string, string>>({});
  const [busy, setBusy] = createSignal<"preview" | "import" | null>(null);
  const [problem, setProblem] = createSignal<string | null>(null);
  const [confirm, setConfirm] = createSignal(false);
  const [progress, setProgress] = createSignal<string | null>(null);
  // A job started before a reload (or before leaving the page) that's still being watched.
  const [resumed, setResumed] = createSignal<StoredImportJob | null>(null);
  let input!: HTMLInputElement;
  let stopped = false;
  onCleanup(() => (stopped = true));
  // A large zip is hashed once per file; the declaration resumes the same transfer for preview and import.
  let declared: { file: File; declaration: CompanyImportTransferDeclaration } | null = null;

  const adapters = createQuery(() => ({
    queryKey: queryKeys.agents.adapters(company().id, null),
    queryFn: ({ signal }) => agentsApi.adapters(company().id, null, signal),
    enabled: preview() !== null,
    retry: false,
    staleTime: 60_000,
  }));
  const agents = useAgentsQuery();
  const ceoHarness = () => {
    const ceo = agents.data?.find((agent) => agent.role === "ceo");
    return ceo ? harnessType(ceo.adapterType, (ceo.adapterConfig ?? {}) as Record<string, unknown>) : null;
  };

  const into = () => target() === "existing";
  const allFiles = createMemo(() => Object.keys(preview()?.files ?? {}));
  const importing = createMemo(() => (preview() ? importAgents(preview()!, adapters.data, ceoHarness()) : []));
  const inputs = createMemo(() => (preview() ? importEnvInputs(preview()!) : []));
  const unfilled = createMemo(() => missingRequired(inputs(), values));
  const needsModel = createMemo(() => importing().filter((agent) => harnessNeedsModel(effectiveHarness(agent, picks[agent.slug])) && effectiveHarness(agent, picks[agent.slug]) !== agent.harness && !models[agent.slug]?.trim()));
  const label = () => (source() === "zip" ? (file()?.name ?? "the package") : githubLabel(address()));

  const previewMeta = (): CompanyImportPreviewMeta => ({
    include: { company: true, agents: true, projects: true, issues: true, skills: true },
    ...importTarget(target(), company().id, name(), collision()),
    agents: "all",
  });
  // As the old Import page does by default, recurring tasks and triggers arrive paused.
  const importMeta = (): CompanyImportMeta => ({
    ...previewMeta(),
    selectedFiles: selectedFilesPayload(checked(), allFiles()),
    adapterOverrides: adapterOverrides(importing(), picks, models),
    secretValues: secretValuesPayload(inputs(), values),
    pauseAutomations: true,
  });
  const reset = () => {
    setPreview(null);
    setProblem(null);
  };
  const sourceProblem = () => (source() === "zip" ? packageProblem(file()) : githubProblem(address()));

  /** Uploads (or resumes) a large package's transfer and returns its id. */
  const transfer = async (chosen: File) => {
    if (declared?.file !== chosen) {
      setProgress("Reading the package…");
      declared = { file: chosen, declaration: await transferDeclaration(await chosen.arrayBuffer()) };
    }
    return uploadTransfer(chosen, declared.declaration, { create: companiesApi.importTransferCreate, upload: companiesApi.importTransferUploadPart }, (step) =>
      setProgress(`${transferProgressLine(step)} An interrupted upload picks up from the parts already sent.`),
    );
  };

  const runPreview = async () => {
    const found = sourceProblem();
    if (found) return setProblem(found);
    setBusy("preview");
    setProblem(null);
    try {
      let result: CompanyPortabilityPreviewResult;
      if (source() === "github") {
        setProgress("Reading the repository…");
        result = await companiesApi.importPreview({ source: { type: "github", url: githubAddress(address()) }, ...previewMeta() });
      } else {
        const chosen = file()!;
        result = usesChunkedTransfer(chosen)
          ? await companiesApi.importTransferPreview(await transfer(chosen), previewMeta())
          : await companiesApi.importPreviewPackage(chosen, previewMeta());
      }
      setPreview(result);
      setChecked(defaultCheckedFiles(result, into()));
      setPicks({});
      setModels({});
      setValues(initialEnvValues(importEnvInputs(result)));
    } catch (caught) {
      setProblem(failure(caught, source() === "github" ? "Couldn't read the repository." : "Couldn't read the package."));
    } finally {
      setBusy(null);
      setProgress(null);
    }
  };

  /** Watches a job to the end, then says what landed; used for new imports and resumed ones. */
  const follow = async (job: StoredImportJob, accepted?: CompanyImportJobAccepted) => {
    setProgress(`Importing ${job.label}… It keeps running if you leave or reload this page.`);
    try {
      const done = await watchImportJob(job.jobId, { get: companiesApi.importJob, wait: pollDelay, stopped: () => stopped }, accepted?.retryAfterMs ?? 2000);
      if (!done) return;
      clearImportJob(company().id);
      await finished(done, job);
    } catch (caught) {
      clearImportJob(company().id);
      throw caught;
    }
  };

  const finished = async (job: CompanyImportJobStatus["job"], stored: StoredImportJob) => {
    const result = job.importResult;
    const companyId = job.result?.companyId ?? result?.company.id;
    if (stored.target === "existing" && companyId === company().id) {
      // Everything in this organization may have changed.
      await client.invalidateQueries();
      const parts = result ? [`${result.agents.filter((agent) => agent.action !== "skipped").length} agents`, `${result.projects.filter((project) => project.action !== "skipped").length} projects`] : [];
      pushToast({ tone: "success", title: `Imported into ${company().name}`, body: [...parts, result?.warnings.length ? `${result.warnings.length} warnings` : null].filter(Boolean).join(" · ") || undefined });
      return;
    }
    await client.invalidateQueries({ queryKey: queryKeys.companies.all });
    const companies = await companiesApi.list();
    const created = companies.find((entry) => entry.id === companyId);
    pushToast({
      tone: "success",
      title: created ? `Imported ${created.name}` : "Imported the organization",
      body: "Its agents and recurring tasks start paused.",
      action: created ? { label: "Open it", onClick: () => navigate(`/${created.issuePrefix}/dashboard`) } : undefined,
    });
  };

  const runImport = async () => {
    setBusy("import");
    setProblem(null);
    setProgress("Uploading the package…");
    const job: Omit<StoredImportJob, "jobId"> = { label: label(), target: target() };
    try {
      let accepted: CompanyImportJobAccepted;
      try {
        if (source() === "github") {
          accepted = await companiesApi.importAsync({ source: { type: "github", url: githubAddress(address()) }, ...importMeta() });
        } else {
          const chosen = file()!;
          accepted = usesChunkedTransfer(chosen)
            ? await companiesApi.importTransferApply(await transfer(chosen), importMeta())
            : await companiesApi.importPackageAsync(chosen, importMeta());
        }
      } catch (caught) {
        // Your earlier import is still running: watch that one rather than start another.
        const running = runningJobFrom(caught);
        if (!running) throw caught;
        accepted = running;
        pushToast({ tone: "info", title: "An import is already running", body: "Following it; start this one when it's done." });
      }
      const stored = { ...job, jobId: accepted.job.id };
      storeImportJob(company().id, stored);
      await follow(stored, accepted);
      if (stopped) return;
      setPreview(null);
      setFile(null);
      setAddress("");
      setName("");
      declared = null;
    } catch (caught) {
      setProblem(failure(caught, "The import failed."));
    } finally {
      setBusy(null);
      setProgress(null);
    }
  };

  // Pick up a job a reload interrupted: the server kept running it.
  onMount(() => {
    const stored = readImportJob(company().id);
    if (!stored) return;
    setResumed(stored);
    setBusy("import");
    void follow(stored)
      .catch((caught) => setProblem(failure(caught, "The import failed.")))
      .finally(() => {
        setResumed(null);
        setBusy(null);
        setProgress(null);
      });
  });

  const lines = () => (preview() ? importPlanLines(preview()!.plan) : []);
  const errors = () => preview()?.errors ?? [];
  const blocked = () =>
    !preview() || errors().length > 0 || !!busy() || checked().size === 0 || unfilled().length > 0 || needsModel().length > 0;
  const blockReason = () => {
    if (!preview() || busy()) return null;
    if (checked().size === 0) return "Pick at least one file.";
    if (unfilled().length) return `Fill in ${unfilled().length === 1 ? unfilled()[0]!.key : `${unfilled().length} required values`}.`;
    if (needsModel().length) return `Give ${needsModel()[0]!.name} a model for OpenCode.`;
    return null;
  };
  const companyFile = () => (preview() ? companyFilePath(preview()!) : null);
  const updateDetails = () => !!companyFile() && checked().has(companyFile()!);
  const setUpdateDetails = (on: boolean) => {
    const path = companyFile();
    if (!path) return;
    setChecked((current) => {
      const next = new Set(current);
      if (on) next.add(path);
      else next.delete(path);
      return next;
    });
  };
  const confirmBody = () => {
    const what = lines().slice(1).join(", ").toLowerCase() || "the package's contents";
    const secrets = inputs().filter((entry) => entry.kind === "secret" && values[envInputKey(entry)]?.trim()).length;
    const extra = secrets ? ` ${secrets === 1 ? "One value is" : `${secrets} values are`} stored as new secrets.` : "";
    return into()
      ? `This brings ${what} into ${company().name}${collision() === "replace" ? ", replacing same-named items" : ""}. Recurring tasks it adds start paused.${extra}`
      : `This creates ${preview()?.targetCompanyName ?? "a new organization"} with ${what}. Its recurring tasks start paused until you turn them on.${extra}`;
  };

  return (
    <section class="card settings-card" id="import" aria-labelledby="cs-import">
      <CardHead id="cs-import" title="Import" note="Bring in a company package as a new organization or into this one. Preview it first: nothing changes until you import." />
      <Show
        when={!resumed()}
        fallback={
          <SettingsRow label="Running import" help="Started before this page was reloaded. It runs on the server; this page follows it.">
            <div class="cs-person-text">
              <span class="cs-strong">{resumed()!.label}</span>
              <span class="cs-muted">{resumed()!.target === "existing" ? `Into ${company().name}` : "As a new organization"}</span>
            </div>
          </SettingsRow>
        }
      >
        <SettingsRow label="From">
          <Segmented
            label="Import from"
            options={[
              { value: "zip", label: "A .zip file" },
              { value: "github", label: "GitHub" },
            ]}
            value={source()}
            onChange={(value) => {
              if (busy()) return;
              setSource(value);
              reset();
            }}
          />
        </SettingsRow>
        <Show
          when={source() === "github"}
          fallback={
            <SettingsRow label="Package" help="A .zip exported from Paperclip, or any agentcompanies/v1 package. Large ones upload in resumable parts.">
              <div class="cs-inline">
                <input
                  ref={input}
                  type="file"
                  class="sr-only"
                  accept=".zip,application/zip"
                  aria-label="Company package"
                  onChange={(event) => {
                    setFile(event.currentTarget.files?.[0] ?? null);
                    event.currentTarget.value = "";
                    reset();
                  }}
                />
                <Button size="compact" icon={<FileArchive size={14} aria-hidden="true" />} disabled={!!busy()} onClick={() => input.click()}>
                  {file() ? "Choose another" : "Choose a .zip"}
                </Button>
                <Show when={file()}>{(chosen) => <span class="cs-muted mono cs-ellipsis">{chosen().name}</span>}</Show>
              </div>
            </SettingsRow>
          }
        >
          <SettingsRow
            label="GitHub address"
            for="cs-import-github"
            help="A repository, a folder in it (…/tree/main/company) or its COMPANY.md (…/blob/main/COMPANY.md). Private repositories need a GitHub connection under Apps."
          >
            <TextInput
              id="cs-import-github"
              class="mono"
              placeholder="https://github.com/owner/repo/tree/main/company"
              value={address()}
              disabled={!!busy()}
              invalid={!!address().trim() && !!githubProblem(address())}
              onInput={(event) => {
                setAddress(event.currentTarget.value);
                reset();
              }}
              onKeyDown={(event) => event.key === "Enter" && !busy() && void runPreview()}
            />
            <Show when={address().trim() && githubProblem(address())}>
              <span class="field-error">{githubProblem(address())}</span>
            </Show>
          </SettingsRow>
        </Show>
        <SettingsRow label="Import into">
          <Segmented
            label="Import into"
            options={[
              { value: "new", label: "A new organization" },
              { value: "existing", label: company().name },
            ]}
            value={target()}
            onChange={(value) => {
              if (busy()) return;
              setTarget(value);
              reset();
            }}
          />
        </SettingsRow>
        <Show
          when={into()}
          fallback={
            <SettingsRow label="New organization's name" for="cs-import-name" help="Optional. The package's own name is used otherwise.">
              <TextInput
                id="cs-import-name"
                value={name()}
                disabled={!!busy()}
                onInput={(event) => {
                  setName(event.currentTarget.value);
                  setPreview(null);
                }}
              />
            </SettingsRow>
          }
        >
          <SettingsRow label="Same names" help={COLLISION_OPTIONS.find((option) => option.value === collision())?.help}>
            <Segmented
              label="When an agent, project or skill has the same name"
              options={COLLISION_OPTIONS}
              value={collision()}
              onChange={(value) => {
                if (busy()) return;
                setCollision(value);
                reset();
              }}
            />
          </SettingsRow>
        </Show>
        <Show when={preview()}>
          {(found) => (
            <>
              <SettingsRow label="What it does">
                <div class="cs-person-text">
                  <span class="cs-strong">{into() ? company().name : (found().targetCompanyName ?? found().manifest.company?.name ?? "New organization")}</span>
                  <For each={lines()}>{(line) => <span class="cs-muted">{line}</span>}</For>
                  <For each={found().warnings}>{(warning) => <span class="fhelp">{warning}</span>}</For>
                  <For each={errors()}>{(error) => <span class="fhelp cs-bad">{error}</span>}</For>
                </div>
              </SettingsRow>
              <Show when={into() && found().plan.companyAction === "update" && companyFile()}>
                <SwitchRow
                  label="Update the organization's details"
                  help="Take the package's name, description and settings for this organization. Off: only its agents, projects, tasks and skills come in."
                  checked={updateDetails()}
                  onChange={setUpdateDetails}
                />
              </Show>
              <ImportFiles paths={allFiles()} checked={checked()} onChange={setChecked} disabled={!!busy()} />
              <Show when={importing().length > 0}>
                <ImportHarnesses
                  agents={importing()}
                  choices={importHarnessChoices(adapters.data)}
                  loading={adapters.isPending}
                  picks={picks}
                  models={models}
                  disabled={!!busy()}
                  onPick={(slug, harness) => setPicks(slug, harness)}
                  onModel={(slug, model) => setModels(slug, model)}
                />
              </Show>
              <Show when={inputs().length > 0}>
                <ImportValues
                  inputs={inputs()}
                  values={values}
                  names={{
                    agents: Object.fromEntries(found().manifest.agents.map((agent) => [agent.slug, agent.name])),
                    projects: Object.fromEntries(found().manifest.projects.map((project) => [project.slug, project.name])),
                  }}
                  organization={into() ? company().name : "the new organization"}
                  disabled={!!busy()}
                  onChange={(key, value) => setValues(key, value)}
                />
              </Show>
            </>
          )}
        </Show>
      </Show>
      <footer class="cfoot">
        <Show when={!resumed()}>
          <Button size="compact" disabled={!!sourceProblem() || !!busy()} onClick={() => void runPreview()}>
            {busy() === "preview" ? (source() === "github" ? "Reading the repository…" : "Reading the package…") : "Preview"}
          </Button>
        </Show>
        <Show when={progress()}>
          <span class="cs-muted" role="status">
            {progress()}
          </span>
        </Show>
        <span class="ps-foot-end">
          <Show when={problem() ?? blockReason()}>
            <span class="nt-error ps-foot-error" role={problem() ? "alert" : undefined}>
              {problem() ?? blockReason()}
            </span>
          </Show>
          <Show when={!resumed()}>
            <Button size="compact" variant="primary" icon={<Upload size={14} aria-hidden="true" />} disabled={blocked()} onClick={() => setConfirm(true)}>
              {into() ? `Import into ${company().name}` : "Import as a new organization"}
            </Button>
          </Show>
        </span>
      </footer>
      <ConfirmDialog
        open={confirm()}
        onOpenChange={setConfirm}
        title={into() ? `Import into ${company().name}?` : "Import as a new organization?"}
        body={confirmBody()}
        confirmLabel="Import"
        danger={into() && collision() === "replace"}
        onConfirm={() => void runImport()}
      />
    </section>
  );
}

/** Which of the package's files come in, by top folder; each folder opens to its files. */
function ImportFiles(props: { paths: readonly string[]; checked: ReadonlySet<string>; onChange: (next: ReadonlySet<string>) => void; disabled: boolean }) {
  const groups = createMemo(() => fileGroups(props.paths));
  const [open, setOpen] = createSignal(false);
  const [expanded, setExpanded] = createSignal<ReadonlySet<string>>(new Set());
  const count = (paths: readonly string[]) => paths.filter((path) => props.checked.has(path)).length;
  const set = (paths: readonly string[], on: boolean) => {
    const next = new Set(props.checked);
    for (const path of paths) {
      if (on) next.add(path);
      else next.delete(path);
    }
    props.onChange(next);
  };
  const toggleOpen = (key: string) =>
    setExpanded((current) => {
      const next = new Set(current);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });

  return (
    <SettingsRow label="Files" help="Leave out files you don't want: an agent, a project, a skill or tasks.">
      <div class="cs-person-text">
        <span class="cs-strong">
          {count(props.paths) === props.paths.length ? `All ${props.paths.length} files` : `${count(props.paths)} of ${props.paths.length} files`}
        </span>
        <Button size="compact" variant="quiet" class="cs-self-start" aria-expanded={open()} onClick={() => setOpen(!open())}>
          {open() ? "Hide the files" : "Choose files"}
        </Button>
        <Show when={open()}>
          <div class="cs-import-list" role="list" aria-label="Package files">
            <For each={groups()}>
              {(group) => {
                const picked = () => count(group.paths);
                return (
                  <div class="cs-import-row" role="listitem">
                    <div class="cs-inline">
                      <label class="cs-import-pick cs-grow">
                        <input
                          type="checkbox"
                          disabled={props.disabled}
                          checked={picked() === group.paths.length}
                          ref={(element) => createEffect(() => (element.indeterminate = picked() > 0 && picked() < group.paths.length))}
                          onChange={(event) => set(group.paths, event.currentTarget.checked)}
                        />
                        <span class="cs-person-text">
                          <span class="cs-strong mono">{group.label}</span>
                          <span class="cs-muted">
                            {picked()} of {group.paths.length}
                          </span>
                        </span>
                      </label>
                      <Show when={group.paths.length > 1 || group.key === ""}>
                        <Button
                          size="compact"
                          variant="icon"
                          ghost
                          class="cs-disclose"
                          classList={{ "cs-disclose--open": expanded().has(group.key) }}
                          aria-expanded={expanded().has(group.key)}
                          aria-label={`${expanded().has(group.key) ? "Hide" : "Show"} the files in ${group.label}`}
                          icon={<ChevronRight size={14} aria-hidden="true" />}
                          onClick={() => toggleOpen(group.key)}
                        />
                      </Show>
                    </div>
                    <Show when={expanded().has(group.key)}>
                      <div class="cs-import-files">
                        <For each={group.paths}>
                          {(path) => (
                            <label class="cs-import-pick">
                              <input type="checkbox" disabled={props.disabled} checked={props.checked.has(path)} onChange={(event) => set([path], event.currentTarget.checked)} />
                              <span class="mono cs-ellipsis" title={path}>
                                {group.key ? path.slice(group.key.length + 1) : path}
                              </span>
                            </label>
                          )}
                        </For>
                      </div>
                    </Show>
                  </div>
                );
              }}
            </For>
          </div>
        </Show>
      </div>
    </SettingsRow>
  );
}

/** Each imported agent's harness: kept as packaged, or moved to one installed here. */
function ImportHarnesses(props: {
  agents: readonly ImportAgent[];
  choices: readonly { type: string; label: string }[];
  loading: boolean;
  picks: Readonly<Record<string, string | undefined>>;
  models: Readonly<Record<string, string | undefined>>;
  disabled: boolean;
  onPick: (slug: string, harness: string) => void;
  onModel: (slug: string, model: string) => void;
}) {
  return (
    <SettingsRow label="Harnesses" help="What each agent runs in. Moving one keeps its instructions, variables and timeouts; its harness settings start fresh.">
      <div class="cs-import-list" role="list" aria-label="Agents' harnesses">
        <For each={props.agents}>
          {(agent) => {
            const current = () => effectiveHarness(agent, props.picks[agent.slug]);
            const ownOffered = () => props.choices.some((choice) => choice.type === agent.harness);
            return (
              <div class="cs-import-row" role="listitem">
                <div class="cs-harness-row">
                  <span class="cs-person-text">
                    <span class="cs-strong cs-ellipsis">{agent.name}</span>
                    <span class="cs-muted">Packaged with {agent.harnessLabel}</span>
                  </span>
                  <select
                    class="input cs-field-200"
                    aria-label={`Harness for ${agent.name}`}
                    value={current()}
                    disabled={props.disabled || props.loading}
                    onChange={(event) => props.onPick(agent.slug, event.currentTarget.value)}
                  >
                    <Show when={!ownOffered()}>
                      <option value={agent.harness} disabled={agent.missing === true && agent.adapterType === agent.harness}>
                        {agent.harnessLabel}
                        {agent.missing ? " (not installed here)" : ""}
                      </option>
                    </Show>
                    <For each={props.choices}>{(choice) => <option value={choice.type}>{choice.label}</option>}</For>
                  </select>
                </div>
                <Show when={agent.missing && current() !== agent.harness}>
                  <span class="fhelp">{agent.harnessLabel} isn't installed here, so it comes in on {props.choices.find((choice) => choice.type === current())?.label ?? current()}.</span>
                </Show>
                <Show when={agent.missing && current() === agent.harness && agent.adapterType !== agent.harness}>
                  <span class="fhelp">The Paperclip Runner isn't available here; it runs {agent.harnessLabel} the usual way.</span>
                </Show>
                <Show when={agent.missing && !agent.fallback && props.choices.length === 0}>
                  <span class="fhelp cs-bad">No harness is installed here. Install one under App settings → Harnesses.</span>
                </Show>
                <Show when={current() !== agent.harness}>
                  <TextInput
                    class="mono"
                    aria-label={`Model for ${agent.name}`}
                    placeholder={harnessNeedsModel(current()) ? "Model (required), such as anthropic/claude-sonnet-4-5" : "Model (optional; the harness's default otherwise)"}
                    value={props.models[agent.slug] ?? ""}
                    disabled={props.disabled}
                    onInput={(event) => props.onModel(agent.slug, event.currentTarget.value)}
                  />
                </Show>
              </div>
            );
          }}
        </For>
      </div>
    </SettingsRow>
  );
}

/** The package's environment inputs: secret ones become company secrets, plain ones go into settings. */
function ImportValues(props: {
  inputs: readonly CompanyPortabilityEnvInput[];
  values: Readonly<Record<string, string>>;
  names: { agents: Record<string, string>; projects: Record<string, string> };
  organization: string;
  disabled: boolean;
  onChange: (key: string, value: string) => void;
}) {
  return (
    <SettingsRow label="Values it needs" help={`Secret values are stored as new secrets in ${props.organization}; plain ones are written into the agent or project. Optional ones can be filled in later.`}>
      <div class="cs-import-list" role="list" aria-label="Environment values">
        <For each={props.inputs}>
          {(input) => {
            const key = envInputKey(input);
            const id = `cs-import-value-${key.replace(/[^a-z0-9]+/gi, "-")}`;
            return (
              <div class="cs-import-row" role="listitem">
                <label class="cs-person-text" for={id}>
                  <span class="cs-strong mono">
                    {input.key}
                    <span class="cs-pill">{input.requirement === "required" ? "Required" : "Optional"}</span>
                    <Show when={input.kind === "secret"}>
                      <span class="cs-pill">Secret</span>
                    </Show>
                  </span>
                  <span class="cs-muted">
                    {envInputScope(input, props.names)}
                    {input.description ? ` · ${input.description}` : ""}
                    {input.portability === "system_dependent" ? " · depends on this machine" : ""}
                  </span>
                </label>
                <TextInput
                  id={id}
                  type={input.kind === "secret" ? "password" : "text"}
                  autocomplete={input.kind === "secret" ? "new-password" : "off"}
                  class={input.kind === "plain" ? "mono" : undefined}
                  value={props.values[key] ?? ""}
                  disabled={props.disabled}
                  onInput={(event) => props.onChange(key, event.currentTarget.value)}
                />
              </div>
            );
          }}
        </For>
      </div>
    </SettingsRow>
  );
}

