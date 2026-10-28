import { createQuery } from "@tanstack/solid-query";
import { accessApi } from "@/api/access";
import { queryKeys } from "@/api/queryKeys";
import { cloudCreateUrl, cloudOf } from "@/auth/auth-model";
import { useSession } from "@/lib/session";
import { companyCreation, type CompanyCreation } from "./onboarding-model";

/**
 * Whether the viewer can create an organization here (`POST /companies`): a local board or an
 * instance admin, and not on a Cloud-managed instance, where Cloud creates them. Inside the gate.
 */
export function useCanCreateCompany(): () => CompanyCreation {
  const session = useSession();
  const access = createQuery(() => ({
    queryKey: queryKeys.access.currentBoardAccess,
    queryFn: accessApi.currentBoardAccess,
    enabled: session.isAuthenticatedMode(),
    retry: false,
  }));
  return () => {
    const cloud = cloudOf(session.health());
    return companyCreation({
      authenticated: session.isAuthenticatedMode(),
      instanceAdmin: access.data?.isInstanceAdmin,
      cloudCreateUrl: cloud ? (cloudCreateUrl(cloud) ?? "") : null,
    });
  };
}
