import type { AgentObservabilitySettingsResponse } from "@paperclipai/shared";
import { createQuery, useQueryClient } from "@tanstack/solid-query";
import { Plus, X } from "lucide-solid";
import { createEffect, createSignal, For, on, Show } from "solid-js";
import { createStore, produce, reconcile } from "solid-js/store";
import { ApiError } from "@/api/client";
import { companiesApi } from "@/api/companies";
import { queryKeys } from "@/api/queryKeys";
import { ConfirmDialog } from "@/documents/ConfirmDialog";
import { useCompany } from "@/lib/company";
import { Button } from "@/ui/Button";
import { SettingsRow, TextInput } from "@/ui/Field";
import { Segmented } from "@/ui/Segmented";
import { TonePill } from "@/ui/Status";
import { Switch } from "@/ui/Switch";
import { pushToast } from "@/ui/Toast";
import {
  CAPTURE_LABELS,
  headerRow,
  needsFreshHeaders,
  telemetryDirty,
  telemetryDraft,
  telemetryRequest,
  telemetryStatus,
  type TelemetryDraft,
} from "./connections-model";
import { CardHead, CardNoteLine, dateTime, failure, FootError, SwitchRow } from "./shared";

/*
 * Run telemetry (board 23's last card): agent observability, where managed Claude Code and Codex
 * runs send OpenTelemetry logs and traces (`/companies/:id/observability`). The board draws the
 * custom OTLP collector; Braintrust, which the old UI also offers, is the other destination.
 * Header values and keys are write-only: a saved one shows as set, and stays unless replaced.
 * Saves carry the settings' revision, so a change made elsewhere meanwhile is refused rather than
 * overwritten.
 */

