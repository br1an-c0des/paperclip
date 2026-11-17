import type { Agent, AttentionItem, BudgetPolicySummary, Company, CompanyArtifact, HeartbeatRun, Issue, IssueComment, IssueThreadInteraction, Project } from "@paperclipai/shared";

/*
 * The data the mocked API serves: one signed-in board user, two companies (so the company list
 * has a choice), a few agents, two projects, a handful of tasks across statuses, comments and runs.
 * Builders fill the fields the app needs and take overrides for the rest; the shapes come from
 * @paperclipai/shared, so a type change upstream shows up in `typecheck` (which checks e2e/ too).
 *
 * Ids are fixed so tests can name them. Every name starts with "M7 test", as throwaway data on
 * the real instance does.
 */

const NOW = "2026-11-16T09:00:00.000Z";
const EARLIER = "2026-11-15T15:30:00.000Z";
// The API sends dates as ISO strings; the shared types say Date.
const date = (iso: string) => iso as unknown as Date;

export const USER = {
  id: "user-m7",
  email: "m7test@example.com",
  name: "M7 test Board",
  image: null,
};

export const SESSION = {
  session: { id: "paperclip:session:user-m7", userId: USER.id },
  user: USER,
};

export const COMPANY_ID = "company-m7";
export const OTHER_COMPANY_ID = "company-m7-other";
export const PREFIX = "MSE";

export function company(overrides: Partial<Company> = {}): Company {
  return {
    id: COMPANY_ID,
    name: "M7 test Smoke Co",
    description: "The company the smoke suite runs in.",
    status: "active",
    pauseReason: null,
    pausedAt: null,
    issuePrefix: PREFIX,
    issueCounter: 12,
    budgetMonthlyCents: 50_000,
    spentMonthlyCents: 1_250,
    defaultResponsibleUserId: USER.id,
    defaultDecisionOwnerUserId: USER.id,
    budgetOwnerUserId: null,
    requireBoardApprovalForNewAgents: false,
    interactionResolverGovernance: { mode: "default" } as unknown as Company["interactionResolverGovernance"],
    feedbackDataSharingEnabled: false,
    feedbackDataSharingConsentAt: null,
    feedbackDataSharingConsentByUserId: null,
    feedbackDataSharingTermsVersion: null,
    logoAssetId: null,
    logoUrl: null,
    createdAt: date(EARLIER),
    updatedAt: date(NOW),
    ...overrides,
  };
}

export const COMPANIES: Company[] = [
  company(),
  company({ id: OTHER_COMPANY_ID, name: "M7 test Other Co", issuePrefix: "MOT", description: null }),
];

export const AGENT_ID = "agent-m7-builder";
export const CEO_ID = "agent-m7-ceo";

export function agent(overrides: Partial<Agent> = {}): Agent {
  return {
    id: AGENT_ID,
    companyId: COMPANY_ID,
    name: "M7 test Builder",
    urlKey: "m7-test-builder",
    role: "engineer",
    title: "Builder",
    icon: null,
    // Idle, so its chat takes messages. Nothing here can wake it: every write is stubbed.
    status: "idle",
    reportsTo: CEO_ID,
    capabilities: "Builds things for the smoke suite.",
    adapterType: "claude_local",
    adapterConfig: {},
    runtimeConfig: {} as Agent["runtimeConfig"],
    budgetMonthlyCents: 10_000,
    spentMonthlyCents: 250,
    pauseReason: null,
    pausedAt: null,
    permissions: { canCreateAgents: false } as Agent["permissions"],
    lastHeartbeatAt: date(EARLIER),
    metadata: null,
    createdAt: date(EARLIER),
    updatedAt: date(NOW),
    ...overrides,
  };
}

export const AGENTS: Agent[] = [
  agent({ id: CEO_ID, name: "M7 test Chief", urlKey: "m7-test-chief", role: "ceo", title: "Chief", reportsTo: null, status: "paused", pauseReason: "manual", pausedAt: date(EARLIER) }),
  agent(),
];

export const PROJECT_ID = "project-m7-site";

