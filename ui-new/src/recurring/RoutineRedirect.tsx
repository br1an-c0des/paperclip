import { Navigate, useLocation, useParams } from "@solidjs/router";
import { useCompany } from "@/lib/company";
import { recurringPath } from "./queries";

/*
 * The old Routines paths (`/:prefix/routines` and `/:prefix/routines/:routineId?section=…`) land on
 * the Recurring view of the task list, with the routine open when there is one. The old detail
 * page's Runs, Activity and History sections map to the panel's; the rest are in Details.
 */

export function routineSection(section: string | null): "runs" | "history" | "activity" | undefined {
  if (section === "runs" || section === "history" || section === "activity") return section;
  return undefined;
}

export function RoutineRedirect() {
  const params = useParams<{ routineId?: string; "*"?: string }>();
  const location = useLocation();
  const company = useCompany();
  // `?section=activity`, or the older `/routines/:id/activity`.
  const section = () => routineSection(new URLSearchParams(location.search).get("section") ?? (params["*"] || "").split("/")[0] ?? null);
  return <Navigate href={recurringPath(company().issuePrefix, params.routineId, params.routineId ? section() : undefined)} />;
}
