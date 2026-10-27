import type { AiConnectionLoginIntent, LocalAiLoginAttempt, LocalAiLoginStatus } from "@paperclipai/shared";
import { createSignal, onCleanup, type Accessor } from "solid-js";
import { aiConnectionsApi, type AiConnectionResult } from "@/api/ai-connections";

/*
 * The subscription sign-in, as a small state machine. It sequences the requests the way the old
 * UI's useLocalAiLogin and AgentProviderConnection do:
 *
 * - `begin(intent)` starts an attempt (`POST local/attempts`) and checks it (`POST local/check` with
 *   the attempt's session ID). The server runs `claude setup-token` on its own machine and the check
 *   returns the sign-in link. While the answer is `sign_in_required` it checks again every 5s, and
 *   whenever the window regains focus.
 * - The person opens the link, approves, and pastes the code Claude shows into
 *   `submitCode` (`POST local/attempts/:id/code`). The next check answers `ready`.
 * - `connect(name)` saves it (`POST local` with the session ID).
 * - Renaming doesn't restart sign-in, but a different target (ownership, agents, reconnected
 *   connection) does: the old attempt is cancelled (`DELETE local/attempts/:id`) before the new one
 *   starts. `retry()` cancels and starts over with `restart: true`.
 * - `expired` from a check ends the attempt; the person starts again.
 * - Leaving (`dispose`) isn't cancelling: the server resumes the same attempt when the person comes
 *   back with the same target, and reaps abandoned ones when they expire (30 minutes).
 */

export type LoginApi = Pick<
  typeof aiConnectionsApi,
  "startLocalLogin" | "checkLocalLogin" | "submitLocalLoginCode" | "cancelLocalLogin" | "connectLocal"
>;

export type LoginState =
  | { phase: "idle" }
  /** Starting the attempt, or waiting for its first check. */
  | { phase: "preparing" }
  /** Waiting for the person: the link (once the CLI prints it), and whether the code was sent. */
  | {
      phase: "sign_in";
      authorizationUrl: string | null;
      /** A code to type at the provider (OpenAI-style device login); Claude doesn't send one. */
      code: string | null;
      expiresAt: string | null;
      submitting: boolean;
      codeSubmitted: boolean;
    }
  /** The account is signed in and can be saved. `error` is a failed save, which can be retried. */
  | { phase: "ready"; error?: string }
  | { phase: "saving" }
  | { phase: "saved"; result: AiConnectionResult }
  | { phase: "error"; message: string; expired: boolean };

export const POLL_MS = 5000;
export const EXPIRED_MESSAGE = "This sign-in attempt expired. Start sign-in again.";
export const SUBMIT_FAILED_MESSAGE = "Could not submit the authorization code. Start sign-in again.";

/** What restarts sign-in: everything in the intent except its name. */
export function loginTargetKey(intent: AiConnectionLoginIntent) {
  return JSON.stringify({
    provider: intent.provider,
    method: intent.method,
    ownership: intent.ownership,
    connectionId: intent.connectionId ?? null,
    allAgents: intent.allAgents,
    agentIds: [...intent.agentIds].sort(),
  });
}

const message = (cause: unknown, fallback: string) =>
  cause instanceof Error && cause.message ? cause.message : fallback;

