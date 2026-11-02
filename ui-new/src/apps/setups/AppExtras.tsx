import type { AppDefinition, ConnectionAgentInstructions, ConnectionInstructionTemplate, ToolConnection } from "@paperclipai/shared";
import { createMutation } from "@tanstack/solid-query";
import { ExternalLink } from "lucide-solid";
import { createEffect, createSignal, For, on, Show } from "solid-js";
import { toolsApi } from "@/api/tools";
import { Button } from "@/ui/Button";
import { Field, TextArea, TextInput } from "@/ui/Field";
import { Switch as Toggle } from "@/ui/Switch";
import { pushToast } from "@/ui/Toast";
import { Card, CopyValue } from "../chat/parts";
import { failureText, useRefreshTools } from "../shared";
import {
  honchoConfig,
  honchoWorkspace,
  INSTRUCTIONS_MAX_LENGTH,
  instructionsChanged,
  instructionsPayload,
  instructionsProblem,
  parseSheetLinks,
  resetInstructions,
  sameInstructions,
  savedInstructions,
  sheetIds,
  sheetsConfig,
  sheetUrl,
} from "./extras-model";
import "../chat/Chat.css";

/*
 * The smaller per-app pieces (the old UI's ConnectionInstructions, HonchoWorkspaceSettings and the
 * Google Sheets robot setup), for the connect form (Connect.tsx, through SetupExtras.tsx) and a
 * connection's Permissions tab (AppDetail.tsx):
 *
 * - Agent instructions: on or off, the text (edit it, or go back to the app's default).
 * - Honcho's workspace.
 * - Google Sheets through the robot account: the robot's email to share sheets with, then the
 *   links; on the connection, the sheets agents may open, with Add and Remove.
 */

// ---------------------------------------------------------------------------------------------
// Agent instructions

/** The instructions an app adds to its agents' prompts: on or off, and the text. */
export function InstructionsEditor(props: {
  provider: string;
  template: ConnectionInstructionTemplate | null | undefined;
  value: ConnectionAgentInstructions;
  onChange: (next: ConnectionAgentInstructions) => void;
  disabled?: boolean;
  /** Draw it without its own heading (inside a card that has one). */
  bare?: boolean;
}) {
  const [editing, setEditing] = createSignal(false);
  const problem = () => instructionsProblem(props.value);
  const body = () => (
    <>
      <Toggle
        checked={props.value.enabled}
        disabled={props.disabled}
        onChange={(enabled) => props.onChange({ ...props.value, enabled })}
        label={`Tell agents how to use ${props.provider}`}
        description="Added to the prompt of every agent that can use this connection."
      />
      <Show when={!props.value.enabled}>
        <p class="cx-note cx-note--warn">Agents can still use its tools, but won't get these instructions.</p>
      </Show>
      <Show
        when={editing()}
        fallback={<p class="ap-instructions">{props.value.text}</p>}
      >
        <TextArea
          aria-label="Instructions"
          rows={7}
          maxLength={INSTRUCTIONS_MAX_LENGTH}
          disabled={props.disabled}
          value={props.value.text}
          onInput={(event) => props.onChange({ ...props.value, text: event.currentTarget.value })}
        />
        <span class="fhelp">
          {props.value.text.length} of {INSTRUCTIONS_MAX_LENGTH} characters
        </span>
      </Show>
      <Show when={problem()}>
        <p class="cx-note cx-note--error" role="alert">
          {problem()}
        </p>
      </Show>
      <div class="ap-inline">
        <Button size="compact" variant="quiet" disabled={props.disabled} onClick={() => setEditing(!editing())}>
          {editing() ? "Done editing" : "Edit instructions"}
        </Button>
        <Show when={props.template && instructionsChanged(props.value, props.template)}>
          <Button size="compact" variant="quiet" disabled={props.disabled} onClick={() => props.onChange(resetInstructions(props.value, props.template!))}>
            Reset to default
          </Button>
        </Show>
      </div>
    </>
  );
  return (
    <Show when={!props.bare} fallback={<div class="ap-instructions-body">{body()}</div>}>
      <Field label="Agent instructions">
        <div class="ap-instructions-body">{body()}</div>
      </Field>
    </Show>
  );
}

