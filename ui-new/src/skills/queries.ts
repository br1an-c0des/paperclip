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

/** Refreshes the library, and one skill's detail, versions and files when given. */
export function useRefreshSkills() {
  const company = useCompany();
  const client = useQueryClient();
  return (skillId?: string) => {
    void client.invalidateQueries({ queryKey: queryKeys.skills.list(company().id) });
    if (skillId) void client.invalidateQueries({ queryKey: queryKeys.skills.detail(company().id, skillId) });
  };
}

/** A failure in words, for toasts. */
export function failureText(error: unknown, fallback: string) {
  return error instanceof Error && error.message ? error.message : fallback;
}
