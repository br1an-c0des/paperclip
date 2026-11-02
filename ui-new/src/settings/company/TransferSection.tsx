import type { CompanyPortabilityExportPreviewResult } from "@paperclipai/shared";
import { createQuery } from "@tanstack/solid-query";
import { Download } from "lucide-solid";
import { createSignal, For, onCleanup, Show } from "solid-js";
import { companiesApi } from "@/api/companies";
import { queryKeys } from "@/api/queryKeys";
import { useCompany } from "@/lib/company";
import { Button } from "@/ui/Button";
import { SettingsRow } from "@/ui/Field";
import { pushToast } from "@/ui/Toast";
import { ImportCard } from "./ImportCard";
import { exportCounts, exportFileName } from "./transfer-model";
import { CardHead, failure, SectionTitle, SwitchRow } from "./shared";
import { createZipArchive, downloadBytes } from "./zip";

/*
 * Import and export (board 30's outline): move an organization between Paperclip instances.
 *
 * - Export builds the company package on the server (`POST /exports/preview`, then `/exports`),
 *   with or without tasks and skills, and zips it here for download. The fidelity report says what
 *   a package never carries (approvals, cost and activity history).
 * - Import (ImportCard.tsx) previews a .zip or a GitHub address and imports it in the background
 *   (`/companies/import?async=1`, then the job's status): as a new organization, or into this one
 *   with a rule for same-named agents, projects and skills (keep both, skip, replace), with the
 *   files, harnesses and environment values it asks for. A package over 48 MB goes up as a
 *   resumable transfer (`/companies/import/transfers`).
 *
 * Not here: picking single files to export (the old Export page rewrites the package's
 * `.paperclip.yaml` in the browser to match a pick), and renaming or skipping one same-named item
 * at a time on import.
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
