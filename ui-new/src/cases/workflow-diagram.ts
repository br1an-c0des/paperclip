/*
 * A case workflow's phases, read from its Markdown (decision 16). Since #16959 a workflow is a
 * Markdown document, and upstream recommends a fenced Mermaid `stateDiagram-v2` whose state IDs
 * match the phase names the agents hand off with. The server doesn't run the diagram, so this is
 * advisory: a workflow without one has no phase track, and the case's phase shows as text.
 *
 * What's read: transitions (`A --> B`, `A --> B : label`, `[*] --> A`, `A --> [*]`) and display
 * names (`state "Paper trade" as Paper`). Pseudo-states (`<<choice>>`, `<<fork>>`, `<<join>>`)
 * aren't phases, but transitions through them still count. Notes, comments, `direction` and
 * descriptions (`A : text`) are skipped; a composite state's inner states are read as phases of
 * their own.
 *
 * Phases come in the order the work reaches them: breadth first from `[*]`, following transitions
 * in the order they're written, then any the start doesn't reach, in the order they appear.
 */

export type DiagramPhase = { id: string; name: string };

/** A transition; null is `[*]` (the start as a source, the end as a target). */
export type DiagramEdge = { from: string | null; to: string | null; label: string | null };

export type WorkflowDiagram = {
  phases: DiagramPhase[];
  edges: DiagramEdge[];
  /** Some transition goes to `[*]`: the workflow has a finish. */
  ends: boolean;
};

/** A transition back to an earlier phase: "Backtest can send it back to Build". */
export type DiagramLoop = { from: DiagramPhase; to: DiagramPhase; label: string | null };

