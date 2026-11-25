import type {
  AgentAccessAction,
  AgentAccessOverrides,
  ClaudeCredentialMethod,
  ClaudeFreshSessionReason,
  ClaudeMdSkipReason,
  ClaudeRepoSkillsSkipReason,
  ClaudeRunManifest,
} from "@paperclipai/shared";
import { ACTION_WORDS, LEVEL_WORDS } from "@/agents/settings/access-model";

/*
 * "What this run got" (step 4b, fork/step-4b-sealed-runs.md section 8): the words for a sealed
 * claude_local CLI run's manifest, which the run's Input tab lists above the raw command. The
 * manifest comes from the run's `adapter.invoke` event (`readRunManifest` in invocation.ts). Every
 * reader is defensive: a manifest from a newer or older adapter may lack a field, and a missing
 * field shows as "Not recorded" rather than breaking the tab.
 */

const METHOD_WORDS: Record<ClaudeCredentialMethod, string> = {
  subscription: "Claude subscription",
  api_key: "API key",
  auth_token: "Auth token",
  bedrock: "Amazon Bedrock",
  vertex: "Google Vertex AI",
  foundry: "Microsoft Foundry",
  routed: "An AI router",
};

const CLAUDE_MD_REASONS: Record<ClaudeMdSkipReason, string> = {
  project_switch_off: "Off for this project",
  not_in_repo: "The run wasn't in the project's repository",
  no_project: "The run has no project",
  no_file: "The repository has no CLAUDE.md at its root",
};

const REPO_SKILLS_REASONS: Record<ClaudeRepoSkillsSkipReason, string> = {
  project_switch_off: "Off for this project",
  not_in_repo: "The run wasn't in the project's repository",
  no_project: "The run has no project",
  no_skills: "The repository has no skills in .claude/skills",
};

const FRESH_REASONS: Record<ClaudeFreshSessionReason, string> = {
  no_saved_session: "there was no saved session",
  invalid_session_id: "the saved session's ID wasn't valid",
  cwd_changed: "the working folder changed",
  prompt_bundle_changed: "the agent's skills or instructions changed",
  target_changed: "the run's machine or environment changed",
  session_unavailable: "the saved session couldn't be resumed",
};

const known = <T extends string>(words: Record<T, string>, value: unknown): string | null =>
  typeof value === "string" && value in words ? words[value as T] : null;

/** "Claude subscription · connection Brian's Max", or "API key · from the agent's environment". */
export function credentialText(credential: ClaudeRunManifest["credential"] | undefined): string {
  if (!credential) return "Not recorded";
  const method = known(METHOD_WORDS, credential.method) ?? String(credential.method ?? "Unknown method");
  if (credential.kind === "managed_connection") {
    return credential.connectionName ? `${method} · connection ${credential.connectionName}` : `${method} · from an AI connection`;
  }
  if (credential.kind === "agent_env") return `${method} · from the agent's environment`;
  return method;
}

export type SkillGroup = {
  plugin: "paperclip" | "company" | "project";
  label: string;
  skills: Array<{ name: string; clash: boolean }>;
};

const GROUPS: Array<{ plugin: SkillGroup["plugin"]; label: string }> = [
  { plugin: "paperclip", label: "Paperclip" },
  { plugin: "company", label: "Company" },
  { plugin: "project", label: "Repository" },
];

/** The skills grouped Paperclip / company / repository, by their plain names; empty groups left out. */
export function skillGroups(manifest: Pick<ClaudeRunManifest, "skills" | "skillNameClashes">): SkillGroup[] {
  const skills = Array.isArray(manifest.skills) ? manifest.skills : [];
  const clashes = new Set(Array.isArray(manifest.skillNameClashes) ? manifest.skillNameClashes : []);
  return GROUPS.map(({ plugin, label }) => ({
    plugin,
    label,
    skills: skills
      .filter((skill) => skill?.plugin === plugin && typeof skill.name === "string")
      .map((skill) => ({ name: skill.name, clash: clashes.has(skill.name) })),
  })).filter((group) => group.skills.length > 0);
}

/** The repo skills line, only when they were skipped: the reason in words. */
export function repoSkillsSkipped(manifest: ClaudeRunManifest): string | null {
  const load = manifest.repoSkills;
  if (!load || load.enabled) return null;
  return known(REPO_SKILLS_REASONS, load.reason) ?? "Not loaded";
}

/** The CLAUDE.md line: its path, or why it didn't load. */
export function claudeMdText(manifest: ClaudeRunManifest): { loaded: boolean; text: string } {
  const load = manifest.claudeMd;
  if (!load) return { loaded: false, text: "Not recorded" };
  if (load.enabled) return { loaded: true, text: load.path };
  return { loaded: false, text: `Not loaded: ${(known(CLAUDE_MD_REASONS, load.reason) ?? "no reason recorded").replace(/^./, (c) => c.toLowerCase())}` };
}

function overrideText(action: string, value: unknown) {
  const label = ACTION_WORDS[action as AgentAccessAction]?.label ?? action;
  if (value === true) return `${label}: on`;
  if (value === false) return `${label}: off`;
  return `${label}: within a scope`;
}

/** "Worker", plus each override: "Worker · Hire agents: on". */
export function accessText(access: ClaudeRunManifest["access"] | undefined): string {
  if (!access) return "Not recorded";
  const level = LEVEL_WORDS[access.level]?.label ?? String(access.level);
  const overrides = Object.entries((access.overrides ?? {}) as AgentAccessOverrides).filter(([, value]) => value !== undefined);
  return overrides.length === 0 ? level : `${level} · ${overrides.map(([action, value]) => overrideText(action, value)).join(", ")}`;
}

/**
 * The instructions line: the entry file, and whether the system prompt file was sent. Sealed runs
 * send it with every run, and a resumed session uses it only after a compaction (step 5 phase 2,
 * bug 90); older records of a resume say it wasn't sent.
 */
export function instructionsText(
  instructions: ClaudeRunManifest["instructions"] | undefined,
  session?: ClaudeRunManifest["session"],
): string {
  if (!instructions) return "Not recorded";
  const resumed = session?.mode === "resumed";
  if (instructions.sent && resumed) {
    const sent = "system prompt file sent; a resumed session uses it only after a compaction";
    return instructions.entryFile ? `${instructions.entryFile}, ${sent}` : `Sent; a resumed session uses it only after a compaction`;
  }
  if (!instructions.entryFile) return instructions.sent ? "Sent" : "None";
  return instructions.sent ? `${instructions.entryFile}, sent` : `${instructions.entryFile}, not sent: the resumed session already has it`;
}

/**
 * The GitHub line: "Connection: octocat (personal)", "This server's GitHub login" or "None".
 * Null when the manifest has no `github` (older runs), so the row isn't shown.
 */
export function githubText(github: ClaudeRunManifest["github"] | undefined): string | null {
  if (!github || typeof github !== "object") return null;
  if (github.mode === "server_login") return "This server's GitHub login";
  if (github.mode === "none") return "None";
  if (github.mode === "connection") {
    const source = github.identitySource === "dedicated" ? "dedicated" : "personal";
    return `Connection: ${github.login ? github.login : "account not recorded"} (${source})`;
  }
  return null;
}

/** "Resumed 7f3a…", or "A new session: the working folder changed". */
export function sessionText(session: ClaudeRunManifest["session"] | undefined, shortId: (id: string) => string): string {
  if (!session) return "Not recorded";
  if (session.mode === "resumed") return `Resumed ${shortId(session.sessionId)}`;
  const why = known(FRESH_REASONS, session.reason);
  return why ? `A new session: ${why}` : "A new session";
}
