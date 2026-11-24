import { and, eq, sql } from "drizzle-orm";
import { companies, executionWorkspaces, goals, issues, projectWorkspaces, projects, type Db } from "@paperclipai/db";
import { resolveCreateIssueStatusDefault, type RunPromptDraft } from "@paperclipai/shared";
import { notFound, unprocessable } from "../errors.js";
import {
  defaultIssueExecutionWorkspaceSettingsForProject,
  parseProjectExecutionWorkspacePolicy,
} from "./execution-workspace-policy.js";
import { provisionalTitleFromDescription } from "./issues.js";
import type { PreviewPromptTarget } from "./run-preview-prompt.js";
import { buildIndependentTaskWorkspaceSettings, mergeExplicitWorkspaceSettings } from "./task-workspace-lineage.js";

/**
 * The New task dialog's prompt preview (fork/task-prompt-preview.md): a task still being written,
 * as the task it would be once created and assigned to the agent, for the run preview's builder.
 *
 * It applies what creating the task would (`issueService.create` and the create route, for a
 * person creating it): the provisional title from the description, the default status, the
 * project from the parent, and the workspace settings the parent passes on or the project gives.
 * It reads only. What exists only once the task does is left for `buildRunPreviewPrompt` to mark
 * pending: the task's id (`PREVIEW_DRAFT_ISSUE_ID` stands in) and its identifier (the next one
 * the company would give, which another task can take first).
 *
 * Not modelled: labels, blockers, reviewers and run settings (they don't reach the prompt, or
 * reach it only through a dependency or review that the task doesn't have yet), and dropping an
 * ancestor's workspace the dialog never offers.
 */

/** The draft's id in the prompt: a uuid no task has. */
export const PREVIEW_DRAFT_ISSUE_ID = "00000000-0000-0000-0000-000000000001";

/** Statuses a new task's assignee isn't woken for (queueIssueAssignmentWakeup and the create route). */
const NO_WAKE_STATUSES = new Set(["backlog", "done", "cancelled"]);

type IssueContext = NonNullable<PreviewPromptTarget["issue"]>;

