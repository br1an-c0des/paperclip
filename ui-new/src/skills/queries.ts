import { createQuery, useQueryClient } from "@tanstack/solid-query";
import { queryKeys } from "@/api/queryKeys";
import { skillsApi } from "@/api/skills";
import { useCompany } from "@/lib/company";

/*
 * The Skills pages' queries. The library list is shared by the Library, the Studio and the source
 * pages; a skill's detail, versions and files sit under its id. The live events don't announce
 * skill changes, so the pages refresh these themselves after each change (`refreshSkills`).
 */

export function useSkillList() {
  const company = useCompany();
  return createQuery(() => ({
    queryKey: queryKeys.skills.list(company().id),
    queryFn: ({ signal }) => skillsApi.list(company().id, signal),
    staleTime: 30_000,
  }));
}

export function useSkillDetail(skillId: () => string | null) {
  const company = useCompany();
  return createQuery(() => ({
    queryKey: queryKeys.skills.detail(company().id, skillId() ?? ""),
    queryFn: ({ signal }) => skillsApi.detail(company().id, skillId()!, signal),
    enabled: skillId() !== null,
  }));
}

export function useSkillVersions(skillId: () => string | null) {
  const company = useCompany();
  return createQuery(() => ({
    queryKey: queryKeys.skills.versions(company().id, skillId() ?? ""),
    queryFn: ({ signal }) => skillsApi.versions(company().id, skillId()!, signal),
    enabled: skillId() !== null,
  }));
}

export function useSkillFile(skillId: () => string | null, path: () => string | null) {
  const company = useCompany();
  return createQuery(() => ({
    queryKey: queryKeys.skills.file(company().id, skillId() ?? "", path() ?? ""),
    queryFn: ({ signal }) => skillsApi.file(company().id, skillId()!, path()!, signal),
    enabled: skillId() !== null && path() !== null,
  }));
}

/** The library's folders, with how many skills each holds. */
export function useSkillFolders() {
  const company = useCompany();
  return createQuery(() => ({
    queryKey: queryKeys.skills.folders(company().id),
    queryFn: ({ signal }) => skillsApi.folders(company().id, signal),
    staleTime: 30_000,
  }));
}

/** Paperclip's skill catalog; it only changes with a Paperclip upgrade. */
export function useSkillCatalog() {
  return createQuery(() => ({
    queryKey: queryKeys.skills.catalog,
    queryFn: ({ signal }) => skillsApi.catalog(signal),
    staleTime: 5 * 60_000,
  }));
}

/** Whether an imported or catalog skill's origin has a newer version. Asked only when shown. */
export function useSkillUpdateStatus(skillId: () => string | null) {
  const company = useCompany();
  return createQuery(() => ({
    queryKey: queryKeys.skills.updateStatus(company().id, skillId() ?? ""),
    queryFn: ({ signal }) => skillsApi.updateStatus(company().id, skillId()!, signal),
    enabled: skillId() !== null,
    staleTime: 60_000,
    retry: false,
  }));
}

/** Refreshes the library (and its folders), and one skill's detail, versions and files when given. */
export function useRefreshSkills() {
  const company = useCompany();
  const client = useQueryClient();
  return (skillId?: string) => {
    void client.invalidateQueries({ queryKey: queryKeys.skills.list(company().id) });
    void client.invalidateQueries({ queryKey: queryKeys.skills.folders(company().id) });
    if (skillId) void client.invalidateQueries({ queryKey: queryKeys.skills.detail(company().id, skillId) });
  };
}

/** A failure in words, for toasts. */
export function failureText(error: unknown, fallback: string) {
  return error instanceof Error && error.message ? error.message : fallback;
}