const FENCE = /^(`{3,}|~{3,})\s*mermaid\b[^\n]*\n([\s\S]*?)^\1\s*$/gm;

/** The first Mermaid block in the Markdown that is a state diagram, or null. */
export function diagramSource(markdown: string): string | null {
  for (const match of markdown.matchAll(FENCE)) {
    const body = match[2]!;
    const first = body.split("\n").find((line) => line.trim() && !line.trim().startsWith("%%"));
    if (first && /^\s*stateDiagram(-v2)?\b/.test(first)) return body;
  }
  return null;
}

const STATE_ID = String.raw`(\[\*\]|[A-Za-z0-9_.\-]+|"[^"]+")`;
const TRANSITION = new RegExp(String.raw`^${STATE_ID}\s*-+>\s*${STATE_ID}\s*(?::\s*(.*))?$`);
const STATE_AS = /^state\s+"([^"]+)"\s+as\s+([A-Za-z0-9_.-]+)/;
const STATE_PSEUDO = /^state\s+([A-Za-z0-9_.-]+)\s+<<\s*(choice|fork|join)\s*>>/;
const STATE_BLOCK = /^state\s+([A-Za-z0-9_.-]+)\s*\{/;
const STATE_DESC = /^([A-Za-z0-9_.-]+)\s*:\s*(.*)$/;

function unquote(id: string) {
  return id.startsWith('"') ? id.slice(1, -1) : id;
}

/** Reads the diagram out of a workflow's Markdown; null when it has none, or one without phases. */
export function parseWorkflowDiagram(markdown: string | null | undefined): WorkflowDiagram | null {
  const source = markdown ? diagramSource(markdown) : null;
  if (!source) return null;
  const names = new Map<string, string>();
  const pseudo = new Set<string>();
  const seen: string[] = [];
  const raw: DiagramEdge[] = [];
  const see = (id: string) => {
    if (!seen.includes(id)) seen.push(id);
  };
  let inNote = false;
  for (const line of source.split("\n").map((text) => text.trim())) {
    if (!line || line.startsWith("%%") || /^stateDiagram/.test(line) || /^direction\b/.test(line) || line === "}") continue;
    if (inNote) {
      if (/^end\s+note$/.test(line)) inNote = false;
      continue;
    }
    if (/^note\b/.test(line)) {
      // A one-line note (`note right of A : text`) has its text after a colon.
      if (!line.includes(":")) inNote = true;
      continue;
    }
    if (/^classDef\b|^class\b/.test(line)) continue;
    let match = STATE_PSEUDO.exec(line);
    if (match) {
      pseudo.add(match[1]!);
      continue;
    }
    match = STATE_AS.exec(line);
    if (match) {
      names.set(match[2]!, match[1]!);
      see(match[2]!);
      continue;
    }
    match = STATE_BLOCK.exec(line);
    if (match) {
      see(match[1]!);
      continue;
    }
    match = TRANSITION.exec(line);
    if (match) {
      const from = match[1] === "[*]" ? null : unquote(match[1]!);
      const to = match[2] === "[*]" ? null : unquote(match[2]!);
      if (from) see(from);
      if (to) see(to);
      raw.push({ from, to, label: match[3]?.trim() || null });
      continue;
    }
    match = STATE_DESC.exec(line);
    if (match) see(match[1]!);
  }

  const phaseIds = seen.filter((id) => !pseudo.has(id));
  if (phaseIds.length === 0) return null;
  // Breadth first from the start, through pseudo-states, in the order transitions are written.
  const order: string[] = [];
  let frontier = raw.filter((edge) => edge.from === null && edge.to !== null).map((edge) => edge.to!);
  const visited = new Set<string>();
  while (frontier.length > 0) {
    const next: string[] = [];
    for (const id of frontier) {
      if (visited.has(id)) continue;
      visited.add(id);
      if (!pseudo.has(id)) order.push(id);
      for (const edge of raw) if (edge.from === id && edge.to !== null && !visited.has(edge.to)) next.push(edge.to);
    }
    frontier = next;
  }
  for (const id of phaseIds) if (!order.includes(id)) order.push(id);

  return {
    phases: order.map((id) => ({ id, name: names.get(id) ?? id })),
    edges: raw,
    ends: raw.some((edge) => edge.to === null),
  };
}

function normalize(text: string) {
  return text.trim().toLowerCase().replace(/[\s_-]+/g, " ");
}

/** The phase a case's free-text phase names: by state ID or display name, ignoring case and spacing. */
export function findPhase(diagram: WorkflowDiagram, phase: string | null | undefined): number {
  if (!phase) return -1;
  const wanted = normalize(phase);
  return diagram.phases.findIndex((entry) => normalize(entry.id) === wanted || normalize(entry.name) === wanted);
}

/** Transitions from a phase back to one before it (or to itself). */
export function diagramLoops(diagram: WorkflowDiagram): DiagramLoop[] {
  const index = new Map(diagram.phases.map((phase, at) => [phase.id, at] as const));
  const loops: DiagramLoop[] = [];
  for (const edge of diagram.edges) {
    if (!edge.from || !edge.to) continue;
    const from = index.get(edge.from);
    const to = index.get(edge.to);
    if (from === undefined || to === undefined || to > from) continue;
    loops.push({ from: diagram.phases[from]!, to: diagram.phases[to]!, label: edge.label });
  }
  return loops;
}

/**
 * The workflow's first paragraph of prose, for the template preview: the text before its first
 * heading, list or code block, skipping a title heading at the top.
 */
export function workflowSummary(markdown: string | null | undefined, max = 220): string {
  if (!markdown) return "";
  const lines: string[] = [];
  let fenced = false;
  for (const line of markdown.split("\n")) {
    const text = line.trim();
    if (/^(`{3,}|~{3,})/.test(text)) {
      fenced = !fenced;
      if (lines.length > 0) break;
      continue;
    }
    if (fenced) continue;
    if (!text) {
      if (lines.length > 0) break;
      continue;
    }
    if (/^#{1,6}\s/.test(text)) {
      if (lines.length > 0) break;
      continue;
    }
    if (/^([-*+]|\d+\.)\s/.test(text) || text.startsWith("|") || text.startsWith(">")) {
      if (lines.length > 0) break;
      continue;
    }
    lines.push(text);
  }
  const summary = lines.join(" ").replace(/\*\*|__|`/g, "");
  return summary.length > max ? `${summary.slice(0, max - 1).trimEnd()}…` : summary;
}