/** The draft as the task it would be. 404 for a project, parent, goal or workspace outside the agent's company. */
export async function resolveDraftPromptTarget(
  db: Db,
  agent: { id: string; companyId: string },
  draft: RunPromptDraft,
  actor: { userId: string | null },
): Promise<PreviewPromptTarget> {
  const { companyId } = agent;
  const status = resolveCreateIssueStatusDefault({ status: draft.status, assigneeAgentId: agent.id }).status;
  if (NO_WAKE_STATUSES.has(status)) {
    throw unprocessable(`A task created in ${status === "backlog" ? "Backlog" : status} doesn't wake its agent`, {
      code: "no_wake",
    });
  }

  const parent = draft.parentId
    ? await db
      .select({
        id: issues.id,
        projectId: issues.projectId,
        projectWorkspaceId: issues.projectWorkspaceId,
        executionWorkspaceSettings: issues.executionWorkspaceSettings,
        conversationAgentId: issues.conversationAgentId,
      })
      .from(issues)
      .where(and(eq(issues.id, draft.parentId), eq(issues.companyId, companyId)))
      .then((rows) => rows[0] ?? null)
    : null;
  if (draft.parentId && !parent) throw notFound("Parent issue not found");
  if (parent?.conversationAgentId) {
    throw unprocessable("Conversations cannot have new subtasks; create a task in a project instead");
  }

  // A subtask without a project takes its parent's.
  const projectId = draft.projectId ?? parent?.projectId ?? null;
  const project = projectId
    ? await db
      .select({ id: projects.id, executionWorkspacePolicy: projects.executionWorkspacePolicy })
      .from(projects)
      .where(and(eq(projects.id, projectId), eq(projects.companyId, companyId)))
      .then((rows) => rows[0] ?? null)
    : null;
  if (projectId && !project) throw notFound("Project not found");

  if (draft.goalId) {
    const [goal] = await db
      .select({ id: goals.id })
      .from(goals)
      .where(and(eq(goals.id, draft.goalId), eq(goals.companyId, companyId)));
    if (!goal) throw notFound("Goal not found");
  }
  if (draft.projectWorkspaceId) {
    const [workspace] = await db
      .select({ id: projectWorkspaces.id })
      .from(projectWorkspaces)
      .where(and(eq(projectWorkspaces.id, draft.projectWorkspaceId), eq(projectWorkspaces.companyId, companyId)));
    if (!workspace) throw notFound("Project workspace not found");
  }
  let executionWorkspaceProjectWorkspaceId: string | null = null;
  if (draft.executionWorkspaceId) {
    const [workspace] = await db
      .select({ id: executionWorkspaces.id, projectWorkspaceId: executionWorkspaces.projectWorkspaceId })
      .from(executionWorkspaces)
      .where(and(eq(executionWorkspaces.id, draft.executionWorkspaceId), eq(executionWorkspaces.companyId, companyId)));
    if (!workspace) throw notFound("Execution workspace not found");
    executionWorkspaceProjectWorkspaceId = workspace.projectWorkspaceId;
  }

  // The workspace settings, as issueService.create works them out.
  const explicitWorkspace =
    draft.projectWorkspaceId !== undefined ||
    draft.executionWorkspaceId !== undefined ||
    draft.executionWorkspacePreference !== undefined ||
    draft.executionWorkspaceSettings !== undefined;
  let projectWorkspaceId = draft.projectWorkspaceId ?? null;
  let executionWorkspaceSettings = (draft.executionWorkspaceSettings as Record<string, unknown> | null | undefined) ?? null;
  if (parent) {
    const inheritsParentProject = projectId === null || projectId === parent.projectId;
    if (inheritsParentProject && draft.projectWorkspaceId === undefined && parent.projectWorkspaceId) {
      projectWorkspaceId = parent.projectWorkspaceId;
    }
    const inherited = inheritsParentProject && parent.projectWorkspaceId
      ? buildIndependentTaskWorkspaceSettings(parent.executionWorkspaceSettings)
      : null;
    if (!explicitWorkspace && executionWorkspaceSettings === null) {
      executionWorkspaceSettings = inherited;
    } else if (draft.executionWorkspaceId === undefined && draft.executionWorkspaceSettings) {
      executionWorkspaceSettings = mergeExplicitWorkspaceSettings(inherited, executionWorkspaceSettings);
    }
  }
  const executionWorkspaceId = draft.executionWorkspaceId ?? null;
  if (executionWorkspaceId) projectWorkspaceId = executionWorkspaceProjectWorkspaceId;
  if (executionWorkspaceSettings === null && executionWorkspaceId === null && project) {
    executionWorkspaceSettings = defaultIssueExecutionWorkspaceSettingsForProject(
      parseProjectExecutionWorkspacePolicy(project.executionWorkspacePolicy),
    ) as Record<string, unknown> | null;
  }

  // The title: the one written, else the description's start until the agent names the task.
  const explicitTitle = draft.title?.trim();
  const title = explicitTitle || (draft.description ? provisionalTitleFromDescription(draft.description) : "");
  if (!title) throw unprocessable("Provide a title or task description");

  const issue: IssueContext = {
    chatCommunicationGuidance: null,
    chatAssignedAgentId: null,
    chatProvider: null,
    chatSlackCommand: null,
    externalConversationState: null,
    conversationAgentId: null,
    conversationUserId: null,
    conversationState: null,
    conversationSessionGeneration: 0,
    conversationBoundaryCommentId: null,
    id: PREVIEW_DRAFT_ISSUE_ID,
    identifier: await nextIdentifier(db, companyId),
    title,
    titleNeedsGeneration: !explicitTitle,
    description: draft.description ?? null,
    status,
    workMode: draft.workMode ?? "standard",
    reviewPolicy: null,
    priority: draft.priority ?? "medium",
    projectId,
    projectWorkspaceId,
    executionWorkspaceId,
    executionWorkspacePreference: draft.executionWorkspacePreference ?? null,
    assigneeAgentId: agent.id,
    assigneeAdapterOverrides: null,
    executionPolicy: null,
    executionState: null,
    executionWorkspaceSettings,
    parentId: parent?.id ?? null,
    createdByUserId: actor.userId,
    responsibleUserId: actor.userId,
    originKind: "manual",
    originId: null,
    originRunId: null,
    originIdentityContextId: null,
    continuationIdentityContextId: null,
    updatedAt: new Date(),
  };
  return { kind: "assignment", issue, wakeCommentId: null, draft: { identifier: issue.identifier } };
}

/** The identifier the company's next task gets (issueService.create's self-correcting counter). */
async function nextIdentifier(db: Db, companyId: string): Promise<string | null> {
  const [company] = await db
    .select({ issuePrefix: companies.issuePrefix, issueCounter: companies.issueCounter })
    .from(companies)
    .where(eq(companies.id, companyId));
  if (!company) return null;
  const [maxRow] = await db
    .select({ maxNum: sql<number>`coalesce(max(${issues.issueNumber}), 0)` })
    .from(issues)
    .where(eq(issues.companyId, companyId));
  return `${company.issuePrefix}-${Math.max(company.issueCounter ?? 0, Number(maxRow?.maxNum ?? 0)) + 1}`;
}
