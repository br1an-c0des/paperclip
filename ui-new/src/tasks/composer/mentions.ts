/*
 * @-mentions in the composer and in comments. A mention is a Markdown link, in the shapes the old
 * editor writes (ui/src/components/MarkdownEditor.tsx, with the schemes from
 * packages/shared/src/project-mentions.ts and issue-references.ts):
 *
 *   [@Quant Researcher](agent://<id>)   an agent, which wakes it
 *   [@Sam K.](user://<id>)              a person
 *   [TRA-41](/issues/TRA-41)            a task
 *
 * The schemes are mirrored here rather than imported, since the shared package's helpers are
 * runtime code (decision 10's approach). In a comment, mention links become chips and bare task
 * identifiers ("TRA-41") become task links; code is left alone.
 */

export type MentionTarget =
  | { kind: "agent"; id: string; name: string }
  | { kind: "user"; id: string; name: string }
  | { kind: "task"; id: string; identifier: string; title?: string };

/** The "@query" being typed just before the caret, or null. */
export type ActiveMention = { start: number; end: number; query: string };

const MENTION_QUERY = /(^|[\s(])@([^\s@()[\]]{0,40})$/;

export function activeMention(text: string, caret: number): ActiveMention | null {
  const before = text.slice(0, caret);
  const match = MENTION_QUERY.exec(before);
  if (!match) return null;
  const query = match[2] ?? "";
  return { start: caret - query.length - 1, end: caret, query };
}

/** Escapes the characters that would end a Markdown link label. */
export function escapeLabel(name: string) {
  return name.replace(/[[\]\\]/g, "\\$&");
}

export function mentionMarkdown(target: MentionTarget) {
  switch (target.kind) {
    case "agent":
      return `[@${escapeLabel(target.name)}](agent://${target.id})`;
    case "user":
      return `[@${escapeLabel(target.name)}](user://${target.id})`;
    case "task":
      return `[${target.identifier}](/issues/${target.identifier})`;
  }
}

/** Replaces the typed "@query" with the mention and a space; returns the text and the new caret. */
export function insertMention(text: string, at: ActiveMention, target: MentionTarget) {
  const inserted = `${mentionMarkdown(target)} `;
  const after = text.slice(at.end).replace(/^ /, "");
  return { text: text.slice(0, at.start) + inserted + after, caret: at.start + inserted.length };
}

/** True when a picker entry matches the typed query: any word of the name starts with it. */
export function matchesQuery(name: string, query: string) {
  const wanted = query.trim().toLowerCase();
  if (!wanted) return true;
  const lower = name.toLowerCase();
  return lower.startsWith(wanted) || lower.split(/[\s._-]+/).some((word) => word.startsWith(wanted));
}

export type ParsedMention = { kind: "agent" | "user" | "project"; id: string; label: string };

const MENTION_LINK = /\[((?:\\.|[^\]\\])*)\]\((agent|user|project):\/\/([^)\s?]+)(?:\?[^)\s]*)?\)/g;

/** The agents, people and projects a message mentions, in order. */
export function parseMentions(markdown: string): ParsedMention[] {
  const found: ParsedMention[] = [];
  for (const segment of splitCode(markdown)) {
    if (segment.code) continue;
    for (const match of segment.text.matchAll(MENTION_LINK)) {
      found.push({ kind: match[2] as ParsedMention["kind"], id: match[3]!, label: unescapeLabel(match[1]!) });
    }
  }
  return found;
}

/** The task identifier a link points at (`/issues/TRA-41`, or a full URL to it), or null. */
export function taskRefFromHref(href: string | null | undefined): string | null {
  if (!href) return null;
  const match = /(?:^|\/)issues\/([A-Za-z][A-Za-z0-9]*-\d+)(?:[/?#]|$)/.exec(href);
  return match ? match[1]!.toUpperCase() : null;
}

/**
 * The message, ready for the Markdown renderer: mention links become `<span class="mention">`
 * chips, and bare identifiers with the company's prefix become task links. Code spans and fenced
 * blocks pass through untouched.
 */
export function decorateMentions(markdown: string, issuePrefix?: string | null) {
  const bareTask = issuePrefix ? new RegExp(`(?<![\\w/\\[#-])(${escapeRegExp(issuePrefix)}-\\d+)(?![\\w\\]-])`, "gi") : null;
  return splitCode(markdown)
    .map((segment) => {
      if (segment.code) return segment.text;
      let text = segment.text.replace(MENTION_LINK, (_all, label: string, kind: string, id: string) => {
        const shown = escapeHtml(unescapeLabel(label));
        return `<span class="mention mention--${kind}" data-mention="${kind}" data-id="${escapeHtml(id)}">${shown}</span>`;
      });
      if (bareTask) text = text.replace(bareTask, (identifier: string) => `[${identifier.toUpperCase()}](/issues/${identifier.toUpperCase()})`);
      return text;
    })
    .join("");
}

type Segment = { text: string; code: boolean };

/** Splits Markdown into code (fenced blocks, inline spans) and everything else. */
export function splitCode(markdown: string): Segment[] {
  const segments: Segment[] = [];
  const pattern = /(^|\n)(```|~~~)[^\n]*\n[\s\S]*?(?:\n\2[^\n]*(?=\n|$)|$)|`+[^`\n]*`+/g;
  let last = 0;
  for (const match of markdown.matchAll(pattern)) {
    const start = match.index! + (match[1] ? match[1].length : 0);
    if (start > last) segments.push({ text: markdown.slice(last, start), code: false });
    segments.push({ text: markdown.slice(start, match.index! + match[0].length), code: true });
    last = match.index! + match[0].length;
  }
  if (last < markdown.length) segments.push({ text: markdown.slice(last), code: false });
  return segments;
}

function unescapeLabel(label: string) {
  return label.replace(/\\([[\]\\])/g, "$1");
}

function escapeHtml(value: string) {
  return value.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

function escapeRegExp(value: string) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
