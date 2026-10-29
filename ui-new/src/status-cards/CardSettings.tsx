import type { StatusCard, StatusCardRefreshPolicy } from "@paperclipai/shared";
import { Trash2 } from "lucide-solid";
import { createEffect, createSignal, For, on, Show, type JSX } from "solid-js";
import { statusCardsApi } from "@/api/status-cards";
import { ConfirmDialog } from "@/documents/ConfirmDialog";
import { updatedLabel } from "@/tasks/list-model";
import { Button } from "@/ui/Button";
import { Field, TextArea, TextInput } from "@/ui/Field";
import { Segmented } from "@/ui/Segmented";
import { Switch } from "@/ui/Switch";
import { pushToast } from "@/ui/Toast";
import { Tooltip } from "@/ui/Tooltip";
import { AgentPicker } from "./AgentPicker";
import { useRefreshCards } from "./queries";
import {
  DEBOUNCE_OPTIONS,
  estimateCost,
  formatTokens,
  INTERVAL_OPTIONS,
  midSentence,
  SERVER_DEFAULT_DAILY_CAP,
  TRIGGERS,
  withMode,
} from "./status-model";

/*
 * A card's settings, the panel's Settings tab (after ui/src/pages/StatusCards/StatusCardSettingsForm.tsx
 * and the drawer's settings tab): its name (a name you give is pinned, so a rebuild doesn't rename
 * it; clearing it hands naming back to the agent), the prompt (changing it rebuilds the query),
 * the agent, and when it updates: manual, on a schedule when something changed, or soon after a
 * change. Automatic updates add what counts as a change, active hours and a daily token cap. A
 * rough cost preview, the compiled query (read-only), Save, and Delete.
 */

const MODES: { value: StatusCardRefreshPolicy["mode"]; title: string; note: string }[] = [
  { value: "manual", title: "Manual", note: "Updates only when you ask" },
  { value: "interval", title: "On a schedule", note: "Checks every few minutes, and updates if something changed" },
  { value: "reactive", title: "When something changes", note: "Updates shortly after a change, up to a limit an hour" },
];

