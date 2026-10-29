import { createQueries, createQuery } from "@tanstack/solid-query";
import { createMemo } from "solid-js";
import { casesApi, type CaseDetail } from "@/api/cases";
import { queryKeys } from "@/api/queryKeys";
import { useCompany } from "@/lib/company";
import { useExperimentalSettingsQuery } from "@/lib/company-data";
import { caseMembership, isClosedCase, workflowUse, type Membership } from "./case-model";
import { parseWorkflowDiagram, type WorkflowDiagram } from "./workflow-diagram";

/*
 * Cases' data for the task views. Everything waits on `enableCases`: with it off the server answers
 * 403, and the task views show no trace of cases.
 *
 * The case list is one request; each case's links take one more (decision 16), made for open cases
 * always and for closed ones only when asked (Group: Case with closed cases shown). Workflows are
 * fetched once each, for their diagrams. All of it is kept a minute, and live events about a case
 * (hand-offs log as `case.*` activity) refresh it (lib/live-events.tsx).
 */

const STALE = 60_000;

export function useCasesOn() {
  const settings = useExperimentalSettingsQuery();
  return () => settings.data?.enableCases === true;
}

export function useCaseList(enabled: () => boolean) {
  const company = useCompany();
  return createQuery(() => ({
    queryKey: queryKeys.cases.list(company().id),
    queryFn: ({ signal }) => casesApi.list(company().id, {}, signal),
    enabled: enabled(),
    staleTime: STALE,
  }));
}

/** One case with its links, by id or identifier. */
export function useCase(ref: () => string | null) {
  const company = useCompany();
  return createQuery(() => ({
    queryKey: queryKeys.cases.detail(company().id, ref() ?? ""),
    queryFn: ({ signal }) => casesApi.get(ref()!, signal),
    enabled: !!ref(),
    staleTime: STALE,
  }));
}

/** A company workflow's diagram (null without one), by workflow id. */
export function useWorkflowDiagrams(ids: () => readonly string[]) {
  const company = useCompany();
  const queries = createQueries(() => ({
    queries: ids().map((id) => ({
      queryKey: queryKeys.cases.workflow(company().id, id),
      queryFn: ({ signal }: { signal: AbortSignal }) => casesApi.workflow(id, signal),
      staleTime: 5 * STALE,
    })),
  }));
  return createMemo(() => {
    const map = new Map<string, WorkflowDiagram | null>();
    for (const query of queries) if (query.data) map.set(query.data.id, parseWorkflowDiagram(query.data.prompt));
    return map;
  });
}

/**
 * The company's cases, which of them each task is in, and their workflows' diagrams, for chips on
 * rows and Group: Case. `withClosed` also loads the links of done and cancelled cases.
 */
export function useCaseIndex(options: { enabled: () => boolean; withClosed?: () => boolean }) {
  const company = useCompany();
  const list = useCaseList(options.enabled);
  const cases = () => list.data ?? [];
  const detailIds = createMemo(() =>
    cases()
      .filter((kase) => options.withClosed?.() || !isClosedCase(kase.status))
      .map((kase) => kase.id),
  );
  const details = createQueries(() => ({
    queries: detailIds().map((id) => ({
      queryKey: queryKeys.cases.detail(company().id, id),
      queryFn: ({ signal }: { signal: AbortSignal }) => casesApi.get(id, signal),
      staleTime: STALE,
    })),
  }));
  const detailMap = createMemo(() => {
    const map = new Map<string, CaseDetail>();
    for (const query of details) if (query.data) map.set(query.data.id, query.data);
    return map;
  });
  const membership = createMemo(() => caseMembership(cases(), detailMap()));
  const workflowIds = createMemo(() => [...new Set(cases().flatMap((kase) => (kase.workflowId ? [kase.workflowId] : [])))]);
  const diagrams = useWorkflowDiagrams(workflowIds);
  const byId = createMemo(() => new Map(cases().map((kase) => [kase.id, kase] as const)));
  return {
    on: options.enabled,
    query: list,
    cases,
    byId,
    detail: (id: string) => detailMap().get(id),
    /** The task's cases; empty for a task in none. */
    of: (taskId: string): Membership[] => membership().get(taskId) ?? [],
    diagram: (workflowId: string | null | undefined) => (workflowId ? (diagrams().get(workflowId) ?? null) : null),
    usedBy: createMemo(() => workflowUse(cases())),
    /** Whether every link this index loads is in, so "not in a case" can be trusted. */
    settled: () => list.isSuccess && details.every((query) => !query.isPending),
  };
}

export type CaseIndex = ReturnType<typeof useCaseIndex>;
