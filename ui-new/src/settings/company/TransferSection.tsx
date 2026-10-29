import type { CompanyPortabilityCollisionStrategy, CompanyPortabilityExportPreviewResult, CompanyPortabilityPreviewResult } from "@paperclipai/shared";
import type { CompanyImportTransferDeclaration } from "@paperclipai/shared/company-import-transfer";
import { useNavigate } from "@solidjs/router";
import { createQuery, useQueryClient } from "@tanstack/solid-query";
import { Download, FileArchive, Upload } from "lucide-solid";
import { createSignal, For, onCleanup, Show } from "solid-js";
import { companiesApi, type CompanyImportMeta, type CompanyImportPreviewMeta } from "@/api/companies";
import { queryKeys } from "@/api/queryKeys";
import { ConfirmDialog } from "@/documents/ConfirmDialog";
import { useCompany } from "@/lib/company";
import { Button } from "@/ui/Button";
import { SettingsRow, TextInput } from "@/ui/Field";
import { Segmented } from "@/ui/Segmented";
import { pushToast } from "@/ui/Toast";
import {
  COLLISION_OPTIONS,
  exportCounts,
  exportFileName,
  importedFiles,
  importPlanLines,
  importTarget,
  packageProblem,
  transferDeclaration,
  transferProgressLine,
  uploadTransfer,
  usesChunkedTransfer,
  type ImportTarget,
} from "./transfer-model";
import { CardHead, failure, SectionTitle, SwitchRow } from "./shared";
import { createZipArchive, downloadBytes } from "./zip";

/*
 * Import and export (board 30's outline): move an organization between Paperclip instances.
 *
 * - Export builds the company package on the server (`POST /exports/preview`, then `/exports`),
 *   with or without tasks and skills, and zips it here for download. The fidelity report says what
 *   a package never carries (approvals, cost and activity history).
 * - Import uploads a .zip package, previews what it would do, and imports it in the background
 *   (`/companies/import?async=1`, then the job's status): as a new organization, or into this one
 *   with a rule for same-named agents, projects and skills (keep both, skip, replace). A package
 *   over 48 MB goes up as a resumable transfer (`/companies/import/transfers`): content-addressed
 *   parts, so a dropped upload resumes from the parts the server already has.
 *
 * Not here: picking single files to export or import, per-agent harness overrides and secret values
 * at import, and importing from a GitHub address. The classic UI's Export and Import pages have them.
 */

export function TransferSection() {
  return (
    <>
      <SectionTitle title="Import and export">Move an organization between Paperclip instances as a company package.</SectionTitle>
      <ExportCard />
      <ImportCard />
    </>
  );
}

