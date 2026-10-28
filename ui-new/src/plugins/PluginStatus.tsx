import type { PluginRecord } from "@paperclipai/shared";
import { createQuery } from "@tanstack/solid-query";
import { CircleCheck, CircleX } from "lucide-solid";
import { For, Show } from "solid-js";
import { pluginsApi, type PluginDashboard } from "@/api/plugins";
import { queryKeys } from "@/api/queryKeys";
import { SettingsCard } from "@/ui/Field";
import { TonePill } from "@/ui/Status";

/*
 * A plugin's status in App settings → Plugins (the old settings page's Status tab): its health
 * checks, its worker process, recent scheduled job runs and webhook deliveries
 * (`GET /api/plugins/:id/dashboard`), its last 50 log lines (`/logs`), and the permissions it asked
 * for. Refreshed every 30 seconds while open, as the old page does.
 */

const REFRESH_MS = 30_000;

export function PluginStatus(props: { plugin: PluginRecord }) {
  const ready = () => props.plugin.status === "ready";
  const health = createQuery(() => ({
    queryKey: queryKeys.plugins.health(props.plugin.id),
    queryFn: ({ signal }) => pluginsApi.health(props.plugin.id, signal),
    enabled: ready(),
    refetchInterval: REFRESH_MS,
    retry: false,
  }));
  const dashboard = createQuery(() => ({
    queryKey: queryKeys.plugins.dashboard(props.plugin.id),
    queryFn: ({ signal }) => pluginsApi.dashboard(props.plugin.id, signal),
    refetchInterval: REFRESH_MS,
    retry: false,
  }));
  const logs = createQuery(() => ({
    queryKey: queryKeys.plugins.logs(props.plugin.id),
    queryFn: ({ signal }) => pluginsApi.logs(props.plugin.id, 50, signal),
    enabled: ready(),
    refetchInterval: REFRESH_MS,
    retry: false,
  }));
  const capabilities = () => props.plugin.manifestJson?.capabilities ?? [];

  return (
    <>
      <SettingsCard title="Health" description={ready() ? "The plugin's own checks, every 30 seconds." : "Health checks run once the plugin is on and ready."}>
        <div class="ps-status">
          <Show
            when={health.data}
            fallback={
              <p class="sf-muted" role="status">
                {!ready() ? `It's ${props.plugin.status.replace(/_/g, " ")}.` : health.isError ? "Its health couldn't be checked." : "Checking…"}
              </p>
            }
          >
            {(current) => (
              <>
                <div class="ps-status-line">
                  <TonePill tone={current().healthy ? "green" : "red"} compact>
                    {current().healthy ? "Healthy" : "Unhealthy"}
                  </TonePill>
                  <span class="sf-muted">{current().status.replace(/_/g, " ")}</span>
                </div>
                <Show when={current().checks.length > 0}>
                  <ul class="ps-checks">
                    <For each={current().checks}>
                      {(item) => (
                        <li>
                          <Show when={item.passed} fallback={<CircleX size={14} class="ps-bad" aria-label="Failed" />}>
                            <CircleCheck size={14} class="ps-ok" aria-label="Passed" />
                          </Show>
                          <span>{item.name}</span>
                          <Show when={!item.passed && item.message}>
                            <span class="sf-muted">{item.message}</span>
                          </Show>
                        </li>
                      )}
                    </For>
                  </ul>
                </Show>
              </>
            )}
          </Show>
          <Show when={health.data?.lastError ?? props.plugin.lastError}>
            {(problem) => <pre class="ps-error">{problem()}</pre>}
          </Show>
        </div>
      </SettingsCard>

      <SettingsCard title="Runtime" description="Its worker process, scheduled jobs and webhook deliveries.">
        <div class="ps-status">
          <Show when={dashboard.data} fallback={<p class="sf-muted">{dashboard.isError ? "Runtime details are unavailable right now." : "Loading…"}</p>}>
            {(data) => <Runtime data={data()} />}
          </Show>
        </div>
      </SettingsCard>

      <Show when={(logs.data ?? []).length > 0}>
        <SettingsCard title="Recent logs" description={`The last ${logs.data!.length} lines it wrote.`}>
          <ol class="ps-logs mono" aria-label="Plugin logs">
            <For each={logs.data}>
              {(entry) => (
                <li data-level={entry.level}>
                  <time datetime={entry.createdAt}>{new Date(entry.createdAt).toLocaleTimeString()}</time>
                  <span class="ps-level">{entry.level}</span>
                  <span class="ps-message" title={entry.message}>
                    {entry.message}
                  </span>
                </li>
              )}
            </For>
          </ol>
        </SettingsCard>
      </Show>

      <SettingsCard title="Permissions" description="What it asked to be allowed to do.">
        <div class="ps-status">
          <Show when={capabilities().length > 0} fallback={<p class="sf-muted">No special permissions.</p>}>
            <ul class="ps-caps">
              <For each={capabilities()}>{(capability) => <li class="mono">{capability}</li>}</For>
            </ul>
          </Show>
        </div>
      </SettingsCard>
    </>
  );
}