export function TelemetryCard() {
  const company = useCompany();
  const client = useQueryClient();
  const key = () => queryKeys.companySettings.observability(company().id);
  const query = createQuery(() => ({ queryKey: key(), queryFn: ({ signal }) => companiesApi.observability(company().id, signal) }));
  const settings = () => query.data?.settings ?? null;
  const [draft, setDraft] = createStore<TelemetryDraft>(telemetryDraft(null));
  const [busy, setBusy] = createSignal<"save" | "test" | "remove" | null>(null);
  const [problem, setProblem] = createSignal<string | null>(null);
  const [conflict, setConflict] = createSignal(false);
  const [replaceKey, setReplaceKey] = createSignal(false);
  const [confirmRemove, setConfirmRemove] = createSignal(false);
  const dirty = () => telemetryDirty(settings(), draft);
  const reset = () => {
    setDraft(reconcile(telemetryDraft(settings())));
    setReplaceKey(false);
    setProblem(null);
    setConflict(false);
  };
  // A background refresh updates a clean form, never an unsaved draft.
  createEffect(on(() => settings()?.revision ?? null, () => !dirty() && reset()));

  const accept = (data: AgentObservabilitySettingsResponse) => {
    client.setQueryData(key(), data);
    setDraft(reconcile(telemetryDraft(data.settings)));
    setReplaceKey(false);
    setProblem(null);
    setConflict(false);
  };
  const reject = (caught: unknown, fallback: string) => {
    const stale = caught instanceof ApiError && caught.status === 409;
    setConflict(stale);
    setProblem(stale ? "Someone else changed these settings. Reload them to continue." : failure(caught, fallback));
  };

  const save = async (enabled?: boolean) => {
    const built = telemetryRequest(settings(), draft, enabled);
    if ("problem" in built) return setProblem(built.problem);
    setBusy("save");
    try {
      accept(await companiesApi.updateObservability(company().id, built.request));
      pushToast({ tone: "success", title: enabled === false ? "Turned run telemetry off" : "Saved run telemetry" });
    } catch (caught) {
      reject(caught, "Couldn't save run telemetry.");
    } finally {
      setBusy(null);
    }
  };
  const test = async () => {
    const current = settings();
    if (!current) return;
    setBusy("test");
    try {
      const receipt = await companiesApi.testObservability(company().id, current.revision);
      client.setQueryData<AgentObservabilitySettingsResponse>(key(), (data) =>
        data?.settings?.revision === receipt.revision ? { ...data, settings: { ...data.settings, lastTest: receipt } } : data,
      );
      setProblem(null);
    } catch (caught) {
      reject(caught, "The test couldn't be sent.");
    } finally {
      setBusy(null);
    }
  };
  const remove = async () => {
    const current = settings();
    if (!current) return;
    setBusy("remove");
    try {
      accept(await companiesApi.removeObservability(company().id, current.revision));
      pushToast({ tone: "success", title: "Removed run telemetry" });
    } catch (caught) {
      reject(caught, "Couldn't remove run telemetry.");
    } finally {
      setBusy(null);
    }
  };

  const status = () => telemetryStatus(settings());
  const receipt = () => settings()?.lastTest ?? null;
  const fresh = () => needsFreshHeaders(settings(), draft);
  const keySaved = () => settings()?.destination.provider === "braintrust" && settings()!.credentialsConfigured && draft.provider === "braintrust";

  return (
    <Show when={!query.isError} fallback={<CardNoteLine alert>Couldn't load run telemetry. {failure(query.error, "")}</CardNoteLine>}>
      <section class="card settings-card" aria-labelledby="cs-otel">
        <CardHead id="cs-otel" title="Run telemetry" note="Send OpenTelemetry logs and traces from managed Claude Code and Codex runs to your own collector." />
        <Show when={query.data} fallback={<CardNoteLine>Loading…</CardNoteLine>}>
          <Show when={query.data!.canManage} fallback={<CardNoteLine>You need permission to manage connections to set up run telemetry.</CardNoteLine>}>
            <SettingsRow label="Status">
              <div class="cs-inline cs-min34">
                <Show when={status().tone} fallback={<span class="cs-pill">{status().label}</span>}>
                  <TonePill tone={status().tone!} compact>
                    {status().label}
                  </TonePill>
                </Show>
                <Show when={receipt()}>
                  {(last) => (
                    <span class="cs-muted">
                      Last test {last().status === "accepted" ? "accepted" : last().status === "partial" ? "partly rejected" : "failed"} · {dateTime(last().finishedAt)}
                    </span>
                  )}
                </Show>
              </div>
              <Show when={receipt() && receipt()!.status !== "accepted"}>
                <For each={(["logs", "traces"] as const).filter((signal) => receipt()!.signals[signal].message)}>
                  {(signal) => (
                    <span class="fhelp">
                      {signal === "logs" ? "Logs" : "Traces"}: {receipt()!.signals[signal].message}
                    </span>
                  )}
                </For>
              </Show>
            </SettingsRow>
            <SettingsRow label="Destination">
              <Segmented
                label="Destination"
                options={[
                  { value: "otlp", label: "OTLP collector" },
                  { value: "braintrust", label: "Braintrust" },
                ]}
                value={draft.provider}
                onChange={(value) => {
                  setDraft("provider", value);
                  setDraft("apiKey", "");
                  setProblem(null);
                }}
              />
            </SettingsRow>
            <Show
              when={draft.provider === "otlp"}
              fallback={
                <>
                  <SettingsRow label="Project ID" for="cs-otel-project" help="The Braintrust project's UUID.">
                    <TextInput id="cs-otel-project" class="mono" autocomplete="off" value={draft.projectId} onInput={(event) => setDraft("projectId", event.currentTarget.value)} />
                  </SettingsRow>
                  <SettingsRow label="API key" for="cs-otel-key" help="Use a key limited to telemetry ingestion: the agent's harness receives it.">
                    <Show
                      when={keySaved() && !replaceKey()}
                      fallback={
                        <TextInput id="cs-otel-key" type="password" autocomplete="new-password" value={draft.apiKey} onInput={(event) => setDraft("apiKey", event.currentTarget.value)} />
                      }
                    >
                      <div class="cs-inline">
                        <span class="cs-muted">A key is saved.</span>
                        <Button size="compact" onClick={() => setReplaceKey(true)}>
                          Replace
                        </Button>
                      </div>
                    </Show>
                  </SettingsRow>
                </>
              }
            >
              <SettingsRow label="Endpoint" for="cs-otel-endpoint" help="OTLP over HTTP. The base URL, without /v1/logs or /v1/traces; every environment agents run in must reach it.">
                <TextInput
                  id="cs-otel-endpoint"
                  class="mono"
                  autocomplete="off"
                  placeholder="https://otel.example.com:4318"
                  value={draft.endpoint}
                  onInput={(event) => setDraft("endpoint", event.currentTarget.value)}
                />
              </SettingsRow>
              <SettingsRow label="Headers" help="For your collector's authentication. Values are never shown again; the agent's harness receives them.">
                <div class="cs-headers">
                  <For each={draft.headers}>
                    {(row, index) => (
                      <div class="cs-header-row">
                        <TextInput
                          aria-label="Header name"
                          class="mono"
                          placeholder="authorization"
                          value={row.name}
                          autocomplete="off"
                          onInput={(event) => setDraft("headers", index(), "name", event.currentTarget.value)}
                        />
                        <TextInput
                          aria-label={`Value for ${row.name || "header"}`}
                          type="password"
                          autocomplete="new-password"
                          placeholder={row.originalName && !fresh() ? "Keep the saved value" : "Value"}
                          value={row.value}
                          onInput={(event) => setDraft("headers", index(), "value", event.currentTarget.value)}
                        />
                        <Button
                          variant="icon"
                          ghost
                          size="compact"
                          aria-label={`Remove ${row.name || "header"}`}
                          onClick={() => setDraft("headers", produce((rows) => rows.splice(index(), 1)))}
                        >
                          <X size={14} aria-hidden="true" />
                        </Button>
                      </div>
                    )}
                  </For>
                  <Show when={draft.headers.length < 16}>
                    <Button size="compact" icon={<Plus size={14} aria-hidden="true" />} onClick={() => setDraft("headers", (rows) => [...rows, headerRow()])}>
                      Add header
                    </Button>
                  </Show>
                </div>
              </SettingsRow>
            </Show>
            <SwitchRow label="Send telemetry" help="Applies to runs that start after you save." checked={draft.enabled} onChange={(value) => setDraft("enabled", value)} />
            <SettingsRow label="What to include" help="Exported records can contain task content.">
              <div class="cs-checks">
                <For each={CAPTURE_LABELS}>
                  {(entry) => <Switch label={entry.label} checked={draft.capture[entry.key]} onChange={(value) => setDraft("capture", entry.key, value)} />}
                </For>
              </div>
            </SettingsRow>
          </Show>
        </Show>
        <Show when={query.data?.canManage && (settings() || dirty() || problem() || conflict())}>
          <footer class="cfoot">
            <Show when={settings()}>
              <Button size="compact" disabled={!!busy() || dirty() || conflict()} onClick={() => void test()}>
                {busy() === "test" ? "Sending…" : "Send test"}
              </Button>
              <Button size="compact" variant="quiet" disabled={!!busy() || dirty() || conflict()} onClick={() => setConfirmRemove(true)}>
                Remove
              </Button>
            </Show>
            <span class="ps-foot-end">
              <FootError message={problem()} />
              <Show when={conflict()}>
                <Button size="compact" onClick={() => void query.refetch().then(reset)}>
                  Reload
                </Button>
              </Show>
              <Show when={dirty()}>
                <Button size="compact" variant="quiet" disabled={!!busy()} onClick={reset}>
                  Discard
                </Button>
                <Button size="compact" variant="primary" disabled={!!busy() || conflict()} onClick={() => void save()}>
                  {busy() === "save" ? "Saving…" : "Save"}
                </Button>
              </Show>
            </span>
          </footer>
        </Show>
        <ConfirmDialog
          open={confirmRemove()}
          onOpenChange={setConfirmRemove}
          title="Remove run telemetry?"
          body="Runs stop sending logs and traces, and the saved endpoint and credentials are deleted."
          confirmLabel="Remove"
          danger
          onConfirm={remove}
        />
      </section>
    </Show>
  );
}