function ExportCard() {
  const company = useCompany();
  const [issues, setIssues] = createSignal(false);
  const [skills, setSkills] = createSignal(true);
  const [preview, setPreview] = createSignal<CompanyPortabilityExportPreviewResult | null>(null);
  const [busy, setBusy] = createSignal<"preview" | "download" | null>(null);
  const [problem, setProblem] = createSignal<string | null>(null);
  const [showFiles, setShowFiles] = createSignal(false);
  const fidelity = createQuery(() => ({
    queryKey: queryKeys.companySettings.exportFidelity(company().id),
    queryFn: ({ signal }) => companiesApi.exportFidelity(company().id, signal),
    retry: false,
  }));
  const request = () => ({ include: { company: true, agents: true, projects: true, issues: issues(), skills: skills() } });
  let controller: AbortController | undefined;
  onCleanup(() => controller?.abort());

  const runPreview = async () => {
    controller?.abort();
    controller = new AbortController();
    setBusy("preview");
    setProblem(null);
    try {
      setPreview(await companiesApi.exportPreview(company().id, request(), controller.signal));
    } catch (caught) {
      if (!(caught instanceof DOMException && caught.name === "AbortError")) setProblem(failure(caught, "Couldn't build the preview."));
    } finally {
      setBusy(null);
    }
  };
  const download = async () => {
    setBusy("download");
    setProblem(null);
    try {
      const result = await companiesApi.exportBundle(company().id, request());
      downloadBytes(createZipArchive(result.files, result.rootPath), exportFileName(result.rootPath));
      pushToast({ tone: "success", title: "Exported the organization", body: `${Object.keys(result.files).length} files in ${exportFileName(result.rootPath)}` });
    } catch (caught) {
      setProblem(failure(caught, "Couldn't build the package."));
    } finally {
      setBusy(null);
    }
  };
  const change = (set: (value: boolean) => void, value: boolean) => {
    set(value);
    setPreview(null);
  };

  return (
    <section class="card settings-card" id="export" aria-labelledby="cs-export">
      <CardHead id="cs-export" title="Export" note="Agents, projects, their instructions and settings, as markdown and YAML files in a zip. Secret values are never included." />
      <SwitchRow label="Include tasks" help="Open and closed tasks with their descriptions." checked={issues()} onChange={(value) => change(setIssues, value)} />
      <SwitchRow label="Include skills" help="The organization's skill library." checked={skills()} onChange={(value) => change(setSkills, value)} />
      <Show when={preview()}>
        {(found) => (
          <SettingsRow label="Package">
            <div class="cs-person-text">
              <span class="cs-strong">{exportCounts(found().counts)}</span>
              <For each={found().warnings}>{(warning) => <span class="fhelp">{warning}</span>}</For>
              <Button size="compact" variant="quiet" class="cs-self-start" onClick={() => setShowFiles(!showFiles())}>
                {showFiles() ? "Hide the files" : "Show the files"}
              </Button>
              <Show when={showFiles()}>
                <ul class="cs-files mono">
                  <For each={found().fileInventory}>{(file) => <li>{file.path}</li>}</For>
                </ul>
              </Show>
            </div>
          </SettingsRow>
        )}
      </Show>
      <Show when={fidelity.data?.warnings.length}>
        <SettingsRow label="Not included" help="A package never carries these.">
          <div class="cs-person-text">
            <For each={fidelity.data!.warnings}>{(warning) => <span class="cs-muted">{warning.message}</span>}</For>
          </div>
        </SettingsRow>
      </Show>
      <footer class="cfoot">
        <Button size="compact" disabled={!!busy()} onClick={() => void runPreview()}>
          {busy() === "preview" ? "Building the preview…" : "Preview"}
        </Button>
        <span class="ps-foot-end">
          <Show when={problem()}>
            <span class="nt-error ps-foot-error" role="alert">
              {problem()}
            </span>
          </Show>
          <Button size="compact" variant="primary" icon={<Download size={14} aria-hidden="true" />} disabled={!!busy()} onClick={() => void download()}>
            {busy() === "download" ? "Building the package…" : "Download .zip"}
          </Button>
        </span>
      </footer>
    </section>
  );
}