export function project(overrides: Partial<Project> = {}): Project {
  return {
    id: PROJECT_ID,
    companyId: COMPANY_ID,
    urlKey: "m7-test-website",
    goalId: null,
    goalIds: [],
    goals: [],
    name: "M7 test Website",
    description: "The website project.",
    status: "in_progress",
    leadAgentId: AGENT_ID,
    targetDate: null,
    color: "#6366f1",
    icon: null,
    env: null,
    pauseReason: null,
    pausedAt: null,
    executionWorkspacePolicy: null,
    codebase: {
      workspaceId: null,
      repoUrl: null,
      repoRef: null,
      defaultRef: null,
      repoName: null,
      localFolder: null,
      managedFolder: "/paperclip/projects/m7-test-website",
      effectiveLocalFolder: "/paperclip/projects/m7-test-website",
      origin: "managed_checkout",
    },
    workspaces: [],
    primaryWorkspace: null,
    archivedAt: null,
    createdAt: date(EARLIER),
    updatedAt: date(NOW),
    ...overrides,
  } as Project;
}

export const PROJECTS: Project[] = [
  project(),
  project({ id: "project-m7-docs", urlKey: "m7-test-handbook", name: "M7 test Handbook", description: null, color: "#10b981" }),
];

export const ISSUE_ID = "issue-m7-1";

export function issue(overrides: Partial<Issue> = {}): Issue {
  const number = overrides.issueNumber ?? 1;
  return {
    id: ISSUE_ID,
    companyId: COMPANY_ID,
    projectId: PROJECT_ID,
    projectWorkspaceId: null,
    goalId: null,
    parentId: null,
    visibility: "company",
    title: "M7 test Write the landing page",
    description: "Draft the landing page copy and layout.",
    status: "todo",
    workMode: "standard",
    priority: "medium",
    reviewPolicy: null,
    assigneeAgentId: AGENT_ID,
    assigneeUserId: null,
    checkoutRunId: null,
    executionRunId: null,
    executionAgentNameKey: null,
    executionLockedAt: null,
    createdByAgentId: null,
    createdByUserId: USER.id,
    responsibleUserId: USER.id,
    issueNumber: number,
    identifier: `${PREFIX}-${number}`,
    requestDepth: 0,
    billingCode: null,
    assigneeAdapterOverrides: null,
    executionWorkspaceId: null,
    executionWorkspacePreference: null,
    executionWorkspaceSettings: null,
    startedAt: null,
    completedAt: null,
    cancelledAt: null,
    hiddenAt: null,
    labelIds: [],
    labels: [],
    blockedBy: [],
    blocks: [],
    createdAt: date(EARLIER),
    updatedAt: date(NOW),
    ...overrides,
  } as Issue;
}

export const ISSUES: Issue[] = [
  issue(),
  issue({ id: "issue-m7-2", issueNumber: 2, identifier: `${PREFIX}-2`, title: "M7 test Fix the signup form", status: "in_progress", priority: "high", startedAt: date(EARLIER) }),
  issue({ id: "issue-m7-3", issueNumber: 3, identifier: `${PREFIX}-3`, title: "M7 test Review the pricing copy", status: "in_review" }),
  issue({ id: "issue-m7-4", issueNumber: 4, identifier: `${PREFIX}-4`, title: "M7 test Pick a font", status: "done", completedAt: date(EARLIER), projectId: "project-m7-docs" }),
  issue({ id: "issue-m7-5", issueNumber: 5, identifier: `${PREFIX}-5`, title: "M7 test Plan the launch", status: "backlog", priority: "low", assigneeAgentId: null }),
];

export const RUN_ID = "run-m7-1";

export function run(overrides: Partial<HeartbeatRun> = {}): HeartbeatRun {
  return {
    id: RUN_ID,
    companyId: COMPANY_ID,
    agentId: AGENT_ID,
    scopeKind: "issue",
    issueId: ISSUE_ID,
    responsibleUserId: USER.id,
    invocationSource: "assignment",
    triggerDetail: null,
    status: "succeeded",
    startedAt: date(EARLIER),
    finishedAt: date(EARLIER),
    error: null,
    wakeupRequestId: null,
    exitCode: 0,
    signal: null,
    usageJson: null,
    resultJson: null,
    sessionIdBefore: null,
    sessionIdAfter: null,
    logStore: null,
    logRef: null,
    logBytes: 0,
    logSha256: null,
    logCompressed: false,
    stdoutExcerpt: "Wrote the landing page draft.",
    stderrExcerpt: null,
    errorCode: null,
    externalRunId: null,
    contextSnapshot: { issueId: ISSUE_ID },
    createdAt: date(EARLIER),
    updatedAt: date(EARLIER),
    ...overrides,
  } as unknown as HeartbeatRun;
}

