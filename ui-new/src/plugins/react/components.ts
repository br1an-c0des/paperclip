import type { Agent, CompactIssue, Project } from "@paperclipai/shared";
import type {
  ActionBarProps,
  AssigneePickerProps,
  DataTableProps,
  ErrorBoundaryProps,
  FileTreeNode,
  FileTreeProps,
  IssuesListProps,
  JsonTreeProps,
  KeyValueListProps,
  LogViewProps,
  ManagedRoutinesListProps,
  MarkdownBlockProps,
  MarkdownEditorProps,
  MetricCardProps,
  ProjectPickerProps,
  SpinnerProps,
  StatusBadgeProps,
  TimeseriesChartProps,
} from "@paperclipai/plugin-sdk/ui";
import { Component, createElement as h, Fragment, useEffect, useMemo, useRef, useState, type ErrorInfo, type ReactNode } from "react";
import type { CompanyUserDirectoryEntry } from "@/api/access";
import { api } from "@/api/client";
import { issuePath } from "@/api/issues";
import { queryKeys } from "@/api/queryKeys";
import { renderMarkdown } from "@/ui/Markdown";
import { useHostContext, usePluginAction } from "./bridge";
import { useHostQuery } from "./query";

/*
 * The shared components the SDK promises plugins (`@paperclipai/plugin-sdk/ui`, PLUGIN_SPEC.md
 * §19.6), as small React components in the Capsule Stack look (sdk.css, ui-new's tokens). The old
 * UI wraps its own React components for some of them (IssuesList, the pickers, FileTree); these are
 * written fresh, with the props the SDK declares.
 */

const cx = (...names: (string | false | null | undefined)[]) => names.filter(Boolean).join(" ");

export function MetricCard(props: MetricCardProps) {
  const trend = props.trend;
  return h(
    "div",
    { className: "pcs-metric" },
    h("div", { className: "pcs-metric-label" }, props.label),
    h(
      "div",
      { className: "pcs-metric-value" },
      `${props.value}${props.unit ?? ""}`,
      trend
        ? h(
            "span",
            { className: cx("pcs-metric-trend", `pcs-metric-trend--${trend.direction}`) },
            trend.direction === "up" ? "↑" : trend.direction === "down" ? "↓" : "→",
            trend.percentage !== undefined ? ` ${trend.percentage}%` : null,
          )
        : null,
    ),
    props.sparkline && props.sparkline.length > 1 ? h(Sparkline, { values: props.sparkline }) : null,
  );
}

function Sparkline(props: { values: number[] }) {
  const max = Math.max(...props.values);
  const min = Math.min(...props.values);
  const span = max - min || 1;
  const points = props.values.map((value, index) => `${(index / (props.values.length - 1)) * 100},${28 - ((value - min) / span) * 26}`).join(" ");
  return h("svg", { className: "pcs-spark", viewBox: "0 0 100 30", preserveAspectRatio: "none", "aria-hidden": true }, h("polyline", { points, fill: "none" }));
}

export function StatusBadge(props: StatusBadgeProps) {
  return h("span", { className: cx("pcs-badge", `pcs-badge--${props.status}`) }, props.label);
}

export function DataTable(props: DataTableProps) {
  const [sort, setSort] = useState<{ key: string; direction: "asc" | "desc" } | null>(null);
  if (props.loading) return h("div", { className: "pcs-empty" }, h(Spinner, { size: "sm" }), " Loading…");
  if (!props.rows.length) return h("div", { className: "pcs-empty" }, props.emptyMessage ?? "No rows.");
  const columns = props.columns;
  const template = columns.map((column) => column.width ?? "minmax(0, 1fr)").join(" ");
  const pageCount = props.pageSize && props.totalCount ? Math.ceil(props.totalCount / props.pageSize) : 0;
  return h(
    "div",
    { className: "pcs-table", role: "table" },
    h(
      "div",
      { className: "pcs-table-head", role: "row", style: { gridTemplateColumns: template } },
      columns.map((column) =>
        h(
          "div",
          { key: column.key, role: "columnheader" },
          column.sortable && props.onSort
            ? h(
                "button",
                {
                  type: "button",
                  className: "pcs-link-button",
                  onClick: () => {
                    const direction = sort?.key === column.key && sort.direction === "asc" ? "desc" : "asc";
                    setSort({ key: column.key, direction });
                    props.onSort!(column.key, direction);
                  },
                },
                column.header,
                sort?.key === column.key ? (sort.direction === "asc" ? " ↑" : " ↓") : null,
              )
            : column.header,
        ),
      ),
    ),
    props.rows.map((row, index) =>
      h(
        "div",
        { key: String((row as { id?: unknown }).id ?? index), className: "pcs-table-row", role: "row", style: { gridTemplateColumns: template } },
        columns.map((column) =>
          h(
            "div",
            { key: column.key, role: "cell", className: "pcs-table-cell" },
            h("span", { className: "pcs-table-cell-label" }, column.header),
            column.render ? column.render(row[column.key], row) : String(row[column.key] ?? ""),
          ),
        ),
      ),
    ),
    pageCount > 1 && props.onPageChange
      ? h(
          "div",
          { className: "pcs-table-foot" },
          h("button", { type: "button", className: "pcs-btn", disabled: (props.page ?? 0) <= 0, onClick: () => props.onPageChange!((props.page ?? 0) - 1) }, "Previous"),
          h("span", null, `Page ${(props.page ?? 0) + 1} of ${pageCount}`),
          h("button", { type: "button", className: "pcs-btn", disabled: (props.page ?? 0) >= pageCount - 1, onClick: () => props.onPageChange!((props.page ?? 0) + 1) }, "Next"),
        )
      : null,
  );
}

