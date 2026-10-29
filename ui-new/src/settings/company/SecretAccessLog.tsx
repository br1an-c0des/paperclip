import type { CompanySecret } from "@paperclipai/shared";
import { createQuery } from "@tanstack/solid-query";
import { For, Match, Show, Switch } from "solid-js";
import { accessApi } from "@/api/access";
import { queryKeys } from "@/api/queryKeys";
import { secretsApi } from "@/api/secrets";
import { useCompany } from "@/lib/company";
import { Button } from "@/ui/Button";
import { Dialog } from "@/ui/Dialog";
import { TonePill } from "@/ui/Status";
import { consumerLabel } from "./secrets-model";
import { dateTime, failure } from "./shared";

/*
 * A secret's access log (the old Secrets page's Access tab, `GET /secrets/:id/access-events`): each
 * time a run, an agent's API call or a plugin read its value, with the outcome, who was responsible
 * and whose credential it was. Entries are redacted: values are never logged.
 */

export function AccessLogDialog(props: { secret: CompanySecret | null; onClose: () => void }) {
  const company = useCompany();
  const events = createQuery(() => ({
    queryKey: queryKeys.companySettings.secretAccessEvents(props.secret?.id ?? ""),
    queryFn: ({ signal }) => secretsApi.accessEvents(props.secret!.id, signal),
    enabled: !!props.secret,
    staleTime: 0,
  }));
  const people = createQuery(() => ({
    queryKey: queryKeys.access.userDirectory(company().id),
    queryFn: () => accessApi.userDirectory(company().id),
    enabled: (events.data ?? []).some((event) => event.responsibleUserId || event.credentialOwnerUserId),
    staleTime: 60_000,
  }));
  const person = (userId: string) => {
    const entry = people.data?.users.find((user) => user.principalId === userId);
    return entry?.user?.name?.trim() || entry?.user?.email?.trim() || `${userId.slice(0, 8)}…`;
  };

  return (
    <Dialog
      open={!!props.secret}
      onOpenChange={(open) => !open && props.onClose()}
      title={`Who read ${props.secret?.name ?? ""}`}
      description="Each time a run, agent or plugin read its value. Values themselves are never logged."
      width={560}
      footer={
        <Button variant="quiet" onClick={props.onClose}>
          Close
        </Button>
      }
    >
      <Switch>
        <Match when={events.isLoading}>
          <p class="cs-muted">Loading…</p>
        </Match>
        <Match when={events.isError}>
          <p class="cs-bad">Couldn't load the log. {failure(events.error, "")}</p>
        </Match>
        <Match when={events.data}>
          <ul class="cs-usage cs-access-log">
            <For each={events.data} fallback={<li class="cs-muted">Nothing has read it yet.</li>}>
              {(event) => (
                <li>
                  <span class="cs-inline">
                    <span class="cs-strong">{consumerLabel(event.consumerType)}</span>
                    <TonePill tone={event.outcome === "success" ? "green" : "red"} compact>
                      {event.outcome === "success" ? "Read" : "Failed"}
                    </TonePill>
                    <Show when={event.version != null}>
                      <span class="cs-muted">version {event.version}</span>
                    </Show>
                    <span class="cs-muted cs-access-when">{dateTime(event.createdAt)}</span>
                  </span>
                  <span class="cs-muted mono cs-ellipsis">{event.configPath ? `${event.configPath} · ${event.consumerId}` : event.consumerId}</span>
                  <Show when={event.responsibleUserId}>{(userId) => <span class="cs-muted">Responsible: {person(userId())}</span>}</Show>
                  <Show when={event.credentialOwnerUserId && event.credentialOwnerUserId !== event.responsibleUserId}>
                    <span class="cs-muted">Credential owner: {person(event.credentialOwnerUserId!)}</span>
                  </Show>
                  <Show when={event.errorCode}>
                    <span class="cs-bad mono">{event.errorCode}</span>
                  </Show>
                </li>
              )}
            </For>
          </ul>
        </Match>
      </Switch>
    </Dialog>
  );
}
