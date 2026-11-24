import type {
  ClaudeRunPreview,
  ClaudeRunPreviewBlocker,
  ClaudeRunPreviewCheckout,
  ClaudeRunPreviewManifest,
  ClaudeRunPreviewProject,
  ClaudeRunPreviewUnsupportedReason,
  RunPromptPreview,
  RunPromptPreviewKind,
} from "@paperclipai/shared";
import { promptViewFromRecord, type PromptView } from "@/runs/prompt-sections";
import { credentialText } from "@/runs/run-manifest";

/*
 * "What runs get" (step 4b part 2, fork/step-4b-parts-2-3.md): the words for an agent's run
 * preview (`GET /agents/:id/run-preview?projectId=`), which the Runtime section's card lists in
 * the same rows as a run's "What this run got" (runs/ManifestRows.tsx). Where a preview differs
 * from a run: there's no session yet (each new task starts fresh), the repo's CLAUDE.md and
 * skills follow the project picked in "For tasks in", and a project whose repository isn't cloned
 * yet can't show them. Like run-manifest.ts, every reader is defensive about missing fields.
 */

export const SESSION_TEXT = "Each new task starts a fresh session; later wakes on the same task resume it";

/** A row's value: plain words, a path or URL in Fragment Mono, or words followed by one. */
export type PreviewValue = { text: string | null; path: string | null };

const words = (text: string): PreviewValue => ({ text, path: null });

const UNSUPPORTED: Record<ClaudeRunPreviewUnsupportedReason, string> = {
  not_claude_local: "Not available: only Claude (claude_local) runs are sealed, and this agent uses another harness.",
  not_cli_engine: "Not available on the ACP engine: only runs on the CLI engine are sealed so far.",
  runner: "Not available: runs on Paperclip Runner aren't sealed.",
  remote_target: "Not available: runs on a remote target (SSH, a sandbox or the cloud) aren't sealed.",
};

/** The one line a `supported: false` preview shows instead of the rows. */
export function unsupportedText(reason: unknown): string {
  return typeof reason === "string" && reason in UNSUPPORTED ? UNSUPPORTED[reason as ClaudeRunPreviewUnsupportedReason] : "Not available for this agent.";
}

/** The blocker lines, each the server's message (its code when there's none). */
export function blockerLines(blockers: ClaudeRunPreviewBlocker[] | undefined): string[] {
  if (!Array.isArray(blockers)) return [];
  return blockers.map((blocker) => (typeof blocker?.message === "string" && blocker.message.trim() ? blocker.message.trim() : String(blocker?.code ?? "A run would be refused"))).filter(Boolean);
}

/**
 * The credential row: as a run's, or none, when the run would have no credential (a
 * `claude_credential_missing` blocker then says so at the top).
 */
export function credentialValue(credential: ClaudeRunPreviewManifest["credential"] | undefined): string {
  return credential === null ? "None: runs will be refused" : credentialText(credential);
}

/** "CLI, sealed · config folder" and the folder. */
export function engineValue(manifest: Pick<ClaudeRunPreviewManifest, "engine" | "configDir">): PreviewValue {
  const engine = manifest.engine === "cli" ? "CLI, sealed" : String(manifest.engine ?? "Unknown engine");
  return typeof manifest.configDir === "string" && manifest.configDir ? { text: `${engine} · config folder`, path: manifest.configDir } : words(engine);
}

/** The project's repository as the preview read it: its checkout, not cloned yet, or none. */
export function checkoutValue(checkout: ClaudeRunPreviewCheckout | undefined): PreviewValue {
  if (!checkout) return words("Not recorded");
  if (checkout.kind === "local") return { text: null, path: checkout.path };
  if (checkout.kind === "not_cloned") return checkout.repoUrl ? { text: "Not cloned yet, from", path: checkout.repoUrl } : words("Not cloned yet");
  if (checkout.kind === "none") return words("None: runs work in the agent's own folder");
  return words("Not recorded");
}

/**
 * The task worktrees row, when tasks each get their own worktree of the checkout (step 4b part
 * 3): which branch or commit it starts from and the folder it goes in, else null (tasks work in
 * the checkout). A worktree holds only what's committed there, so that's what CLAUDE.md and the
 * repo skills are read from; their paths name the folder `<task branch>`, after the task.
 */