export function TimeseriesChart(props: TimeseriesChartProps) {
  const height = props.height ?? 200;
  if (props.loading) return h("div", { className: "pcs-empty", style: { height } }, h(Spinner, { size: "sm" }));
  const values = props.data.map((point) => point.value);
  const max = Math.max(0, ...values) || 1;
  const width = 600;
  const step = props.data.length > 1 ? width / (props.data.length - 1) : width;
  const y = (value: number) => height - 8 - (value / max) * (height - 16);
  const bar = props.type === "bar";
  const barWidth = Math.max(2, width / Math.max(props.data.length, 1) - 4);
  return h(
    "figure",
    { className: "pcs-chart" },
    props.title ? h("figcaption", { className: "pcs-chart-title" }, props.title) : null,
    h(
      "svg",
      { viewBox: `0 0 ${width} ${height}`, preserveAspectRatio: "none", style: { height }, role: "img", "aria-label": props.title ?? props.yLabel ?? "Chart" },
      bar
        ? props.data.map((point, index) =>
            h("rect", { key: point.timestamp + index, x: (index * width) / props.data.length + 2, y: y(point.value), width: barWidth, height: height - 8 - y(point.value), rx: 3 }, h("title", null, `${point.label ?? point.timestamp}: ${point.value}`)),
          )
        : h("polyline", { fill: "none", points: props.data.map((point, index) => `${index * step},${y(point.value)}`).join(" ") }),
    ),
    props.yLabel ? h("div", { className: "pcs-chart-axis" }, props.yLabel) : null,
  );
}

function wikiLinks(content: string, props: MarkdownBlockProps) {
  if (!props.enableWikiLinks) return content;
  return content.replace(/\[\[([^\]|]+)(?:\|([^\]]+))?\]\]/g, (whole, target: string, label?: string) => {
    const text = (label ?? target).trim();
    const href = props.resolveWikiLinkHref ? props.resolveWikiLinkHref(target.trim(), text) : `${props.wikiLinkRoot ?? ""}/${encodeURIComponent(target.trim())}`;
    return href ? `[${text}](${href})` : text;
  });
}

export function MarkdownBlock(props: MarkdownBlockProps) {
  const html = useMemo(() => renderMarkdown(wikiLinks(props.content ?? "", props)), [props.content, props.enableWikiLinks, props.wikiLinkRoot, props.resolveWikiLinkHref]);
  return h("div", { className: cx("md", props.className), dangerouslySetInnerHTML: { __html: html } });
}

export function MarkdownEditor(props: MarkdownEditorProps) {
  return h(
    "div",
    { className: cx("pcs-editor", props.bordered !== false && "pcs-editor--bordered", props.className) },
    h("textarea", {
      className: cx("pcs-editor-input", props.contentClassName),
      value: props.value,
      placeholder: props.placeholder,
      readOnly: props.readOnly,
      onBlur: props.onBlur,
      onChange: (event: { currentTarget: HTMLTextAreaElement }) => props.onChange(event.currentTarget.value),
      onKeyDown: (event: { key: string; metaKey: boolean; ctrlKey: boolean; preventDefault: () => void }) => {
        if (event.key === "Enter" && (event.metaKey || event.ctrlKey) && props.onSubmit) {
          event.preventDefault();
          props.onSubmit();
        }
      },
    }),
  );
}