function ImportCard() {
  const company = useCompany();
  const client = useQueryClient();
  const navigate = useNavigate();
  const [file, setFile] = createSignal<File | null>(null);
  const [target, setTarget] = createSignal<ImportTarget>("new");
  const [name, setName] = createSignal("");
  const [collision, setCollision] = createSignal<CompanyPortabilityCollisionStrategy>("rename");
  const [updateDetails, setUpdateDetails] = createSignal(false);
  const [preview, setPreview] = createSignal<CompanyPortabilityPreviewResult | null>(null);
  const [busy, setBusy] = createSignal<"preview" | "import" | null>(null);
  const [problem, setProblem] = createSignal<string | null>(null);
  const [confirm, setConfirm] = createSignal(false);
  const [progress, setProgress] = createSignal<string | null>(null);
  let input!: HTMLInputElement;
  let cancelled = false;
  onCleanup(() => (cancelled = true));
  // A large zip is hashed once per file; the declaration resumes the same transfer for preview and import.
  let declared: { file: File; declaration: CompanyImportTransferDeclaration } | null = null;

  const into = () => target() === "existing";
  const previewMeta = (): CompanyImportPreviewMeta => ({
    include: { company: true, agents: true, projects: true, issues: true, skills: true },
    ...importTarget(target(), company().id, name(), collision()),
    agents: "all",
  });
  // As the old Import page does by default, recurring tasks and triggers arrive paused.
  const importMeta = (): CompanyImportMeta => ({
    ...previewMeta(),
    selectedFiles: into() && preview() ? importedFiles(preview()!, updateDetails()) : undefined,
    pauseAutomations: true,
  });
  const reset = () => {
    setPreview(null);
    setProblem(null);
  };

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
    const found = packageProblem(file());
    if (found) return setProblem(found);
    setBusy("preview");
    setProblem(null);
    try {
      const chosen = file()!;
      setPreview(
        usesChunkedTransfer(chosen)
          ? await companiesApi.importTransferPreview(await transfer(chosen), previewMeta())
          : await companiesApi.importPreviewPackage(chosen, previewMeta()),
      );
    } catch (caught) {
      setProblem(failure(caught, "Couldn't read the package."));
    } finally {
      setBusy(null);
      setProgress(null);
    }
  };

  const runImport = async () => {
    setBusy("import");
    setProblem(null);
    setProgress("Uploading the package…");
    try {
      const chosen = file()!;
      const accepted = usesChunkedTransfer(chosen)
        ? await companiesApi.importTransferApply(await transfer(chosen), importMeta())
        : await companiesApi.importPackageAsync(chosen, importMeta());
      setProgress("Importing…");
      let wait = accepted.retryAfterMs ?? 2000;
      for (;;) {
        await new Promise((resolve) => window.setTimeout(resolve, wait));
        if (cancelled) return;
        const status = await companiesApi.importJob(accepted.job.id);
        if (status.job.status === "failed") throw new Error(status.job.error?.message ?? "The import failed.");
        if (status.job.status === "succeeded") {
          if (into()) {
            // Everything in this organization may have changed.
            await client.invalidateQueries();
            pushToast({ tone: "success", title: `Imported into ${company().name}`, body: lines().slice(1).join(" · ") || undefined });
          } else {
            const companyId = status.job.result?.companyId ?? status.job.importResult?.company.id;
            await client.invalidateQueries({ queryKey: queryKeys.companies.all });
            const companies = await companiesApi.list();
            const created = companies.find((entry) => entry.id === companyId);
            pushToast({
              tone: "success",
              title: created ? `Imported ${created.name}` : "Imported the organization",
              action: created ? { label: "Open it", onClick: () => navigate(`/${created.issuePrefix}/dashboard`) } : undefined,
            });
          }
          setPreview(null);
          setFile(null);
          setName("");
          declared = null;
          return;
        }
        wait = status.retryAfterMs ?? 2000;
      }
    } catch (caught) {
      setProblem(failure(caught, "The import failed."));
    } finally {
      setBusy(null);
      setProgress(null);
    }
  };

  const lines = () => (preview() ? importPlanLines(preview()!.plan) : []);
  const errors = () => preview()?.errors ?? [];
  const confirmBody = () => {
    const what = lines().slice(1).join(", ").toLowerCase() || "the package's contents";
    return into()
      ? `This brings ${what} into ${company().name}${collision() === "replace" ? ", replacing same-named items" : ""}. Recurring tasks it adds start paused.`
      : `This creates ${preview()?.targetCompanyName ?? "a new organization"} with ${what}. Its recurring tasks start paused until you turn them on.`;
  };

  return (
    <section class="card settings-card" id="import" aria-labelledby="cs-import">
      <CardHead id="cs-import" title="Import" note="Bring in a company package as a new organization or into this one. Preview it first: nothing changes until you import." />
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
                <Show when={found().envInputs.length}>
                  <span class="fhelp">
                    {found().envInputs.length} environment variable{found().envInputs.length === 1 ? "" : "s"} will need values.
                  </span>
                </Show>
                <For each={found().warnings}>{(warning) => <span class="fhelp">{warning}</span>}</For>
                <For each={errors()}>{(error) => <span class="fhelp cs-bad">{error}</span>}</For>
              </div>
            </SettingsRow>
            <Show when={into() && found().plan.companyAction === "update"}>
              <SwitchRow
                label="Update the organization's details"
                help="Take the package's name, description and settings for this organization. Off: only its agents, projects, tasks and skills come in."
                checked={updateDetails()}
                onChange={setUpdateDetails}
              />
            </Show>
          </>
        )}
      </Show>
      <footer class="cfoot">
        <Button size="compact" disabled={!file() || !!busy()} onClick={() => void runPreview()}>
          {busy() === "preview" ? "Reading the package…" : "Preview"}
        </Button>
        <Show when={progress()}>
          <span class="cs-muted" role="status">
            {progress()}
          </span>
        </Show>
        <span class="ps-foot-end">
          <Show when={problem()}>
            <span class="nt-error ps-foot-error" role="alert">
              {problem()}
            </span>
          </Show>
          <Button
            size="compact"
            variant="primary"
            icon={<Upload size={14} aria-hidden="true" />}
            disabled={!preview() || errors().length > 0 || !!busy()}
            onClick={() => setConfirm(true)}
          >
            {into() ? `Import into ${company().name}` : "Import as a new organization"}
          </Button>
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

