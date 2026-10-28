import type { CompanyPortabilityExportPreviewResult, CompanyPortabilityPreviewResult } from "@paperclipai/shared";

/*
 * Import and export (board 30's outline): move an organization between Paperclip instances as a
 * company package (a zip of markdown and YAML files).
 */

function plural(count: number, one: string, many: string) {
  return `${count} ${count === 1 ? one : many}`;
}

/** "3 agents · 2 projects · 14 tasks · 5 skills · 41 files". */
export function exportCounts(counts: CompanyPortabilityExportPreviewResult["counts"]) {
  return [
    plural(counts.agents, "agent", "agents"),
    plural(counts.projects, "project", "projects"),
    plural(counts.issues, "task", "tasks"),
    plural(counts.skills, "skill", "skills"),
    plural(counts.files, "file", "files"),
  ].join(" · ");
}

/** What an import would do, line by line: "Creates 3 agents", "Skips 1 project"… */
export function importPlanLines(plan: CompanyPortabilityPreviewResult["plan"]) {
  const lines: string[] = [];
  if (plan.companyAction === "create") lines.push("Creates a new organization");
  if (plan.companyAction === "update") lines.push("Updates the organization's details");
  const tally = (items: readonly { action: string }[], one: string, many: string) => {
    const counts = new Map<string, number>();
    for (const item of items) counts.set(item.action, (counts.get(item.action) ?? 0) + 1);
    for (const [action, count] of counts) {
      const verb = action === "create" ? "Creates" : action === "update" ? "Updates" : "Skips";
      lines.push(`${verb} ${plural(count, one, many)}`);
    }
  };
  tally(plan.agentPlans, "agent", "agents");
  tally(plan.projectPlans, "project", "projects");
  tally(plan.issuePlans, "task", "tasks");
  return lines;
}

/** A package file must be a zip. */
export function packageProblem(file: File | null | undefined): string | null {
  if (!file) return "Choose a .zip package.";
  if (!/\.zip$/i.test(file.name) && file.type !== "application/zip" && file.type !== "application/x-zip-compressed") return "Choose a .zip package.";
  return null;
}

/** The download's file name: the package's root folder. */
export function exportFileName(rootPath: string) {
  const base = rootPath.replace(/[\\/]+$/, "").split(/[\\/]/).pop() || "company";
  return `${base}.zip`;
}
