import { createMutation, useQueryClient } from "@tanstack/solid-query";
import { KeyRound } from "lucide-solid";
import { createMemo, createSignal, For, Show } from "solid-js";
import { accessApi } from "@/api/access";
import { queryKeys } from "@/api/queryKeys";
import { useCompany } from "@/lib/company";
import { Button } from "@/ui/Button";
import { Footer } from "./card-parts";
import { adapterLabel, joinCarriesSecrets, joinReach } from "./join-model";
import type { Request } from "./request-model";

/*
 * A join request's controls: who's asking and what they gave (email, or for an agent its adapter,
 * the address Paperclip will reach it at, and what it says it can do), then Approve or Reject
 * (`POST /companies/:id/join-requests/:id/approve|reject`). Settings → Members lists the same
 * requests and refreshes with these.
 */

type Source = Extract<Request["source"], { type: "join" }>;

export function JoinControls(props: { request: Request; source: Source; onDone: () => void }) {
  const client = useQueryClient();
  const company = useCompany();
  const join = () => props.source.join;
  const agent = () => join().requestType === "agent";
  const [error, setError] = createSignal<string | null>(null);

  const rows = createMemo((): [string, string][] => {
    const entry = join();
    const pairs: [string, string | null][] = agent()
      ? [
          ["Runs on", adapterLabel(entry.adapterType)],
          ["Reached at", joinReach(entry.agentDefaultsPayload)],
          ["Asked from", entry.requestIp || null],
        ]
      : [
          ["Email", entry.requesterUser?.email ?? entry.requestEmailSnapshot],
          ["Role", entry.invite?.humanRole ?? null],
        ];
    return pairs.filter((pair): pair is [string, string] => !!pair[1]);
  });

  const decide = createMutation(() => ({
    mutationFn: (approve: boolean) => (approve ? accessApi.approveJoinRequest(company().id, join().id) : accessApi.rejectJoinRequest(company().id, join().id)),
    onSuccess: () => {
      setError(null);
      void client.invalidateQueries({ queryKey: queryKeys.companySettings.joinRequests(company().id) });
      if (agent()) void client.invalidateQueries({ queryKey: queryKeys.agents.list(company().id) });
      props.onDone();
    },
    onError: (failure: Error) => setError(failure.message),
  }));

  return (
    <>
      <Show when={rows().length > 0}>
        <dl class="rq-kv">
          <For each={rows()}>
            {([label, value]) => (
              <>
                <dt>{label}</dt>
                <dd classList={{ mono: label === "Reached at" }}>{value}</dd>
              </>
            )}
          </For>
        </dl>
      </Show>
      <Show when={agent() && join().capabilities?.trim()}>
        <div class="rq-body">
          <div class="rq-q">What it says it can do</div>
          <p class="rq-caps">{join().capabilities}</p>
        </div>
      </Show>
      <Show when={agent() && joinCarriesSecrets(join().agentDefaultsPayload)}>
        <p class="rq-note">
          <KeyRound size={13} aria-hidden="true" /> It sent credentials for Paperclip to call it with. They're kept with the agent and not shown here.
        </p>
      </Show>
      <Footer request={props.request} error={error()}>
        <Button size="compact" variant="primary" disabled={decide.isPending} onClick={() => decide.mutate(true)}>
          Approve
        </Button>
        <Button size="compact" variant="danger" disabled={decide.isPending} onClick={() => decide.mutate(false)}>
          Reject
        </Button>
      </Footer>
    </>
  );
}