export function comment(overrides: Partial<IssueComment> = {}): IssueComment {
  return {
    id: "comment-m7-1",
    companyId: COMPANY_ID,
    issueId: ISSUE_ID,
    authorType: "agent",
    authorAgentId: AGENT_ID,
    authorUserId: null,
    body: "M7 test I started on the draft.",
    presentation: null,
    metadata: null,
    createdAt: date(EARLIER),
    updatedAt: date(EARLIER),
    ...overrides,
  } as IssueComment;
}

/** Your chat with the Builder: a task with `conversationAgentId`, which task lists leave out. */
export const CHAT_ID = "issue-m7-chat";

ISSUES.push(
  issue({
    id: CHAT_ID,
    issueNumber: 6,
    identifier: `${PREFIX}-6`,
    title: "M7 test Chat with Builder",
    description: null,
    projectId: null,
    status: "in_progress",
    conversationAgentId: AGENT_ID,
    conversationUserId: USER.id,
  }),
);

export const COMMENTS: IssueComment[] = [
  comment(),
  comment({ id: "comment-m7-chat-1", issueId: CHAT_ID, body: "M7 test Hi, I'm ready when you are." }),
];

/** A document on MSE-1, in the Website project's Docs tab. */
export const ARTIFACTS: CompanyArtifact[] = [
  {
    id: "document:issue-m7-1:plan",
    source: "document",
    mediaKind: "document",
    title: "M7 test Landing page plan",
    previewText: "Hero, three features, pricing, footer.",
    contentType: "text/markdown",
    contentPath: null,
    openPath: null,
    downloadPath: null,
    issue: { id: ISSUE_ID, identifier: `${PREFIX}-1`, title: "M7 test Write the landing page" },
    project: { id: PROJECT_ID, name: "M7 test Website" },
    createdByAgent: { id: AGENT_ID, name: "M7 test Builder" },
    updatedAt: EARLIER,
    href: `/${PREFIX}/issues/${PREFIX}-1#document-plan`,
  },
];

/** A task's run, as `GET /issues/:id/runs` lists it (ui-new/src/api/issues.ts `RunForIssue`). */
export function issueRun(overrides: Record<string, unknown> = {}) {
  return {
    runId: RUN_ID,
    status: "succeeded",
    agentId: AGENT_ID,
    adapterType: "claude_local",
    startedAt: EARLIER,
    finishedAt: "2026-11-15T15:34:00.000Z",
    createdAt: EARLIER,
    invocationSource: "assignment",
    errorCode: null,
    error: null,
    usageJson: null,
    resultJson: null,
    ...overrides,
  };
}

/** An Inbox card (`GET /companies/:id/attention`), addressed to you. */
export function attentionItem(overrides: Partial<AttentionItem> = {}): AttentionItem {
  return {
    id: "attention-m7-question",
    companyId: COMPANY_ID,
    sourceKind: "issue_thread_interaction",
    subject: {
      kind: "interaction",
      id: QUESTION_ID,
      companyId: COMPANY_ID,
      title: "M7 test Which signup fields should stay?",
      identifier: null,
      status: "pending",
      href: `/${PREFIX}/issues/${PREFIX}-2`,
      metadata: { kind: "ask_user_questions", issueId: "issue-m7-2" },
    },
    whyNow: "M7 test Builder asked you a question.",
    decisionVerbs: [],
    inlineResolvable: true,
    entryRule: "pending interaction",
    exitRule: "answered",
    dedupKey: `interaction:${QUESTION_ID}`,
    dismissalKey: `attention:interaction:${QUESTION_ID}`,
    dismissal: null,
    severity: "medium",
    rank: 10,
    activityAt: NOW,
    createdAt: NOW,
    updatedAt: NOW,
    relatedIssue: {
      kind: "issue",
      id: "issue-m7-2",
      companyId: COMPANY_ID,
      title: "M7 test Fix the signup form",
      identifier: `${PREFIX}-2`,
      status: "in_progress",
      href: `/${PREFIX}/issues/${PREFIX}-2`,
    },
    audience: { kind: "user", userId: USER.id, reason: "addressee" },
    stale: null,
    required: false,
    changeFingerprint: "fp-1",
    closeModes: [],
    obligationKey: null,
    obligationLeadId: null,
    project: { id: PROJECT_ID, name: "M7 test Website" },
    workspace: null,
    expiresAt: null,
    ruleKey: null,
    originAgentName: "M7 test Builder",
    queues: [],
    shelf: false,
    retentionDays: 30,
    keep: false,
    archivedAt: null,
    retentionVersion: 1,
    decideBy: null,
    decideByAttribution: null,
    snoozedUntil: null,
    detail: null,
    trainingExampleId: null,
    ...overrides,
  } as AttentionItem;
}