export function KeyValueList(props: KeyValueListProps) {
  return h(
    "dl",
    { className: "pcs-kv" },
    props.pairs.map((pair, index) => h(Fragment, { key: `${pair.label}:${index}` }, h("dt", null, pair.label), h("dd", null, pair.value))),
  );
}

export function ActionBar(props: ActionBarProps) {
  return h("div", { className: "pcs-actions" }, props.actions.map((action) => h(ActionButton, { key: action.actionKey + action.label, action, onSuccess: props.onSuccess, onError: props.onError })));
}

function ActionButton(props: { action: ActionBarProps["actions"][number]; onSuccess?: ActionBarProps["onSuccess"]; onError?: ActionBarProps["onError"] }) {
  const run = usePluginAction(props.action.actionKey);
  const [busy, setBusy] = useState(false);
  const variant = props.action.variant ?? "default";
  return h(
    "button",
    {
      type: "button",
      className: cx("pcs-btn", variant === "primary" && "pcs-btn--primary", variant === "destructive" && "pcs-btn--danger"),
      disabled: busy,
      onClick: async () => {
        if (props.action.confirm && !window.confirm(props.action.confirmMessage ?? `${props.action.label}?`)) return;
        setBusy(true);
        try {
          props.onSuccess?.(props.action.actionKey, await run(props.action.params));
        } catch (error) {
          props.onError?.(props.action.actionKey, error);
        } finally {
          setBusy(false);
        }
      },
    },
    props.action.label,
  );
}

export function LogView(props: LogViewProps) {
  const ref = useRef<HTMLDivElement | null>(null);
  useEffect(() => {
    if (props.autoScroll && ref.current) ref.current.scrollTop = ref.current.scrollHeight;
  }, [props.autoScroll, props.entries.length]);
  if (props.loading && !props.entries.length) return h("div", { className: "pcs-empty" }, h(Spinner, { size: "sm" }), " Loading…");
  return h(
    "div",
    { ref, className: "pcs-log mono", style: { maxHeight: props.maxHeight ?? "400px" } },
    props.entries.length === 0
      ? h("div", { className: "pcs-muted" }, "No log lines.")
      : props.entries.map((entry, index) =>
          h(
            "div",
            { key: index, className: cx("pcs-log-line", `pcs-log-line--${entry.level}`) },
            h("span", { className: "pcs-log-time" }, formatTime(entry.timestamp)),
            h("span", { className: "pcs-log-level" }, entry.level),
            h("span", { className: "pcs-log-message" }, entry.message, entry.meta ? ` ${JSON.stringify(entry.meta)}` : null),
          ),
        ),
  );
}

function formatTime(value: string) {
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? value : date.toLocaleTimeString(undefined, { hour: "2-digit", minute: "2-digit", second: "2-digit" });
}

export function JsonTree(props: JsonTreeProps) {
  return h("div", { className: "pcs-json mono" }, h(JsonNode, { value: props.data, depth: 0, expandDepth: props.defaultExpandDepth ?? 2, name: null }));
}

function JsonNode(props: { value: unknown; depth: number; expandDepth: number; name: string | null }): ReactNode {
  const label = props.name === null ? null : h("span", { className: "pcs-json-key" }, `${props.name}: `);
  const value = props.value;
  if (value === null || typeof value !== "object") {
    return h("div", { className: "pcs-json-leaf" }, label, h("span", { className: `pcs-json-${value === null ? "null" : typeof value}` }, JSON.stringify(value) ?? String(value)));
  }
  const entries = Array.isArray(value) ? value.map((item, index) => [String(index), item] as const) : Object.entries(value as Record<string, unknown>);
  const summary = Array.isArray(value) ? `[${entries.length}]` : `{${entries.length}}`;
  return h(
    "details",
    { className: "pcs-json-node", open: props.depth < props.expandDepth },
    h("summary", null, label, h("span", { className: "pcs-muted" }, summary)),
    entries.map(([key, item]) => h(JsonNode, { key, value: item, depth: props.depth + 1, expandDepth: props.expandDepth, name: key })),
  );
}

export function Spinner(props: SpinnerProps) {
  return h("span", { className: cx("pcs-spinner", `pcs-spinner--${props.size ?? "md"}`), role: "status", "aria-label": props.label ?? "Loading" });
}

