import type { CompanySkillDetail, CompanySkillVersion, CompanySkillVersionSummary } from "@paperclipai/shared";
import type { skillsApi } from "@/api/skills";

/*
 * Restoring an earlier version of a skill in the Studio, as the old Studio does
 * (ui/src/pages/SkillStudio.tsx, `restore`):
 *
 * - A Paperclip-managed skill (source type `managed`) restores in one call: `POST …/versions` with
 *   `sourceVersionId` (the version to restore) and `expectedVersionId` (the version on screen, so a
 *   change made elsewhere meanwhile is refused with 409 instead of overwritten). The new version
 *   holds exactly the restored version's files, so files added since are removed.
 * - Any other editable skill (a linked local folder) can't restore on the server, so its files are
 *   written back one by one, each save expecting the version the last one made, and the result is
 *   saved as a version. Files added since stay.
 */

type RestoreApi = Pick<typeof skillsApi, "version" | "saveFile" | "createVersion">;
type RestoreSkill = Pick<CompanySkillDetail, "id" | "sourceType" | "currentVersionId">;
type RestoreTarget = Pick<CompanySkillVersionSummary, "id" | "revisionNumber">;

/** Whether restoring replaces the skill's files outright (managed) or writes them back over it. */
export function restoreReplacesFiles(skill: Pick<CompanySkillDetail, "sourceType">) {
  return skill.sourceType === "managed";
}

export async function restoreSkillVersion(
  api: RestoreApi,
  companyId: string,
  skill: RestoreSkill,
  version: RestoreTarget,
): Promise<CompanySkillVersion> {
  const label = `Restore of v${version.revisionNumber}`;
  if (restoreReplacesFiles(skill)) {
    return api.createVersion(companyId, skill.id, label, { sourceVersionId: version.id, expectedVersionId: skill.currentVersionId });
  }
  // The versions list names the files only; read the version for their contents.
  const full = await api.version(companyId, skill.id, version.id);
  let expectedVersionId = skill.currentVersionId;
  for (const entry of full.fileInventory) {
    const saved = await api.saveFile(companyId, skill.id, entry.path, entry.content, {
      encoding: entry.encoding,
      executable: entry.executable ?? false,
      expectedVersionId,
    });
    expectedVersionId = saved.versionId ?? expectedVersionId;
  }
  return api.createVersion(companyId, skill.id, label, { expectedVersionId });
}