/** The agent's question on MSE-2, waiting for an answer. */
export const QUESTION_ID = "interaction-m7-question";

export const INTERACTIONS: IssueThreadInteraction[] = [
  {
    id: QUESTION_ID,
    companyId: COMPANY_ID,
    issueId: "issue-m7-2",
    kind: "ask_user_questions",
    status: "pending",
    createdByAgentId: AGENT_ID,
    createdByUserId: null,
    addresseeUserId: USER.id,
    continuationPolicy: "wake_assignee",
    resolverPolicy: "anyone",
    requestedResolverPolicy: "anyone",
    effectiveResolverPolicy: "anyone",
    createdAt: NOW,
    updatedAt: NOW,
    payload: {
      version: 1,
      questions: [
        {
          id: "q1",
          prompt: "M7 test Which signup fields should stay?",
          selectionMode: "single",
          required: true,
          options: [
            { id: "o1", label: "Email only" },
            { id: "o2", label: "Email and name" },
          ],
        },
      ],
    },
  } as unknown as IssueThreadInteraction,
];

/** A second question, on MSE-3, so Needs you has more than one card. */
export const PRICING_QUESTION_ID = "interaction-m7-pricing";

INTERACTIONS.push({
  ...structuredClone(INTERACTIONS[0]!),
  id: PRICING_QUESTION_ID,
  issueId: "issue-m7-3",
  payload: {
    version: 1,
    questions: [
      {
        id: "q1",
        prompt: "M7 test Which pricing tier goes first?",
        selectionMode: "single",
        required: true,
        options: [
          { id: "o1", label: "Free" },
          { id: "o2", label: "Team" },
        ],
      },
    ],
  },
} as IssueThreadInteraction);

export const ATTENTION: AttentionItem[] = [
  attentionItem(),
  attentionItem({
    id: "attention-m7-pricing",
    subject: {
      kind: "interaction",
      id: PRICING_QUESTION_ID,
      companyId: COMPANY_ID,
      title: "M7 test Which pricing tier goes first?",
      identifier: null,
      status: "pending",
      href: `/${PREFIX}/issues/${PREFIX}-3`,
      metadata: { kind: "ask_user_questions", issueId: "issue-m7-3" },
    },
    relatedIssue: {
      kind: "issue",
      id: "issue-m7-3",
      companyId: COMPANY_ID,
      title: "M7 test Review the pricing copy",
      identifier: `${PREFIX}-3`,
      status: "in_review",
      href: `/${PREFIX}/issues/${PREFIX}-3`,
    },
    dedupKey: `interaction:${PRICING_QUESTION_ID}`,
    dismissalKey: `attention:interaction:${PRICING_QUESTION_ID}`,
    changeFingerprint: "fp-2",
    rank: 20,
  }),
];

/** The organization's monthly budget: $500, $12.50 spent. */
export function budgetPolicy(overrides: Partial<BudgetPolicySummary> = {}): BudgetPolicySummary {
  return {
    policyId: "budget-m7-company",
    companyId: COMPANY_ID,
    scopeType: "company",
    scopeId: COMPANY_ID,
    scopeName: "M7 test Smoke Co",
    metric: "billed_cents",
    windowKind: "calendar_month_utc",
    amount: 50_000,
    observedAmount: 1_250,
    unpricedEventCount: 0,
    pendingRunCount: 0,
    remainingAmount: 48_750,
    utilizationPercent: 2.5,
    warnPercent: 80,
    hardStopEnabled: true,
    unpricedUsagePolicy: "block",
    notifyEnabled: true,
    isActive: true,
    status: "ok",
    paused: false,
    pauseReason: null,
    windowStart: date("2026-11-01T00:00:00.000Z"),
    windowEnd: date("2026-12-01T00:00:00.000Z"),
    ...overrides,
  };
}