export function CardSettings(props: { card: StatusCard; onDeleted: () => void }) {
  const refresh = useRefreshCards();
  const [title, setTitle] = createSignal("");
  const [prompt, setPrompt] = createSignal("");
  const [agentId, setAgentId] = createSignal("");
  const [policy, setPolicy] = createSignal<StatusCardRefreshPolicy>(props.card.refreshPolicy);
  const [saving, setSaving] = createSignal(false);
  const [error, setError] = createSignal<string | null>(null);
  const [deleting, setDeleting] = createSignal(false);

  // Start from the card each time another card opens; a refetch of the same card keeps your edits.
  createEffect(
    on(
      () => props.card.id,
      () => {
        setTitle(props.card.titlePinned ? (props.card.title ?? "") : "");
        setPrompt(props.card.interestPrompt);
        setAgentId(props.card.agentId ?? "");
        setPolicy(props.card.refreshPolicy);
        setError(null);
      },
    ),
  );

  const patchPolicy = (patch: Partial<StatusCardRefreshPolicy>) => setPolicy((current) => ({ ...current, ...patch }));
  const auto = () => policy().mode !== "manual";
  const cost = () => estimateCost(policy());
  const promptChanged = () => prompt().trim().length > 0 && prompt().trim() !== props.card.interestPrompt.trim();

  const save = async (event: Event) => {
    event.preventDefault();
    setSaving(true);
    setError(null);
    const name = title().trim();
    // Only a changed name is sent: an untouched empty field leaves the agent's name alone.
    const nameChanged = name !== (props.card.titlePinned ? (props.card.title ?? "") : "");
    try {
      await statusCardsApi.patch(props.card.id, {
        ...(nameChanged ? { title: name || null, titlePinned: name.length > 0 } : {}),
        ...(promptChanged() ? { interestPrompt: prompt().trim() } : {}),
        agentId: agentId() || null,
        refreshPolicy: policy(),
      });
      pushToast({ tone: "success", title: promptChanged() ? "Saved: the card is rebuilding its query" : "Settings saved" });
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : String(caught));
    } finally {
      setSaving(false);
      void refresh();
    }
  };

  const remove = async () => {
    try {
      await statusCardsApi.remove(props.card.id);
      pushToast({ tone: "success", title: "Card deleted", body: props.card.title ?? undefined });
      props.onDeleted();
    } catch (caught) {
      pushToast({ tone: "error", title: "Couldn't delete the card", body: caught instanceof Error ? caught.message : String(caught) });
    } finally {
      void refresh();
    }
  };

  return (
    <form class="sc-settings" onSubmit={(event) => void save(event)}>
      <Field label="Name" for="sc-name" help="Leave it empty to let the agent name the card.">
        <TextInput id="sc-name" value={title()} placeholder={props.card.title ?? "Named from the prompt"} onInput={(event) => setTitle(event.currentTarget.value)} />
      </Field>
      <Field label="What this card watches and reports" for="sc-prompt" help="The agent builds the query from this and follows it in every update. Changing it rebuilds the card.">
        <TextArea id="sc-prompt" rows={4} value={prompt()} onInput={(event) => setPrompt(event.currentTarget.value)} />
      </Field>
      <Field label="Agent" for="sc-agent" help="Runs the card's setup and updates.">
        <AgentPicker id="sc-agent" value={agentId()} onChange={setAgentId} />
      </Field>

      <fieldset class="sc-fieldset">
        <legend class="field-label">Updates</legend>
        <div class="sc-options" role="radiogroup" aria-label="When the card updates">
          <For each={MODES}>
            {(mode) => (
              <label class="sc-option" classList={{ "sc-option--on": policy().mode === mode.value }}>
                <input type="radio" name="sc-mode" checked={policy().mode === mode.value} onChange={() => setPolicy(withMode(policy(), mode.value))} />
                <span class="sc-option-text">
                  <span class="sc-option-name">{mode.title}</span>
                  <span class="cap">{mode.note}</span>
                </span>
              </label>
            )}
          </For>
        </div>
        <Show when={policy().mode === "interval"}>
          <Row label="Check every">
            <Segmented
              label="Check every"
              options={INTERVAL_OPTIONS.map((minutes) => ({ value: String(minutes), label: `${minutes} min` }))}
              value={String(policy().intervalMinutes ?? 15)}
              onChange={(value) => patchPolicy({ intervalMinutes: Number(value) })}
            />
          </Row>
        </Show>
        <Show when={policy().mode === "reactive"}>
          <Row label="Wait after a change">
            <Segmented
              label="Wait after a change"
              options={DEBOUNCE_OPTIONS.map((seconds) => ({ value: String(seconds), label: seconds < 60 ? `${seconds}s` : `${seconds / 60} min` }))}
              value={String(policy().debounceSeconds ?? 60)}
              onChange={(value) => patchPolicy({ debounceSeconds: Number(value) })}
            />
          </Row>
          <Row label="At most" for="sc-per-hour">
            <TextInput
              id="sc-per-hour"
              class="sc-num"
              type="number"
              min={1}
              max={60}
              value={policy().maxUpdatesPerHour ?? 6}
              onInput={(event) => patchPolicy({ maxUpdatesPerHour: Math.max(1, Number(event.currentTarget.value) || 1) })}
            />
            <span class="cap">updates an hour</span>
          </Row>
        </Show>
      </fieldset>

      <Show when={auto()}>
        <details class="sc-advanced">
          <summary>What counts as a change, hours and token cap</summary>
          <div class="sc-advanced-body">
            <fieldset class="sc-fieldset">
              <legend class="field-label">Counts as a change</legend>
              <For each={TRIGGERS}>
                {(trigger) => (
                  <label class="sc-check" classList={{ muted: trigger.noisy }}>
                    <input
                      type="checkbox"
                      checked={policy().triggers[trigger.key]}
                      onChange={(event) => patchPolicy({ triggers: { ...policy().triggers, [trigger.key]: event.currentTarget.checked } })}
                    />
                    {trigger.label}
                  </label>
                )}
              </For>
            </fieldset>
            <Switch
              checked={Boolean(policy().activeHours)}
              onChange={(on) =>
                patchPolicy({
                  activeHours: on
                    ? { start: "08:00", end: "19:00", timezone: Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC" }
                    : undefined,
                })
              }
              label="Only during active hours"
              description="Changes outside the window wait for one update when it opens."
            />
            <Show when={policy().activeHours}>
              {(hours) => (
                <Row label="From">
                  <TextInput class="sc-time" type="time" aria-label="Active hours start" value={hours().start} onInput={(event) => patchPolicy({ activeHours: { ...hours(), start: event.currentTarget.value } })} />
                  <span class="cap">to</span>
                  <TextInput class="sc-time" type="time" aria-label="Active hours end" value={hours().end} onInput={(event) => patchPolicy({ activeHours: { ...hours(), end: event.currentTarget.value } })} />
                  <TextInput class="sc-tz" aria-label="Time zone" placeholder="Time zone" value={hours().timezone} onInput={(event) => patchPolicy({ activeHours: { ...hours(), timezone: event.currentTarget.value } })} />
                </Row>
              )}
            </Show>
            <Row label="Daily token cap" for="sc-cap">
              <TextInput
                id="sc-cap"
                class="sc-num sc-num--wide"
                type="number"
                min={0}
                step={1000}
                placeholder={String(SERVER_DEFAULT_DAILY_CAP)}
                value={policy().dailyTokenCap ?? ""}
                onInput={(event) => {
                  const value = Number(event.currentTarget.value);
                  patchPolicy({ dailyTokenCap: event.currentTarget.value === "" || value <= 0 ? undefined : Math.round(value) });
                }}
              />
              <span class="cap">tokens; empty uses the server's {formatTokens(SERVER_DEFAULT_DAILY_CAP)}</span>
            </Row>
          </div>
        </details>
      </Show>

      <p class="sc-cost">
        <span class="lbl">Estimated cost</span>
        <Tooltip title={cost().detail} content={`${cost().note} A rough guide from typical update sizes; the History tab has what each update really cost.`}>
          {(p) => (
            <span {...p} class="sc-cost-value" tabindex="0">
              {cost().cost}
            </span>
          )}
        </Tooltip>
      </p>

      <details class="sc-query">
        <summary>
          Query <span class="mono cap">v{props.card.queryVersion}</span>
        </summary>
        <pre class="sc-code">{props.card.queries.length > 0 ? JSON.stringify(props.card.queries, null, 2) : "Not built yet."}</pre>
        <p class="cap">
          {props.card.queryCompiledAt
            ? `Built ${midSentence(updatedLabel(props.card.queryCompiledAt))}, version ${props.card.queryVersion}. The agent keeps it; change the prompt to rebuild it.`
            : "The query is built when the card finishes setting up."}
        </p>
      </details>

      <Show when={error()}>
        <p class="field-error" role="alert">
          {error()}
        </p>
      </Show>
      <div class="sc-settings-foot">
        <Button variant="danger" size="compact" icon={<Trash2 size={14} aria-hidden="true" />} onClick={() => setDeleting(true)}>
          Delete
        </Button>
        <Button type="submit" variant="primary" disabled={saving()}>
          {saving() ? "Saving…" : "Save"}
        </Button>
      </div>
      <ConfirmDialog
        open={deleting()}
        onOpenChange={setDeleting}
        title="Delete this card?"
        body="Its summary, history and settings go for good. Archive it instead to keep them."
        confirmLabel="Delete"
        danger
        onConfirm={remove}
      />
    </form>
  );
}

function Row(props: { label: string; for?: string; children: JSX.Element }) {
  return (
    <div class="sc-row">
      <label class="cap sc-row-label" for={props.for}>
        {props.label}
      </label>
      <div class="sc-row-controls">{props.children}</div>
    </div>
  );
}