export function taskWorktreeValue(checkout: ClaudeRunPreviewCheckout | undefined): PreviewValue | null {
  if (checkout?.kind !== "local" || !checkout.worktree) return null;
  const { dir, baseRef } = checkout.worktree;
  const from = typeof baseRef === "string" && baseRef ? `From ${baseRef}, in` : "From a branch fetched on the first run, in";
  return typeof dir === "string" && dir ? { text: from, path: dir } : words(from.replace(/, in$/, ""));
}

/**
 * Why the repo's CLAUDE.md or skills won't load, for the reasons both share. A project with no
 * workspace runs in the agent's own folder, outside any project, so the preview reads `no_project`
 * for it too (server/src/services/run-preview.ts): with a project chosen, that means no repository.
 */
function repoSkip(reason: unknown, project: ClaudeRunPreviewProject | null): string | null {
  switch (reason) {
    case "no_project":
      return project ? "Not loaded: the project has no repository" : "No project selected";
    case "project_switch_off":
      return "Off for this project";
    case "not_cloned":
      return "Not cloned yet: read on the first run";
    case "base_not_fetched":
      return "Not fetched yet: read from the task's worktree on its first run";
    case "not_in_repo":
      return project?.checkout?.kind === "none" ? "Not loaded: the project has no repository" : "Not loaded: runs won't be in the project's repository";
    default:
      return null;
  }
}

/** The CLAUDE.md row: the file that would load, or why it wouldn't. */
export function claudeMdValue(load: ClaudeRunPreviewManifest["claudeMd"] | undefined, project: ClaudeRunPreviewProject | null): PreviewValue {
  if (!load) return words("Not recorded");
  if (load.enabled) return { text: null, path: load.path };
  if (load.reason === "no_file") return words("Not loaded: the repository has no CLAUDE.md at its root");
  return words(repoSkip(load.reason, project) ?? "Not loaded");
}

/** The repo skills row: how many and from where, or why none would load. */
export function repoSkillsValue(load: ClaudeRunPreviewManifest["repoSkills"] | undefined, project: ClaudeRunPreviewProject | null): PreviewValue {
  if (!load) return words("Not recorded");
  if (load.enabled) {
    const count = typeof load.count === "number" ? load.count : 0;
    return { text: `${count === 1 ? "1 skill" : `${count} skills`} from`, path: load.dir };
  }
  if (load.reason === "no_skills") return words("None: the repository has no skills in .claude/skills");
  return words(repoSkip(load.reason, project) ?? "Not loaded");
}

/** The instructions row: the entry file every new session is sent. */
export function instructionsValue(instructions: ClaudeRunPreviewManifest["instructions"] | undefined): PreviewValue {
  if (!instructions) return words("Not recorded");
  if (!instructions.entryFile) return words("None");
  return { text: null, path: instructions.entryFile };
}

/** The preview's manifest, or null when it isn't available (or not loaded). */
export function previewManifest(preview: ClaudeRunPreview | undefined): ClaudeRunPreviewManifest | null {
  return preview && preview.supported && preview.manifest ? preview.manifest : null;
}

// "For tasks in": the project choice --------------------------------------------------------------

export type ProjectChoice = { id: string; name: string };

/** The company's projects that can take tasks: the archived ones left out, in the list's order. */
export function projectChoices(projects: ReadonlyArray<{ id: string; name: string; archivedAt?: unknown }> | undefined): ProjectChoice[] {
  return (projects ?? []).filter((project) => !project.archivedAt).map((project) => ({ id: project.id, name: project.name }));
}

/**
 * The project the card previews: the remembered one while the projects load, then only if it's
 * still one of them; otherwise none ("No project").
 */
export function chosenProject(stored: string | null, choices: ProjectChoice[] | undefined): string | null {
  if (!stored) return null;
  if (!choices) return stored;
  return choices.some((choice) => choice.id === stored) ? stored : null;
}

type KeyValueStore = Pick<Storage, "getItem" | "setItem" | "removeItem">;

export const projectKey = (agentId: string) => `paperclip.ui-new.run-preview-project.${agentId}`;

function defaultStore(): KeyValueStore | null {
  try {
    return typeof localStorage === "undefined" ? null : localStorage;
  } catch {
    return null;
  }
}

/** The project remembered for this agent on this device, or null. Storage may be missing or throw. */
export function readStoredProject(agentId: string, store: KeyValueStore | null = defaultStore()): string | null {
  try {
    const value = store?.getItem(projectKey(agentId));
    return value ? value : null;
  } catch {
    return null;
  }
}

