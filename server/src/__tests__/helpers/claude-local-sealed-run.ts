import type { AdapterRuntimeMcpServer } from "@paperclipai/adapter-utils";

export const SEALED_TEST_PAPERCLIP_MCP_URL = "http://127.0.0.1:3100/api/mcp/paperclip";
export const SEALED_TEST_RUN_TOKEN = "run-jwt-token";
export const SEALED_TEST_CLAUDE_TOKEN = "test-token";

/**
 * What a sealed local `claude_local` CLI run needs to start (fork/step-4b-plan.md, Task 7): a run
 * token, the `paperclip` MCP server, and a Claude credential in the agent's env. Spread `env`
 * into the call's `config.env`, and the rest into the execution context.
 */
export function sealedRunInputs(options: {
  authToken?: string;
  /** Servers beside `paperclip`, such as connector tool servers. */
  extraServers?: AdapterRuntimeMcpServer[];
} = {}) {
  const authToken = options.authToken ?? SEALED_TEST_RUN_TOKEN;
  const servers: AdapterRuntimeMcpServer[] = [
    { name: "paperclip", url: SEALED_TEST_PAPERCLIP_MCP_URL, token: authToken, connectionId: "paperclip" },
    ...(options.extraServers ?? []),
  ];
  return {
    authToken,
    runtimeMcp: { getServers: () => servers },
    env: { CLAUDE_CODE_OAUTH_TOKEN: SEALED_TEST_CLAUDE_TOKEN } as Record<string, string>,
  };
}

type SealableContext = {
  config: Record<string, unknown>;
  authToken?: string;
  runtimeMcp?: { getServers(): AdapterRuntimeMcpServer[] };
  executionTarget?: unknown;
};

/**
 * Gives an `execute` context on a local target what `sealedRunInputs` gives, keeping what the
 * call brings itself: its token, its servers (a `paperclip` server is added in front only when
 * the call has none), and its `config.env` over the credential. Remote targets (dormant,
 * unsealed) are returned unchanged.
 */
export function withSealedRunInputs<T extends SealableContext>(ctx: T): T {
  const target = ctx.executionTarget as { kind?: string } | null | undefined;
  if (target?.kind === "remote") return ctx;
  const callServers = ctx.runtimeMcp?.getServers() ?? [];
  const inputs = sealedRunInputs({ authToken: ctx.authToken, extraServers: callServers });
  const configEnv = (ctx.config.env ?? {}) as Record<string, unknown>;
  return {
    ...ctx,
    authToken: inputs.authToken,
    runtimeMcp: callServers.some((server) => server.connectionId === "paperclip")
      ? { getServers: () => callServers }
      : inputs.runtimeMcp,
    config: { ...ctx.config, env: { ...inputs.env, ...configEnv } },
  };
}
