import { createQuery } from "@tanstack/solid-query";
import { ExternalLink, Link2 } from "lucide-solid";
import { For, Match, Show, Switch } from "solid-js";
import { issuesApi } from "@/api/issues";
import { queryKeys } from "@/api/queryKeys";
import { useExperimentalSettingsQuery } from "@/lib/company-data";
import { Button } from "@/ui/Button";
import { externalObjectRows, objectName, providerLabel, statusLabel, statusTone, typeLabel } from "./external-objects";

/*
 * The Details section's External objects (`tasks/external-objects`): what outside Paperclip the
 * task mentions, each with its live status, where it was mentioned, and a link out. Shown only while
 * the instance's `enableExternalObjects` is on (decision 32: the setting is followed, not toggled
 * here), and only when the task mentions something.
 */

export function ExternalObjects(props: { taskId: string }) {
  const settings = useExperimentalSettingsQuery();
  const enabled = () => settings.data?.enableExternalObjects === true;
  const query = createQuery(() => ({
    queryKey: queryKeys.issues.section(props.taskId, "external-objects"),
    queryFn: ({ signal }) => issuesApi.externalObjects(props.taskId, signal),
    enabled: enabled(),
    staleTime: 60_000,
  }));
  const rows = () => externalObjectRows(query.data ?? []);
  return (
    <Show when={enabled() && (rows().length > 0 || query.isError)}>
      <section class="td-section" aria-labelledby={`td-external-${props.taskId}`}>
        <div class="td-section-head">
          <Link2 size={16} aria-hidden="true" />
          <h2 class="disp" id={`td-external-${props.taskId}`}>
            External objects
          </h2>
          <Show when={rows().length > 0}>
            <span class="td-muted">{rows().length}</span>
          </Show>
        </div>
        <Switch>
          <Match when={query.isError}>
            <p class="td-muted">
              The external objects couldn't be loaded.{" "}
              <Button size="compact" ghost onClick={() => void query.refetch()}>
                Try again
              </Button>
            </p>
          </Match>
          <Match when={true}>
            <div class="card td-table">
              <For each={rows()}>
                {(row) => (
                  <div class="td-external">
                    <span class="td-status td-status--small" data-tone={statusTone(row.object)}>
                      {statusLabel(row.object)}
                    </span>
                    <span class="td-external-text">
                      <Show
                        when={row.object.sanitizedCanonicalUrl}
                        fallback={<span class="td-ellipsis">{row.object.displayTitle ?? objectName(row.object)}</span>}
                      >
                        {(url) => (
                          <a class="td-link td-ellipsis" href={url()} target="_blank" rel="noopener noreferrer">
                            {row.object.displayTitle ?? objectName(row.object)}
                            <ExternalLink size={12} aria-hidden="true" />
                          </a>
                        )}
                      </Show>
                      <span class="td-muted td-ellipsis">
                        {objectName(row.object)} · {providerLabel(row.object.providerKey)} {typeLabel(row.object.objectType)}
                        <Show when={row.sources.length > 0}> · in {row.sources.join(", ").toLowerCase()}</Show>
                        <Show when={row.object.liveness !== "fresh" && row.object.liveness !== "unknown"}> · {row.object.liveness.replace(/_/g, " ")}</Show>
                      </span>
                    </span>
                  </div>
                )}
              </For>
            </div>
          </Match>
        </Switch>
      </section>
    </Show>
  );
}
