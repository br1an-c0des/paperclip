import { Navigate, useLocation, useParams } from "@solidjs/router";
import { useCompany } from "@/lib/company";
import { recurringPath } from "./queries";

/*
 * The old Routines paths (`/:prefix/routines` and `/:prefix/routines/:routineId?section=…`) land on
 * the Recurring view of the task list, with the routine open when there is one. The old detail
 * page's Runs, Activity and History sections map to the panel's Runs and History; the rest are in
 * Details.
 */

export function routineSection(section: string | null): "runs" | "history" | undefined {
  if (section === "runs" || section === "activity") return "runs";
  if (section === "history") return "history";
  return undefined;
}

export function RoutineRedirect() {
  const params = useParams<{ routineId?: string }>();
  const location = useLocation();
  const company = useCompany();
  const section = () => routineSection(new URLSearchParams(location.search).get("section"));
  return <Navigate href={recurringPath(company().issuePrefix, params.routineId, params.routineId ? section() : undefined)} />;
}