type BoundaryState = { error: Error | null };

export class ErrorBoundary extends Component<ErrorBoundaryProps, BoundaryState> {
  override state: BoundaryState = { error: null };

  static getDerivedStateFromError(error: Error): BoundaryState {
    return { error };
  }

  override componentDidCatch(error: Error, info: ErrorInfo) {
    this.props.onError?.(error, info);
  }

  override render() {
    if (this.state.error) return this.props.fallback ?? h("div", { className: "pcs-error" }, "This part of the plugin failed to render.");
    return this.props.children;
  }
}

const toSet = (paths?: ReadonlySet<string> | readonly string[] | null) => new Set(paths ?? []);

export function FileTree(props: FileTreeProps) {
  if (props.loading) return h("div", { className: "pcs-empty" }, h(Spinner, { size: "sm" }), " Loading files…");
  if (props.error)
    return h(
      "div",
      { className: "pcs-error", role: "alert" },
      props.error.message,
      props.error.retry ? h("button", { type: "button", className: "pcs-btn", onClick: props.error.retry }, "Try again") : null,
    );
  if (!props.nodes.length) {
    return h("div", { className: "pcs-empty" }, h("strong", null, props.empty?.title ?? "No files"), props.empty?.description ? h("div", { className: "pcs-muted" }, props.empty.description) : null);
  }
  const expanded = toSet(props.expandedPaths);
  const checked = toSet(props.checkedPaths);
  return h("ul", { className: cx("pcs-tree", props.wrapLabels && "pcs-tree--wrap"), role: "tree", "aria-label": props.ariaLabel ?? "Files" }, props.nodes.map((node) => h(FileTreeRow, { key: node.path, node, depth: 0, expanded, checked, tree: props })));
}

function FileTreeRow(props: { node: FileTreeNode; depth: number; expanded: Set<string>; checked: Set<string>; tree: FileTreeProps }): ReactNode {
  const { node, tree } = props;
  const dir = node.kind === "dir";
  const open = dir && props.expanded.has(node.path);
  const badge = tree.fileBadges?.[node.path];
  const tone = tree.fileTones?.[node.path];
  return h(
    "li",
    { role: "treeitem", "aria-expanded": dir ? open : undefined, "aria-selected": !dir ? tree.selectedFile === node.path : undefined },
    h(
      "div",
      { className: cx("pcs-tree-row", tree.selectedFile === node.path && "pcs-tree-row--selected", tone && tone !== "default" && `pcs-tree-row--${tone}`), style: { paddingLeft: 8 + props.depth * 14 } },
      tree.showCheckboxes
        ? h("input", { type: "checkbox", checked: props.checked.has(node.path), onChange: () => tree.onToggleCheck?.(node.path, node.kind), "aria-label": `Select ${node.name}` })
        : null,
      h(
        "button",
        { type: "button", className: "pcs-tree-name", onClick: () => (dir ? tree.onToggleDir?.(node.path) : tree.onSelectFile?.(node.path)) },
        h("span", { className: "pcs-tree-caret", "aria-hidden": true }, dir ? (open ? "▾" : "▸") : ""),
        node.name,
      ),
      badge ? h("span", { className: cx("pcs-badge", `pcs-badge--${badge.status}`), title: badge.tooltip }, badge.label) : null,
    ),
    open && node.children.length
      ? h("ul", { role: "group" }, node.children.map((child) => h(FileTreeRow, { key: child.path, node: child, depth: props.depth + 1, expanded: props.expanded, checked: props.checked, tree })))
      : null,
  );
}

const STATUS_GRADIENT: Record<string, string> = {
  backlog: "ash",
  todo: "ember",
  in_progress: "ion",
  in_review: "orchid",
  blocked: "flare",
  done: "lagoon",
  cancelled: "ash",
};

const statusLabel = (status: string) => status.replace(/_/g, " ").replace(/^\w/, (char) => char.toUpperCase());

function issueQuery(filters: Record<string, unknown>) {
  const params = new URLSearchParams({ view: "compact", sortField: "updated", sortDir: "desc" });
  for (const [key, value] of Object.entries(filters)) {
    if (value === undefined || value === null || value === "" || value === false) continue;
    params.set(key, String(value));
  }
  return params.toString();
}