function Runtime(props: { data: PluginDashboard }) {
  const worker = () => props.data.worker;
  return (
    <>
      <Show when={worker()} fallback={<p class="sf-muted">No worker process is running.</p>}>
        {(current) => (
          <dl class="ps-props">
            <dt>Worker</dt>
            <dd>
              {current().status}
              <Show when={current().pid}> · pid {current().pid}</Show>
              <Show when={current().uptime !== null}> · up {formatDuration(current().uptime!)}</Show>
            </dd>
            <dt>Pending calls</dt>
            <dd>{current().pendingRequests}</dd>
            <Show when={current().totalCrashes > 0}>
              <dt>Crashes</dt>
              <dd>
                {current().consecutiveCrashes} in a row, {current().totalCrashes} in all
                <Show when={current().lastCrashAt}> · last {new Date(current().lastCrashAt!).toLocaleString()}</Show>
              </dd>
            </Show>
          </dl>
        )}
      </Show>
      <h4 class="sf-group-title">Recent job runs</h4>
      <Show when={props.data.recentJobRuns.length > 0} fallback={<p class="sf-muted">None yet.</p>}>
        <ul class="ps-runs">
          <For each={props.data.recentJobRuns}>
            {(run) => (
              <li>
                <span class="ps-dot" data-status={run.status} aria-hidden="true" />
                <span class="mono">{run.jobKey ?? run.jobId.slice(0, 8)}</span>
                <span class="sf-muted">
                  {run.trigger} · {run.status}
                  <Show when={run.durationMs !== null}> · {formatDuration(run.durationMs!)}</Show>
                </span>
                <time class="sf-muted ps-push" datetime={run.createdAt}>
                  {new Date(run.createdAt).toLocaleString()}
                </time>
              </li>
            )}
          </For>
        </ul>
      </Show>
      <h4 class="sf-group-title">Recent webhook deliveries</h4>
      <Show when={props.data.recentWebhookDeliveries.length > 0} fallback={<p class="sf-muted">None yet.</p>}>
        <ul class="ps-runs">
          <For each={props.data.recentWebhookDeliveries}>
            {(delivery) => (
              <li>
                <span class="ps-dot" data-status={delivery.status} aria-hidden="true" />
                <span class="mono">{delivery.webhookKey}</span>
                <span class="sf-muted">
                  {delivery.status}
                  <Show when={delivery.durationMs !== null}> · {formatDuration(delivery.durationMs!)}</Show>
                </span>
                <time class="sf-muted ps-push" datetime={delivery.createdAt}>
                  {new Date(delivery.createdAt).toLocaleString()}
                </time>
              </li>
            )}
          </For>
        </ul>
      </Show>
    </>
  );
}

/** "850ms", "12s", "4m", "3h 5m". */
export function formatDuration(ms: number): string {
  if (ms < 1000) return `${Math.round(ms)}ms`;
  const seconds = Math.round(ms / 1000);
  if (seconds < 60) return `${seconds}s`;
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m`;
  const hours = Math.floor(minutes / 60);
  return minutes % 60 ? `${hours}h ${minutes % 60}m` : `${hours}h`;
}