/** A connection's agent instructions, saved with `PATCH tool-connections/:id`. */
export function InstructionsCard(props: { connection: ToolConnection; app: AppDefinition | null; canConfigure: boolean }) {
  const refresh = useRefreshTools();
  const template = () => props.app?.agentInstructions ?? null;
  const saved = () => savedInstructions(props.connection, template());
  const [draft, setDraft] = createSignal<ConnectionAgentInstructions | null>(null);
  // A save (or another person's) that changes them: start from what's saved again. A refetch with the
  // same instructions keeps the edit.
  createEffect(
    on(saved, (next, previous) => {
      if (!sameInstructions(next, previous)) setDraft(null);
    }, { defer: true }),
  );
  const value = () => draft() ?? saved();
  const dirty = () => Boolean(draft()) && !sameInstructions(draft(), saved());
  const save = createMutation(() => ({
    mutationFn: () => toolsApi.updateConnection(props.connection.id, { agentInstructions: instructionsPayload(value()!) }),
    onSuccess: () => {
      setDraft(null);
      pushToast({ tone: "success", title: "Instructions saved" });
    },
    onError: (error) => pushToast({ tone: "error", title: "Couldn't save the instructions", body: failureText(error, "Please try again.") }),
    onSettled: () => refresh(),
  }));
  return (
    <Show when={value()}>
      {(current) => (
        <Card
          title="Agent instructions"
          description={`What agents that can use ${props.connection.name} are told about it.`}
          footer={
            !props.canConfigure ? (
              <span class="cx-note">Only a connection manager can change these.</span>
            ) : dirty() ? (
              <span class="ap-actions-end">
                <Button size="compact" variant="quiet" disabled={save.isPending} onClick={() => setDraft(null)}>
                  Discard
                </Button>
                <Button size="compact" variant="primary" disabled={save.isPending || Boolean(instructionsProblem(current()))} onClick={() => save.mutate()}>
                  {save.isPending ? "Saving…" : "Save instructions"}
                </Button>
              </span>
            ) : undefined
          }
        >
          <InstructionsEditor
            bare
            provider={props.app?.name ?? props.connection.name}
            template={template()}
            value={current()}
            onChange={setDraft}
            disabled={!props.canConfigure || save.isPending}
          />
        </Card>
      )}
    </Show>
  );
}

// ---------------------------------------------------------------------------------------------
// Honcho

/** The Honcho workspace agents use; without one, Honcho's instructions aren't added. */
export function HonchoCard(props: { connection: ToolConnection; canConfigure: boolean }) {
  const refresh = useRefreshTools();
  const saved = () => honchoWorkspace(props.connection);
  const [draft, setDraft] = createSignal<string | null>(null);
  createEffect(on(saved, () => setDraft(null), { defer: true }));
  const value = () => draft() ?? saved();
  const dirty = () => draft() !== null && draft()!.trim() !== saved();
  const save = createMutation(() => ({
    mutationFn: () => toolsApi.updateConnection(props.connection.id, { config: honchoConfig(props.connection, value()) }),
    onSuccess: () => {
      setDraft(null);
      pushToast({ tone: "success", title: "Workspace saved" });
    },
    onError: (error) => pushToast({ tone: "error", title: "Couldn't save the workspace", body: failureText(error, "Please try again.") }),
    onSettled: () => refresh(),
  }));
  return (
    <Card
      title="Honcho workspace"
      description="The workspace agents remember into and recall from."
      footer={
        dirty() ? (
          <span class="ap-actions-end">
            <Button size="compact" variant="quiet" disabled={save.isPending} onClick={() => setDraft(null)}>
              Discard
            </Button>
            <Button size="compact" variant="primary" disabled={save.isPending || !value().trim()} onClick={() => save.mutate()}>
              {save.isPending ? "Saving…" : "Save workspace"}
            </Button>
          </span>
        ) : undefined
      }
    >
      <Field label="Workspace ID" for="ap-honcho-workspace">
        <TextInput
          id="ap-honcho-workspace"
          maxLength={512}
          autocomplete="off"
          placeholder="Workspace ID"
          disabled={!props.canConfigure || save.isPending}
          value={value()}
          onInput={(event) => setDraft(event.currentTarget.value)}
        />
      </Field>
      <Show when={!value().trim()}>
        <p class="cx-note cx-note--warn">Enter a workspace so agents get Honcho's instructions. Its tools stay available either way.</p>
      </Show>
    </Card>
  );
}

// ---------------------------------------------------------------------------------------------
// Google Sheets through the robot account

