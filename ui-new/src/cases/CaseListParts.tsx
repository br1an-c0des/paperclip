import type { CompactIssue } from "@paperclipai/shared";
import { For, Show, type JSX } from "solid-js";
import type { CaseGroups, TaskGroup } from "@/tasks/list-model";
import type { GroupDecor } from "@/tasks/TaskList";
import { Capsule, TonePill } from "@/ui/Status";
import { asksForCase, isClosedCase, orderCases, ROLE_LABEL } from "./case-model";
import { CaseChip } from "./CaseChip";
import { CaseHeadAfter, CaseHeadBelow } from "./CaseGroupHead";
import type { CaseIndex } from "./queries";

/*
 * What the task list (src/tasks/) draws for cases, from the case index (queries.ts):
 *
 * - On each row, the task's case chips (board C1): solid with ticks where it's the main task, dashed
 *   where it's linked. A task in more than two cases shows two and a count. A task made with Start
 *   a case (C5) shows "Case requested" until its case links it.
 * - Grouped by case (board C2), the row's role in that group's case instead, and each case's group
 *   heading (CaseGroupHead.tsx).
 */

const SHOWN = 2;
const isClosedTask = (status: string) => status === "done" || status === "cancelled";

export function caseRowExtra(index: CaseIndex): (task: CompactIssue, group: TaskGroup) => JSX.Element {
  return (task, group) => {
    if (!index.on()) return null;
    const inGroup = group.value?.field === "case" ? group.value.caseId : undefined;
    if (inGroup) {
      const role = index.of(task.id).find((entry) => entry.case.id === inGroup)?.role;
      return role ? (
        <span class="case-role" classList={{ "case-role--main": role === "main" }}>
          {ROLE_LABEL[role]}
        </span>
      ) : null;
    }
    // Not in a case says it in its heading; elsewhere, the task's cases.
    if (group.value?.field === "case") return null;
    const cases = index.of(task.id);
    // A task made with Start a case whose case isn't set up yet (board C5).
    if (cases.length === 0) {
      return asksForCase(task.description) && index.settled() && !isClosedTask(task.status) ? (
        <TonePill tone="run" compact icon={<Capsule gradient="ion" size="tiny" />}>
          Case requested
        </TonePill>
      ) : null;
    }
    return (
      <>
        <For each={cases.slice(0, SHOWN)}>{(entry) => <CaseChip kase={entry.case} role={entry.role} diagram={index.diagram(entry.case.workflowId)} />}</For>
        <Show when={cases.length > SHOWN}>
          <span class="case-chip case-chip--link" title={cases.slice(SHOWN).map((entry) => entry.case.identifier).join(", ")}>
            +{cases.length - SHOWN}
          </span>
        </Show>
      </>
    );
  };
}

export function caseGroupDecor(index: CaseIndex): (group: TaskGroup) => GroupDecor | null {
  return (group) => {
    if (group.mark.kind !== "case") return null;
    const kase = index.byId().get(group.mark.caseId);
    if (!kase) return null;
    return {
      after: <CaseHeadAfter kase={kase} diagram={index.diagram(kase.workflowId)} />,
      below: <CaseHeadBelow kase={kase} detail={index.detail(kase.id)} diagram={index.diagram(kase.workflowId)} />,
    };
  };
}

/** Group: Case's cases, in order; closed cases only while `withClosed` (their links load then too). */
export function caseGroups(index: CaseIndex): CaseGroups {
  return {
    of: (taskId) => index.of(taskId).map((entry) => entry.case.id),
    order: orderCases(index.cases()).map(({ case: kase, depth }) => ({
      id: kase.id,
      title: kase.title,
      depth,
      closed: isClosedCase(kase.status),
      empty: !kase.workIssueId,
    })),
  };
}