export function IssuesList(props: IssuesListProps) {
  const host = useHostContext();
  const companyId = props.companyId ?? host.companyId;
  const filters = { ...(props.filters ?? {}), projectId: props.filters?.projectId ?? props.projectId ?? undefined };
  const query = issueQuery(filters);
  const issues = useHostQuery<CompactIssue[]>(
    ["issues", companyId ?? "__none__", "plugin-sdk", query],
    (signal) => api.get<CompactIssue[]>(`/companies/${companyId}/issues?${query}`, { signal }),
    Boolean(companyId),
  );
  const [search, setSearch] = useState(props.initialSearch ?? "");
  const visible = useMemo(() => {
    const needle = search.trim().toLowerCase();
    const rows = issues.data ?? [];
    if (!needle || props.searchWithinLoadedIssues === false) return rows;
    return rows.filter((issue) => `${issue.identifier ?? ""} ${issue.title}`.toLowerCase().includes(needle));
  }, [issues.data, search, props.searchWithinLoadedIssues]);
  if (!companyId) return h("div", { className: "pcs-empty" }, "Choose an organization to see its tasks.");
  return h(
    "div",
    { className: "pcs-issues" },
    h("input", { className: "pcs-input", type: "search", placeholder: "Search tasks", value: search, onChange: (event: { currentTarget: HTMLInputElement }) => setSearch(event.currentTarget.value), "aria-label": "Search tasks" }),
    issues.isLoading
      ? h("div", { className: "pcs-empty" }, h(Spinner, { size: "sm" }), " Loading tasks…")
      : issues.error
        ? h("div", { className: "pcs-error", role: "alert" }, issues.error.message)
        : visible.length === 0
          ? h("div", { className: "pcs-empty" }, "No tasks.")
          : h(
              "ul",
              { className: "pcs-issue-list" },
              visible.map((issue) =>
                h(
                  "li",
                  { key: issue.id },
                  h(
                    "a",
                    { className: "pcs-issue", href: host.companyPrefix ? issuePath(host.companyPrefix, issue) : undefined, onClick: navigateWithHost },
                    h("span", { className: `pcs-capsule pcs-capsule--${STATUS_GRADIENT[issue.status] ?? "ash"}`, "aria-hidden": true }),
                    h("span", { className: "pcs-issue-id mono" }, issue.identifier ?? ""),
                    h("span", { className: "pcs-issue-title" }, issue.title),
                    h("span", { className: "pcs-muted" }, statusLabel(issue.status)),
                  ),
                ),
              ),
            ),
  );
}