/** The connect form's robot setup: the email to share sheets with, then the links. */
export function SheetsRobotFields(props: { robotEmail: string | null | undefined; links: string; onLinks: (next: string) => void; disabled?: boolean }) {
  const parsed = () => parseSheetLinks(props.links);
  return (
    <>
      <CopyValue
        label="Share each sheet with this email"
        value={props.robotEmail}
        missing="Google Sheets' robot account isn't set up on this Paperclip, so this way can't connect yet."
      />
      <p class="cx-note">In Google Sheets, choose Share and add this email as an Editor. Then paste the sheets' links below.</p>
      <Field
        label="Links to the sheets you shared"
        for="ap-sheets-links"
        help={
          parsed().ids.length > 0
            ? `${parsed().ids.length} ${parsed().ids.length === 1 ? "sheet" : "sheets"} ready to connect.`
            : "One link per line. Both …/edit and …/edit#gid=… links work."
        }
      >
        <TextArea
          id="ap-sheets-links"
          rows={4}
          placeholder="https://docs.google.com/spreadsheets/d/…"
          disabled={props.disabled}
          value={props.links}
          onInput={(event) => props.onLinks(event.currentTarget.value)}
        />
      </Field>
    </>
  );
}

/** A robot-account connection's sheets: agents can open only these. */
export function SheetsCard(props: { connection: ToolConnection; canConfigure: boolean }) {
  const refresh = useRefreshTools();
  const ids = () => sheetIds(props.connection);
  const [draft, setDraft] = createSignal("");
  const [error, setError] = createSignal<string | null>(null);
  const save = createMutation(() => ({
    mutationFn: (next: string[]) => toolsApi.updateConnection(props.connection.id, { config: sheetsConfig(props.connection.config, next) }),
    onSuccess: () => setDraft(""),
    onError: (cause) => pushToast({ tone: "error", title: "Couldn't change the sheets", body: failureText(cause, "Please try again.") }),
    onSettled: () => refresh(),
  }));
  const robotEmail = () => (typeof props.connection.config?.robotEmail === "string" ? props.connection.config.robotEmail : null);
  const add = (event: Event) => {
    event.preventDefault();
    const parsed = parseSheetLinks(draft());
    if (parsed.ids.length === 0) return setError("Paste a Google Sheets link.");
    if (parsed.invalidCount > 0) return setError("That doesn't look like a Google Sheets link.");
    setError(null);
    save.mutate([...new Set([...ids(), ...parsed.ids])]);
  };
  return (
    <Card title="Sheets agents can open" description="Agents can open only the sheets listed here, and only once each is shared with the robot account.">
      <Show when={robotEmail()}>{(email) => <CopyValue label="Robot account" value={email()} />}</Show>
      <Show when={ids().length > 0} fallback={<p class="cx-static">No sheets yet.</p>}>
        <ul class="ch-list" aria-label="Sheets agents can open">
          <For each={ids()}>
            {(id) => (
              <li class="ch-row">
                <span class="ch-row-main">
                  <a class="ch-link" href={sheetUrl(id)} target="_blank" rel="noopener noreferrer">
                    Open sheet <ExternalLink size={11} aria-hidden="true" />
                  </a>
                  <span class="ch-row-meta mono">{id}</span>
                </span>
                <Show when={props.canConfigure}>
                  <Button
                    size="compact"
                    variant="quiet"
                    disabled={save.isPending || ids().length <= 1}
                    title={ids().length <= 1 ? "Add another sheet before removing this one." : undefined}
                    onClick={() => save.mutate(ids().filter((current) => current !== id))}
                  >
                    Remove
                  </Button>
                </Show>
              </li>
            )}
          </For>
        </ul>
      </Show>
      <Show when={props.canConfigure}>
        <form class="ap-inline" onSubmit={add}>
          <TextInput
            aria-label="A Google Sheets link"
            placeholder="https://docs.google.com/spreadsheets/d/…"
            value={draft()}
            disabled={save.isPending}
            onInput={(event) => {
              setDraft(event.currentTarget.value);
              setError(null);
            }}
          />
          <Button type="submit" size="compact" disabled={save.isPending || !draft().trim()}>
            {save.isPending ? "Saving…" : "Add sheet"}
          </Button>
        </form>
        <Show when={error()}>
          <p class="cx-note cx-note--error" role="alert">
            {error()}
          </p>
        </Show>
      </Show>
    </Card>
  );
}
