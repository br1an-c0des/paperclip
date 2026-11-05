import { A, useNavigate } from "@solidjs/router";
import { createQuery } from "@tanstack/solid-query";
import { createSignal, Match, Show, Switch } from "solid-js";
import { aiConnectionsApi } from "@/api/ai-connections";
import { ApiError } from "@/api/client";
import { healthApi } from "@/api/health";
import { queryKeys } from "@/api/queryKeys";
import { localLoginSupported, providerName } from "@/connectors/connection-model";
import { ConnectionSetup } from "@/connectors/ConnectionSetup";
import { useCompany } from "@/lib/company";
import { buttonClass } from "@/ui/Button";
import { pushToast } from "@/ui/Toast";

/*
 * `/:prefix/apps/connect?aiLogin=<sessionId>`: a saved AI sign-in to finish (upstream #17737). An
 * agent allowed to set up connections starts the sign-in and hands its person this link; the setup
 * (`GET ai-connections/login/:sessionId/setup`) says what it's for, and the Claude sign-in dialog
 * picks it up with those details. Only Claude subscriptions sign in from ui-new; another provider's
 * setup says so. A setup already saved points to AI connections.
 */

export function ResumeAiLogin(props: { sessionId: string }) {
  const company = useCompany();
  const navigate = useNavigate();
  const aiPage = () => `/${company().issuePrefix}/apps/ai`;
  const setup = createQuery(() => ({
    queryKey: queryKeys.aiConnections.loginSetup(company().id, props.sessionId),
    queryFn: ({ signal }) => aiConnectionsApi.loginSetup(company().id, props.sessionId, signal),
    retry: false,
    staleTime: Infinity,
  }));
  const list = createQuery(() => ({
    queryKey: queryKeys.aiConnections.list(company().id),
    queryFn: () => aiConnectionsApi.list(company().id),
  }));
  const health = createQuery(() => ({ queryKey: queryKeys.health, queryFn: healthApi.get }));
  const [open, setOpen] = createSignal(true);
  const gone = () => setup.error instanceof ApiError && setup.error.status === 404;
  const saved = () => (setup.data?.connectionId && setup.data.grantId ? setup.data : null);
  const resumable = () => {
    const data = setup.data;
    return data && !saved() && data.intent.provider === "anthropic" ? data : null;
  };

  return (
    <section class="card ap-later" aria-label="Saved sign-in">
      <Switch>
        <Match when={setup.isPending}>
          <p role="status">Loading the saved sign-in…</p>
        </Match>
        <Match when={setup.isError}>
          <h2 class="disp">{gone() ? "This sign-in is no longer available" : "Couldn't load the sign-in"}</h2>
          <p role="alert">
            {gone()
              ? "It was cancelled, failed or expired. Ask the agent to start it again, or connect the account yourself."
              : (setup.error as Error).message}
          </p>
          <div>
            <A class={buttonClass({ size: "compact" })} href={aiPage()}>
              AI connections
            </A>
          </div>
        </Match>
        <Match when={saved()}>
          <h2 class="disp">This account is connected</h2>
          <p role="status">{setup.data!.intent.name} is saved, so there's nothing left to sign in.</p>
          <div>
            <A class={buttonClass({ size: "compact" })} href={aiPage()}>
              View AI connections
            </A>
          </div>
        </Match>
        <Match when={setup.data && !resumable()}>
          <h2 class="disp">This sign-in can't be finished here yet</h2>
          <p>
            {setup.data!.intent.name} signs in to {providerName(setup.data!.intent.provider)}. Only Claude subscriptions sign in from this board so far.
          </p>
          <div>
            <A class={buttonClass({ size: "compact" })} href={aiPage()}>
              AI connections
            </A>
          </div>
        </Match>
        <Match when={resumable()}>
          {(data) => (
            <>
              <h2 class="disp">Finish connecting {data().intent.name}</h2>
              <p>A Claude sign-in was started for you. Sign in to save the connection.</p>
              <Show when={list.data} fallback={<p role="status">{list.isError ? "Couldn't load your AI connections." : "Loading…"}</p>}>
                {(connections) => (
                  <>
                    <Show when={!open()}>
                      <button type="button" class={buttonClass({ variant: "primary", size: "compact" })} onClick={() => setOpen(true)}>
                        Continue sign-in
                      </button>
                    </Show>
                    <ConnectionSetup
                      open={open()}
                      onOpenChange={setOpen}
                      list={connections()}
                      resume={data().intent}
                      subscriptionSupported={localLoginSupported(health.data)}
                      onSaved={(name) => {
                        setOpen(false);
                        pushToast({ title: `Connected ${name}`, tone: "success" });
                        navigate(aiPage(), { replace: true });
                      }}
                    />
                  </>
                )}
              </Show>
            </>
          )}
        </Match>
      </Switch>
    </section>
  );
}