/** Remembers the choice; "No project" forgets it. A storage failure is ignored: the choice still applies. */
export function storeProject(agentId: string, projectId: string | null, store: KeyValueStore | null = defaultStore()) {
  try {
    if (projectId) store?.setItem(projectKey(agentId), projectId);
    else store?.removeItem(projectKey(agentId));
  } catch {
    // Private windows and blocked storage: nothing to remember it in.
  }
}

/*
 * The Prompt part (step 5, fork/step-5-prompt-builder.md "In ui-new"): a draft of the next run's
 * prompt for a picked task and kind of wake, in the run view's sections (runs/PromptSections.tsx).
 */

/** The task the draft is for: one of the agent's tasks, or one of its chats. */
export type PromptTask = { id: string; identifier: string | null; title: string; chat: boolean };

type TaskRow = { id: string; identifier: string | null; title: string };

export const PROMPT_KIND_LABEL: Record<RunPromptPreviewKind, string> = {
  assignment: "Fresh assignment",
  comment: "Comment",
  chat_turn: "Chat turn",
  no_task: "No task",
};

/** The kinds of wake a pick can have: none without a task, a chat's turn, or a task's assignment or comment. */
export function promptKinds(task: PromptTask | null): RunPromptPreviewKind[] {
  if (!task) return ["no_task"];
  return task.chat ? ["chat_turn"] : ["assignment", "comment"];
}

/** The kind the draft asks for: the one picked while the task can have it, else the task's first. */
export function effectivePromptKind(task: PromptTask | null, picked: RunPromptPreviewKind | null): RunPromptPreviewKind {
  const kinds = promptKinds(task);
  return picked && kinds.includes(picked) ? picked : kinds[0]!;
}

/** The short note a 422 answer shows beside the picker; null for any other failure. */
export function promptNote(error: unknown, task: PromptTask | null): string | null {
  const status = (error as { status?: unknown } | null)?.status;
  const code = ((error as { body?: unknown } | null)?.body as { code?: unknown } | null | undefined)?.code;
  if (status !== 422) return null;
  if (code === "not_a_chat") return "Not one of this agent's chats, so there's no chat turn to draft.";
  if (code === "no_comment") {
    return task?.chat ? "No messages in this chat yet, so nothing to wake on." : "No comments on this task yet, so nothing to wake on.";
  }
  return null;
}

/** A draft in the shape of a run's record, for the section view. */
export function promptPreviewView(prompt: RunPromptPreview): PromptView {
  return promptViewFromRecord({
    version: 1,
    session: "fresh",
    systemPrompt: prompt.systemPrompt,
    firstMessage: prompt.firstMessage,
    firstMessageChars: prompt.firstMessageChars,
    matchedPlan: true,
  });
}

/** The picked task's name: its identifier and title, or "No task". */
export function promptTaskName(task: PromptTask | null): string {
  if (!task) return "No task";
  return task.identifier ? `${task.identifier} ${task.title}` : task.title;
}

/**
 * The picker's lists: the agent's open tasks first, then its chats, then other tasks the search
 * found; the first two filtered by the search text, and none listed twice.
 */
export function promptTaskGroups(input: {
  query: string;
  assigned: readonly TaskRow[];
  chats: readonly TaskRow[];
  found: readonly TaskRow[];
}): { label: string; tasks: PromptTask[] }[] {
  const term = input.query.trim().toLowerCase();
  const matches = (task: TaskRow) =>
    !term || task.title.toLowerCase().includes(term) || !!task.identifier?.toLowerCase().includes(term);
  const seen = new Set<string>();
  const pick = (tasks: readonly TaskRow[], chat: boolean, filter: boolean): PromptTask[] => {
    const picked: PromptTask[] = [];
    for (const task of tasks) {
      if ((filter && !matches(task)) || seen.has(task.id)) continue;
      seen.add(task.id);
      picked.push({ id: task.id, identifier: task.identifier ?? null, title: task.title, chat });
    }
    return picked;
  };
  const groups = [
    { label: "Assigned to this agent", tasks: pick(input.assigned, false, true) },
    { label: "Chats with this agent", tasks: pick(input.chats, true, true) },
    // The search matched these already; listed only while searching.
    { label: "Other tasks", tasks: term ? pick(input.found, false, false) : [] },
  ];
  return groups.filter((group) => group.tasks.length > 0);
}
