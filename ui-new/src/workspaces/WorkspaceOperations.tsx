import { redactHomePathUserSegments } from "@paperclipai/adapter-utils/log-redaction";
import { createQuery } from "@tanstack/solid-query";
import { ChevronRight } from "lucide-solid";
import { createMemo, createSignal, For, Match, Show, Switch } from "solid-js";
import { heartbeatsApi, type WorkspaceOperationRow } from "@/api/heartbeats";
import { queryKeys } from "@/api/queryKeys";
import { parseLogSlice } from "@/runs/run-log";
import { agoLabel, clockTime, formatDuration } from "@/runs/run-model";
import { createdNote, hasDetails, OPERATION_TONE, operationDetails, phaseLabel, sortOperations } from "./operations-model";
import "./WorkspaceOperations.css";

/*
 * A list of workspace operations (operations-model.ts), newest first: each a line with its phase,
 * status, when and how long, opening to its command, folder, git details, output excerpts and its
 * full stored log, which loads when asked for and follows while the operation runs. Used by the
 * run modal (the run's operations) and the task's Workspace section (the workspace's).
 */

export function WorkspaceOperations(props: {
  operations: readonly WorkspaceOperationRow[];
  /** Hide the user's name in home-directory paths, per the instance setting. */
  censorUsername?: boolean;
  /** Show at most this many, with the rest a click away. */
  limit?: number;
}) {
  const [all, setAll] = createSignal(false);
  const sorted = createMemo(() => sortOperations(props.operations));
  const shown = () => (all() || !props.limit ? sorted() : sorted().slice(0, props.limit));
  const redact = (value: string) => redactHomePathUserSegments(value, { enabled: props.censorUsername ?? false });
  return (
    <div class="wo">
      <For each={shown()}>{(operation) => <Operation operation={operation} redact={redact} />}</For>
      <Show when={!all() && props.limit && sorted().length > props.limit}>
        <button type="button" class="wo-more" onClick={() => setAll(true)}>
          Show {sorted().length - props.limit!} older
        </button>
      </Show>
    </div>
  );
}

function Operation(props: { operation: WorkspaceOperationRow; redact: (value: string) => string }) {
  const [open, setOpen] = createSignal(false);
  const [logOpen, setLogOpen] = createSignal(false);
  const op = () => props.operation;
  const took = () => (op().finishedAt ? formatDuration(new Date(op().finishedAt!).getTime() - new Date(op().startedAt).getTime()) : null);
  const details = createMemo(() => operationDetails(op()));
  return (
    <details class="wo-op" data-status={op().status} onToggle={(event) => setOpen(event.currentTarget.open)}>
      <summary classList={{ "wo-plain": !hasDetails(op()) }}>
        <ChevronRight size={13} class="wo-chev" aria-hidden="true" />
        <span class="wo-phase">{phaseLabel(op().phase)}</span>
        <span class="wo-tag" data-tone={OPERATION_TONE[op().status] ?? "neutral"}>
          {op().status}
        </span>
        <span class="wo-when" title={new Date(op().startedAt).toLocaleString()}>
          {agoLabel(op().startedAt)}
          <Show when={took()}>{(text) => <> · {text()}</>}</Show>
          <Show when={op().exitCode !== null && op().exitCode !== 0}> · exit {op().exitCode}</Show>
        </span>
      </summary>
      <Show when={open()}>
        <div class="wo-body">
          <dl class="wo-props">
            <Show when={op().command}>
              {(command) => (
                <>
                  <dt>Command</dt>
                  <dd class="mono">{props.redact(command())}</dd>
                </>
              )}
            </Show>
            <Show when={op().cwd}>
              {(cwd) => (
                <>
                  <dt>Folder</dt>
                  <dd class="mono">{props.redact(cwd())}</dd>
                </>
              )}
            </Show>
            <For each={details()}>
              {(row) => (
                <>
                  <dt>{row.label}</dt>
                  <dd class="mono">{props.redact(row.value)}</dd>
                </>
              )}
            </For>
            <dt>Started</dt>
            <dd>{clockTime(op().startedAt)}</dd>
          </dl>
          <Show when={createdNote(op())}>{(note) => <p class="cap">{note()}</p>}</Show>
          <Show when={op().stderrExcerpt?.trim()}>
            <span class="wo-lbl">stderr</span>
            <pre class="wo-pre" data-tone="error">{props.redact(op().stderrExcerpt!)}</pre>
          </Show>
          <Show when={op().stdoutExcerpt?.trim()}>
            <span class="wo-lbl">stdout</span>
            <pre class="wo-pre">{props.redact(op().stdoutExcerpt!)}</pre>
          </Show>
          <Show when={op().logRef}>
            <button type="button" class="wo-toggle" aria-expanded={logOpen()} onClick={() => setLogOpen(!logOpen())}>
              {logOpen() ? "Hide the log" : "Show the full log"}
            </button>
            <Show when={logOpen()}>
              <OperationLog operation={op()} redact={props.redact} />
            </Show>
          </Show>
        </div>
      </Show>
    </details>
  );
}

function OperationLog(props: { operation: WorkspaceOperationRow; redact: (value: string) => string }) {
  const log = createQuery(() => ({
    queryKey: queryKeys.executionWorkspaces.operationLog(props.operation.id),
    queryFn: ({ signal }) => heartbeatsApi.workspaceOperationLog(props.operation.id, 0, 256_000, signal),
    refetchInterval: props.operation.status === "running" ? 2_000 : false,
    retry: false,
  }));
  const chunks = createMemo(() => (log.data?.content ? parseLogSlice(log.data.content.endsWith("\n") ? log.data.content : `${log.data.content}\n`).chunks : []));
  return (
    <Switch>
      <Match when={log.isPending}>
        <p class="cap">Loading the log…</p>
      </Match>
      <Match when={log.isError}>
        <p class="wo-error">The log couldn't be loaded: {(log.error as Error).message}</p>
      </Match>
      <Match when={chunks().length === 0}>
        <p class="cap">Nothing was logged.</p>
      </Match>
      <Match when={true}>
        <div class="wo-log" role="log" aria-label={`${phaseLabel(props.operation.phase)} log`}>
          <For each={chunks()}>
            {(chunk) => (
              <div class="wo-line" data-stream={chunk.stream}>
                <span class="wo-ts">{new Date(chunk.ts).toLocaleTimeString("en-US", { hour12: false })}</span>
                <span class="wo-text">{props.redact(chunk.chunk)}</span>
              </div>
            )}
          </For>
          <Show when={log.data?.nextOffset}>
            <p class="cap">The log goes on; the first 250 KB are shown.</p>
          </Show>
        </div>
      </Match>
    </Switch>
  );
}