/** Same-origin links inside shared components go through the host router. */
function navigateWithHost(event: { currentTarget: HTMLAnchorElement; button: number; metaKey: boolean; ctrlKey: boolean; shiftKey: boolean; altKey: boolean; preventDefault: () => void }) {
  if (event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
  const href = event.currentTarget.getAttribute("href");
  if (!href) return;
  event.preventDefault();
  void import("../host").then(({ hostStore }) => hostStore.navigate(href));
}

type PickerOption = { value: string; label: string };

function Picker(props: { value: string; options: PickerOption[]; noneLabel: string; placeholder: string; className?: string; onChange: (value: string) => void; onConfirm?: () => void; label: string }) {
  return h(
    "select",
    {
      className: cx("pcs-select", props.className),
      value: props.value,
      "aria-label": props.label,
      onChange: (event: { currentTarget: HTMLSelectElement }) => {
        props.onChange(event.currentTarget.value);
        props.onConfirm?.();
      },
    },
    h("option", { value: "" }, props.value ? props.noneLabel : props.placeholder),
    props.options.map((option) => h("option", { key: option.value, value: option.value }, option.label)),
  );
}


export function AssigneePicker(props: AssigneePickerProps) {
  const host = useHostContext();
  const companyId = props.companyId ?? host.companyId;
  const includeUsers = props.includeUsers !== false;
  const agents = useHostQuery<Agent[]>(queryKeys.agents.list(companyId ?? "__none__"), () => api.get<Agent[]>(`/companies/${companyId}/agents`), Boolean(companyId));
  const users = useHostQuery<{ users?: CompanyUserDirectoryEntry[] }>(
    queryKeys.access.userDirectory(companyId ?? "__none__"),
    () => api.get<{ users?: CompanyUserDirectoryEntry[] }>(`/companies/${companyId}/user-directory`),
    Boolean(companyId) && includeUsers,
  );
  const options: PickerOption[] = [
    ...(includeUsers ? (users.data?.users ?? []).map((entry) => ({
          value: `user:${entry.principalId}`,
          label: entry.principalId === host.userId ? "You" : (entry.user?.name ?? entry.user?.email ?? entry.principalId),
        })) : []),
    ...(agents.data ?? [])
      .filter((agent) => props.includeTerminatedAgents || agent.status !== "terminated")
      .map((agent) => ({ value: `agent:${agent.id}`, label: agent.name })),
  ];
  return h(Picker, {
    value: props.value,
    options,
    noneLabel: props.noneLabel ?? "No one",
    placeholder: props.placeholder ?? "Assignee",
    className: props.className,
    label: props.placeholder ?? "Assignee",
    onConfirm: props.onConfirm,
    onChange: (value) => {
      const [kind, id] = value.split(":");
      props.onChange(value, { assigneeAgentId: kind === "agent" ? (id ?? null) : null, assigneeUserId: kind === "user" ? (id ?? null) : null });
    },
  });
}

export function ProjectPicker(props: ProjectPickerProps) {
  const host = useHostContext();
  const companyId = props.companyId ?? host.companyId;
  const projects = useHostQuery<Project[]>(queryKeys.projects.list(companyId ?? "__none__"), () => api.get<Project[]>(`/companies/${companyId}/projects`), Boolean(companyId));
  const options = (projects.data ?? []).filter((project) => props.includeArchived || !project.archivedAt).map((project) => ({ value: project.id, label: project.name }));
  return h(Picker, {
    value: props.value,
    options,
    noneLabel: props.noneLabel ?? "No project",
    placeholder: props.placeholder ?? "Project",
    className: props.className,
    label: props.placeholder ?? "Project",
    onConfirm: props.onConfirm,
    onChange: props.onChange,
  });
}

export function ManagedRoutinesList(props: ManagedRoutinesListProps) {
  if (!props.routines.length) return h("div", { className: "pcs-empty" }, props.emptyMessage ?? "No recurring tasks yet.");
  const agentName = (id?: string | null) => props.agents?.find((agent) => agent.id === id)?.name;
  const projectName = (id?: string | null) => props.projects?.find((project) => project.id === id)?.name;
  return h(
    "ul",
    { className: "pcs-routines" },
    props.routines.map((routine) => {
      const enabled = routine.status === "active";
      const meta = [routine.cronExpression, agentName(routine.assigneeAgentId), projectName(routine.projectId), routine.lastRunAt ? `last run ${new Date(routine.lastRunAt).toLocaleString()}` : null].filter(Boolean).join(" · ");
      return h(
        "li",
        { key: routine.key, className: "pcs-routine" },
        h(
          "div",
          { className: "pcs-routine-text" },
          routine.href ? h("a", { href: routine.href, onClick: navigateWithHost, className: "pcs-strong" }, routine.title) : h("span", { className: "pcs-strong" }, routine.title),
          h("span", { className: "pcs-muted" }, meta || statusLabel(routine.status)),
          routine.missingRefs?.length ? h("span", { className: "pcs-warn" }, `Missing: ${routine.missingRefs.map((ref) => `${ref.resourceKind} ${ref.resourceKey}`).join(", ")}`) : null,
          routine.defaultDrift?.changedFields.length ? h("span", { className: "pcs-muted" }, `Changed from the plugin's defaults: ${routine.defaultDrift.changedFields.join(", ")}`) : null,
        ),
        h(
          "div",
          { className: "pcs-actions" },
          h(StatusBadge, { label: statusLabel(routine.status), status: enabled ? "ok" : routine.status === "paused" ? "pending" : "info" }),
          props.onRunNow ? h("button", { type: "button", className: "pcs-btn", disabled: props.runningRoutineKey === routine.key, onClick: () => props.onRunNow!(routine) }, props.runningRoutineKey === routine.key ? "Running…" : "Run now") : null,
          props.onToggleEnabled
            ? h("button", { type: "button", className: "pcs-btn", disabled: props.statusMutationRoutineKey === routine.key, onClick: () => props.onToggleEnabled!(routine, !enabled) }, enabled ? "Pause" : "Turn on")
            : null,
          props.onReconcile && routine.missingRefs?.length ? h("button", { type: "button", className: "pcs-btn", disabled: props.reconcilingRoutineKey === routine.key, onClick: () => props.onReconcile!(routine) }, "Repair") : null,
          props.onReset && routine.defaultDrift ? h("button", { type: "button", className: "pcs-btn", disabled: props.resettingRoutineKey === routine.key, onClick: () => props.onReset!(routine) }, "Reset") : null,
        ),
      );
    }),
  );
}