export function createLoginController(options: {
  api: LoginApi;
  companyId: string;
  onChange: (state: LoginState) => void;
  pollMs?: number;
}) {
  const { api, companyId, onChange } = options;
  const pollMs = options.pollMs ?? POLL_MS;
  let state: LoginState = { phase: "idle" };
  let intent: AiConnectionLoginIntent | null = null;
  let current: { key: string; request: Promise<LocalAiLoginAttempt> } | null = null;
  let attempt: LocalAiLoginAttempt | null = null;
  /** Each cancel waits for the previous start, and each start for the previous cancel. */
  let pending: Promise<unknown> = Promise.resolve();
  /** Bumped by every begin, retry, failed submit and dispose; stale answers are dropped. */
  let run = 0;
  let checking: number | null = null;
  let timer: ReturnType<typeof setTimeout> | undefined;

  const set = (next: LoginState) => {
    state = next;
    onChange(next);
  };

  function cancelCurrent() {
    const previous = current;
    current = null;
    attempt = null;
    if (previous)
      pending = previous.request.then((result) => api.cancelLocalLogin(companyId, result.sessionId)).catch(() => {});
  }

  function apply(next: LocalAiLoginStatus, result: LocalAiLoginAttempt) {
    if (next.error) {
      set({ phase: "error", message: next.error, expired: next.status === "expired" });
      return;
    }
    if (next.status === "expired") {
      set({ phase: "error", message: EXPIRED_MESSAGE, expired: true });
      return;
    }
    if (next.status === "ready") {
      set({ phase: "ready" });
      return;
    }
    const previous = state.phase === "sign_in" ? state : null;
    set({
      phase: "sign_in",
      authorizationUrl: next.authorizationUrl ?? null,
      code: next.code ?? null,
      expiresAt: result.expiresAt ?? null,
      submitting: previous?.submitting ?? false,
      codeSubmitted: previous?.codeSubmitted ?? false,
    });
  }

  async function check(forRun = run) {
    if (forRun !== run || checking === forRun || !current || !intent) return;
    if (state.phase === "saving" || state.phase === "saved") return;
    checking = forRun;
    clearTimeout(timer);
    try {
      const result = await current.request;
      if (forRun !== run) return;
      attempt = result;
      const next = await api.checkLocalLogin(companyId, { ...intent, localSessionId: result.sessionId });
      if (forRun !== run) return;
      apply(next, result);
      // Stop polling a verified account; focus still rechecks.
      if (next.status === "sign_in_required") timer = setTimeout(() => void check(forRun), pollMs);
    } catch (cause) {
      if (forRun === run) set({ phase: "error", message: message(cause, "Could not check the sign-in."), expired: false });
    } finally {
      if (checking === forRun) checking = null;
    }
  }

  function start(next: AiConnectionLoginIntent, restart: boolean) {
    intent = next;
    run++;
    clearTimeout(timer);
    const key = loginTargetKey(next);
    if (restart || current?.key !== key) {
      cancelCurrent();
      const input = { ...next, ...(restart ? { restart: true } : {}) };
      const request = pending.then(() => api.startLocalLogin(companyId, input));
      current = { key, request };
      pending = request.catch(() => {});
    }
    set({ phase: "preparing" });
    void check(run);
  }

  return {
    state: () => state,
    /** Start (or resume) sign-in for this intent. */
    begin: (next: AiConnectionLoginIntent) => start(next, false),
    /** Cancel the attempt and start a fresh one ("Use a different account", "Start sign-in again"). */
    retry: () => {
      if (intent) start(intent, true);
    },
    /** Check now, as on window focus. */
    check: () => void check(run),
    async submitCode(browserCode: string) {
      const code = browserCode.trim();
      if (!code || state.phase !== "sign_in" || state.submitting || !attempt) return;
      const forRun = run;
      set({ ...state, submitting: true });
      try {
        await api.submitLocalLoginCode(companyId, attempt.sessionId, code);
        if (forRun !== run || state.phase !== "sign_in") return;
        set({ ...state, submitting: false, codeSubmitted: true });
        void check(forRun);
      } catch {
        if (forRun !== run) return;
        // The CLI takes one code per attempt, so stop here until the person starts again.
        run++;
        clearTimeout(timer);
        set({ phase: "error", message: SUBMIT_FAILED_MESSAGE, expired: false });
      }
    },
    /** Save the signed-in account. `name` may differ from the intent's: renaming doesn't restart. */
    async connect(name?: string) {
      if (state.phase !== "ready" || !attempt || !intent) return;
      const forRun = run;
      clearTimeout(timer);
      set({ phase: "saving" });
      try {
        const result = await api.connectLocal(companyId, {
          ...intent,
          ...(name?.trim() ? { name: name.trim() } : {}),
          localSessionId: attempt.sessionId,
        });
        if (forRun === run) set({ phase: "saved", result });
        return result;
      } catch (cause) {
        if (forRun === run) set({ phase: "ready", error: message(cause, "Could not save the connection.") });
        return undefined;
      }
    },
    dispose() {
      run++;
      clearTimeout(timer);
    },
  };
}

export type LoginController = ReturnType<typeof createLoginController>;

/** The controller as a Solid signal, rechecking on focus, and stopped when its owner is disposed. */
export function createLocalLogin(companyId: () => string, api: LoginApi = aiConnectionsApi) {
  const [state, setState] = createSignal<LoginState>({ phase: "idle" });
  let controller: LoginController | null = null;
  let controllerCompany = "";
  const get = () => {
    if (!controller || controllerCompany !== companyId()) {
      controller?.dispose();
      controllerCompany = companyId();
      controller = createLoginController({ api, companyId: controllerCompany, onChange: setState });
    }
    return controller;
  };
  const onFocus = () => {
    if (!document.hidden && controller) controller.check();
  };
  window.addEventListener("focus", onFocus);
  document.addEventListener("visibilitychange", onFocus);
  onCleanup(() => {
    window.removeEventListener("focus", onFocus);
    document.removeEventListener("visibilitychange", onFocus);
    controller?.dispose();
  });
  return {
    state: state as Accessor<LoginState>,
    begin: (intent: AiConnectionLoginIntent) => get().begin(intent),
    retry: () => get().retry(),
    submitCode: (code: string) => get().submitCode(code),
    connect: (name?: string) => get().connect(name),
    /** Stop polling, as when stepping back from sign-in. The attempt stays resumable. */
    pause: () => controller?.dispose(),
  };
}
