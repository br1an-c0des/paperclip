import type { Agent, CompanySecret, CompanySecretProviderConfig, SecretProposalView, SecretProviderDescriptor, UserSecretDefinition } from "@paperclipai/shared";
import { describe, expect, it } from "vitest";
import {
  activityLine,
  agentsWithAccess,
  agentUsage,
  awsPathPreview,
  bindingLine,
  builtInStores,
  classifyOrigin,
  coverageShort,
  createProblems,
  createStores,
  defaultEnvKey,
  defaultStore,
  envKeyFromName,
  filterChips,
  filterRows,
  folderCountsLabel,
  grantConfig,
  managedLabel,
  missingMine,
  NO_FILTERS,
  parentFolder,
  parseEnvAssignment,
  recentlyDecided,
  revokeConfig,
  rowAgents,
  secretKeyFromName,
  secretRows,
  sortMine,
  sortPending,
  splitByOrigin,
  usedByLabel,
  vaultDefaultBadge,
  vaultLine,
  vaultSecretCounts,
  whenLabel,
  type CreateForm,
} from "./secrets-model";

/* The redesigned Secrets page's logic (build plan U135, upstream #21225). */

function secret(overrides: Partial<CompanySecret>): CompanySecret {
  return {
    id: "s",
    companyId: "c",
    scope: "company",
    ownerUserId: null,
    userSecretDefinitionId: null,
    key: "k",
    name: "K",
    provider: "local_encrypted",
    status: "active",
    managedMode: "paperclip_managed",
    externalRef: null,
    providerConfigId: null,
    providerMetadata: null,
    latestVersion: 1,
    description: null,
    lastResolvedAt: null,
    lastRotatedAt: null,
    deletedAt: null,
    createdByAgentId: null,
    createdByUserId: null,
    createdAt: new Date("2026-09-12"),
    updatedAt: new Date("2026-09-12"),
    ...overrides,
  };
}

function definition(overrides: Partial<UserSecretDefinition>): UserSecretDefinition {
  return {
    id: "d",
    companyId: "c",
    key: "PERSONAL_GH_TOKEN",
    name: "Personal GitHub token",
    description: null,
    status: "active",
    provider: "local_encrypted",
    managedMode: "paperclip_managed",
    providerConfigId: null,
    providerMetadata: null,
    usageGuidance: null,
    createdByAgentId: null,
    createdByUserId: null,
    updatedByAgentId: null,
    updatedByUserId: null,
    deletedAt: null,
    createdAt: new Date("2026-09-12"),
    updatedAt: new Date("2026-09-12"),
    ...overrides,
  } as UserSecretDefinition;
}

function agent(id: string, adapterConfig: Record<string, unknown>, status = "idle"): Agent {
  return { id, name: id.toUpperCase(), status, adapterConfig } as unknown as Agent;
}

const UUID = "0b9a1c2d-3e4f-5a6b-7c8d-9e0f1a2b3c4d";

describe("the list", () => {
  const rows = secretRows(
    [
      secret({ id: "a", name: "OPENAI_KEY", key: "openai-key", description: "For embeddings" }),
      secret({ id: "b", name: "OLD", status: "archived" }),
      secret({ id: "c", name: "OFF", status: "disabled", provider: "aws_secrets_manager" }),
      secret({ id: "x", name: "GONE", status: "deleted" }),
      secret({ id: "u", name: "MINE", scope: "user" }),
    ],
    [definition({}), definition({ id: "d2", name: "Removed", status: "deleted" })],
  );

  it("joins organization secrets and each user's, without deleted or personal ones", () => {
    expect(rows.map((row) => row.id)).toEqual(["company:c", "company:b", "company:a", "user:d"]);
    expect(rows.find((row) => row.kind === "user")?.key).toBe("PERSONAL_GH_TOKEN");
  });

  it("hides archived secrets until asked, and filters by who provides, storage and text", () => {
    expect(filterRows(rows, NO_FILTERS).map((row) => row.name)).toEqual(["OFF", "OPENAI_KEY", "Personal GitHub token"]);
    expect(filterRows(rows, { ...NO_FILTERS, status: "archived" }).map((row) => row.name)).toEqual(["OLD"]);
    expect(filterRows(rows, { ...NO_FILTERS, status: "disabled" }).map((row) => row.name)).toEqual(["OFF"]);
    expect(filterRows(rows, { ...NO_FILTERS, providedBy: "user" }).map((row) => row.name)).toEqual(["Personal GitHub token"]);
    expect(filterRows(rows, { ...NO_FILTERS, provider: "aws_secrets_manager" }).map((row) => row.name)).toEqual(["OFF", "Personal GitHub token"]);
    expect(filterRows(rows, { ...NO_FILTERS, search: "embed" }).map((row) => row.name)).toEqual(["OPENAI_KEY"]);
    expect(filterRows(rows, { ...NO_FILTERS, search: "gh_token" }).map((row) => row.name)).toEqual(["Personal GitHub token"]);
  });

  it("shows set filters as chips", () => {
    expect(filterChips(NO_FILTERS, () => "")).toEqual([]);
    expect(filterChips({ ...NO_FILTERS, providedBy: "user", provider: "local_encrypted", status: "archived" }, () => "")).toEqual([
      { key: "providedBy", label: "Each user" },
      { key: "provider", label: "Paperclip" },
      { key: "status", label: "Archived" },
    ]);
    expect(filterChips({ ...NO_FILTERS, provider: "aws_secrets_manager" }, () => "AWS")[0]?.label).toBe("AWS");
  });

  it("counts a folder's secrets and folders, and goes up", () => {
    expect(folderCountsLabel(12, 3)).toBe("12 secrets · 3 folders");
    expect(folderCountsLabel(1, 0)).toBe("1 secret");
    expect(parentFolder("a/b/c")).toBe("a/b");
    expect(parentFolder("a")).toBe("");
  });

  it("reads dates as people say them", () => {
    const now = new Date("2026-11-13T12:00:00Z");
    expect(whenLabel(null, now)).toBe("Never");
    expect(whenLabel("2026-11-13T11:59:30Z", now)).toBe("just now");
    expect(whenLabel("2026-11-13T11:50:00Z", now)).toBe("10m ago");
    expect(whenLabel("2026-11-13T09:00:00Z", now)).toBe("3h ago");
    expect(whenLabel("2026-11-11T12:00:00Z", now)).toBe("2d ago");
    expect(whenLabel("2026-10-01T12:00:00Z", now)).toBe("Oct 1");
  });
});

describe("Managed by Paperclip", () => {
  it("reads where a secret came from by the naming conventions", () => {
    expect(classifyOrigin({ key: "tool_app.github.token", name: "GitHub a1b2c3d4" })).toBe("connections");
    expect(classifyOrigin({ key: "slack_manager.bot", name: "Slack" })).toBe("connections");
    expect(classifyOrigin({ key: `ai_${UUID}`, name: "x" })).toBe("models");
    expect(classifyOrigin({ key: "k", name: "chat.slack.abc.botToken" })).toBe("chat");
    expect(classifyOrigin({ key: "k", name: `routine-${UUID}-9f` })).toBe("routines");
    expect(classifyOrigin({ key: "agent_observability_headers_1", name: "x" })).toBe("observability");
    expect(classifyOrigin({ key: "github-token", name: "GITHUB_TOKEN" })).toBe("team");
  });

  it("gives them readable names", () => {
    expect(managedLabel({ key: "k", name: "chat.github.abc.webhookSecret" }, "chat")).toBe("GitHub webhook secret");
    expect(managedLabel({ key: "k", name: `routine-${UUID}-9f` }, "routines")).toBe("Routine webhook secret");
    expect(managedLabel({ key: "k", name: "agent-observability.x" }, "observability")).toBe("Trace exporter headers");
    expect(managedLabel({ key: `ai_${UUID}`, name: `ai_${UUID}` }, "models")).toBe("Model provider key");
    expect(managedLabel({ key: "tool_app.x", name: "Linear token a1b2c3d4" }, "connections")).toBe("Linear token");
  });

  it("keeps the team's rows apart and groups the rest in a fixed order", () => {
    const rows = secretRows(
      [
        secret({ id: "t", name: "GITHUB_TOKEN", key: "github-token" }),
        secret({ id: "c", name: "Linear", key: "tool_app.linear" }),
        secret({ id: "m", name: "x", key: `ai_${UUID}` }),
        secret({ id: "c2", name: "Notion", key: "tool_oauth.notion" }),
      ],
      [],
    );
    const split = splitByOrigin(rows);
    expect(split.team.map((row) => row.id)).toEqual(["company:t"]);
    expect(split.managed.map((group) => [group.group.id, group.rows.length])).toEqual([
      ["models", 1],
      ["connections", 2],
    ]);
    expect(split.managedCount).toBe(3);
  });
});

describe("which agents use a secret", () => {
  const agents = [
    agent("a1", { env: { GITHUB_TOKEN: { type: "secret_ref", secretId: "s1" }, PLAIN: "x" } }),
    agent("a2", { env: { GH: { type: "user_secret_ref", key: "PERSONAL_GH_TOKEN" } }, "access.GH_API": { type: "secret_ref", secretId: "s1" } }),
    agent("a3", { env: { GITHUB_TOKEN: { type: "secret_ref", secretId: "s1" } } }, "terminated"),
  ];

  it("indexes the agents' bindings once, leaving out retired agents", () => {
    const usage = agentUsage(agents);
    expect(usage.bySecretId.get("s1")?.map((entry) => entry.id)).toEqual(["a1", "a2"]);
    expect(usage.byUserKey.get("PERSONAL_GH_TOKEN")?.map((entry) => entry.id)).toEqual(["a2"]);
    const [row] = secretRows([], [definition({})]);
    expect(rowAgents(row!, usage).map((entry) => entry.id)).toEqual(["a2"]);
  });

  it("says who uses it", () => {
    expect(usedByLabel([{ name: "CTO" }])).toBe("CTO");
    expect(usedByLabel([{ name: "A" }, { name: "B" }])).toBe("2 agents");
    expect(usedByLabel([], 2)).toBe("Set in 2 places");
    expect(usedByLabel([], 1)).toBe("Set in 1 place");
    expect(usedByLabel([])).toBe("Not used yet");
  });

  it("lists each agent's env vars and API aliases for the secret", () => {
    const access = agentsWithAccess(agents, { kind: "company", secret: { id: "s1", name: "GITHUB_TOKEN" } });
    expect(access.map((entry) => [entry.agent.id, entry.envKeys, entry.apiAliases])).toEqual([
      ["a1", ["GITHUB_TOKEN"], []],
      ["a2", [], ["GH_API"]],
    ]);
  });

  it("adds a binding without touching the rest, and refuses a taken name", () => {
    const config = { model: "x", env: { OTHER: "y" } };
    expect(grantConfig(config, "CTO", "GITHUB_TOKEN", { kind: "company", secret: { id: "s1", name: "GITHUB_TOKEN" } })).toEqual({
      model: "x",
      env: { OTHER: "y", GITHUB_TOKEN: { type: "secret_ref", secretId: "s1" } },
    });
    expect(grantConfig(undefined, "CTO", "GH", { kind: "user", definition: { id: "d", key: "PERSONAL_GH_TOKEN", name: "n" } })).toEqual({
      env: { GH: { type: "user_secret_ref", key: "PERSONAL_GH_TOKEN" } },
    });
    expect(() => grantConfig(config, "CTO", "OTHER", { kind: "company", secret: { id: "s1", name: "x" } })).toThrow(/CTO already has/);
    expect(config.env).toEqual({ OTHER: "y" });
  });

  it("removes every env var and alias that points at it, or nothing", () => {
    const config = { env: { A: { type: "secret_ref", secretId: "s1" }, B: "keep" }, "access.API": { type: "secret_ref", secretId: "s1" }, other: 1 };
    expect(revokeConfig(config, { kind: "company", secret: { id: "s1", name: "x" } })).toEqual({ env: { B: "keep" }, other: 1 });
    expect(revokeConfig(config, { kind: "company", secret: { id: "s2", name: "x" } })).toBeNull();
  });

  it("names the variable after the secret", () => {
    expect(envKeyFromName("github token")).toBe("GITHUB_TOKEN");
    expect(defaultEnvKey({ kind: "company", secret: { id: "s", name: "staging/api-key" } })).toBe("API_KEY");
    expect(defaultEnvKey({ kind: "user", definition: { id: "d", key: "MY_KEY", name: "Mine" } })).toBe("MY_KEY");
  });
});

describe("New secret", () => {
  const descriptors: SecretProviderDescriptor[] = [
    { id: "local_encrypted", label: "Local encrypted", requiresExternalRef: false, supportsManagedValues: true, supportsExternalReferences: false, configured: true },
    { id: "aws_secrets_manager", label: "AWS Secrets Manager", requiresExternalRef: false, supportsManagedValues: true, supportsExternalReferences: true, supportsExternalValueWrites: true, configured: false },
    { id: "vault", label: "HashiCorp Vault", requiresExternalRef: true, supportsManagedValues: false, supportsExternalReferences: true, configured: true },
  ];
  const vault = (overrides: Partial<CompanySecretProviderConfig>) =>
    ({ id: "v1", provider: "aws_secrets_manager", displayName: "Prod AWS", status: "ready", isDefault: false, healthStatus: null, healthMessage: null, ...overrides }) as CompanySecretProviderConfig;

  it("splits a pasted NAME=value", () => {
    expect(parseEnvAssignment("GITHUB_TOKEN=ghp_123")).toEqual({ name: "GITHUB_TOKEN", value: "ghp_123" });
    expect(parseEnvAssignment('export API_KEY="a=b="')).toEqual({ name: "API_KEY", value: "a=b=" });
    expect(parseEnvAssignment("A=1\nB=2")).toBeNull();
    expect(parseEnvAssignment("just a value")).toBeNull();
    expect(parseEnvAssignment("EMPTY=")).toBeNull();
  });

  it("makes a key as the server does", () => {
    expect(secretKeyFromName("staging/GitHub Token")).toBe("staging-github-token");
  });

  it("offers Paperclip's storage, a working deployment provider, and each vault that's on", () => {
    const stores = createStores(descriptors, [vault({}), vault({ id: "v2", displayName: "Old", status: "disabled" })]);
    expect(stores.map((store) => [store.value, store.label, store.managed, store.external])).toEqual([
      ["local_encrypted:", "Paperclip (default)", true, false],
      ["aws_secrets_manager:v1", "Prod AWS · AWS Secrets Manager", true, true],
      ["vault:", "HashiCorp Vault (this deployment's settings)", false, true],
    ]);
    expect(defaultStore(stores, [])?.value).toBe("local_encrypted:");
  });

  it("drops a provider's own storage once it has a usable vault, and marks the default", () => {
    const local = vault({ id: "l1", provider: "local_encrypted", displayName: "Main" });
    const stores = createStores(descriptors.slice(0, 1), [local]);
    expect(stores.map((store) => store.label)).toEqual(["Main · Paperclip-encrypted (default)"]);
    expect(defaultStore(stores, [local])?.providerConfigId).toBe("l1");
  });

  it("says why a vault or provider can't take it", () => {
    const failing = vault({ healthStatus: "error", healthMessage: "AccessDenied" });
    expect(createStores(descriptors, [failing]).find((store) => store.providerConfigId === "v1")?.blockReason).toBe("AccessDenied");
    const health = { providers: [{ provider: "vault" as const, status: "error" as const, message: "Sealed" }] };
    expect(createStores(descriptors, [], health).some((store) => store.provider === "vault")).toBe(false);
  });

  it("previews where AWS stores a new value", () => {
    const health = { providers: [{ provider: "aws_secrets_manager" as const, status: "ok" as const, message: "", details: { prefix: "pc", deploymentId: "dep" } }] };
    expect(awsPathPreview({ provider: "aws_secrets_manager", providerConfigId: "" }, health, "co", "GitHub token")).toBe("pc/dep/co/github-token");
    expect(awsPathPreview({ provider: "aws_secrets_manager", providerConfigId: "v1" }, health, "co", "x")).toBeNull();
    expect(awsPathPreview({ provider: "local_encrypted", providerConfigId: "" }, health, "co", "x")).toBeNull();
  });

  const form = (overrides: Partial<CreateForm>): CreateForm => ({ providedBy: "company", mode: "managed", name: "", prefix: "", value: "", externalRef: "", key: "", agentIds: [], ...overrides });
  const store = createStores(descriptors, [])[0]!;

  it("says what's missing, field by field", () => {
    const empty = createProblems(form({}), store, false);
    expect(empty.name).toMatch(/name/);
    expect(empty.value).toMatch(/value/);
    expect(empty.blocked).toBe(true);
    expect(createProblems(form({ name: "github/", prefix: "github/" }), store, false).name).toMatch(/name/);
    expect(createProblems(form({ mode: "external", name: "A" }), store, false).value).toMatch(/ARN/);
    const user = createProblems(form({ providedBy: "user", name: "Mine" }), store, false);
    expect(user.value).toBeNull();
    expect(user.key).toMatch(/environment variable/);
    expect(createProblems(form({ name: "A", value: "v" }), { ...store, blockReason: "Off." }, false).store).toBe("Off.");
    const ok = createProblems(form({ name: "staging/GitHub token", value: "v", agentIds: ["a"] }), store, false);
    expect(ok.envKey).toBe("GITHUB_TOKEN");
    expect(ok.blocked).toBe(false);
  });

  it("refuses agent access when the name can't be an environment variable", () => {
    expect(createProblems(form({ name: "9lives", value: "v", agentIds: ["a"] }), store, false).access).toMatch(/letters/);
    expect(createProblems(form({ name: "9lives", value: "v" }), store, false).access).toBeNull();
  });

  it("asks only for a name when editing a user's secret", () => {
    expect(createProblems(form({ providedBy: "user", name: "Mine" }), null, true).blocked).toBe(false);
  });
});

describe("storage and details", () => {
  const configs = [{ id: "v1", provider: "aws_secrets_manager", displayName: "Prod", status: "ready", isDefault: true, healthStatus: "error", healthMessage: "No access" }] as unknown as CompanySecretProviderConfig[];

  it("names where a secret lives only when it's outside Paperclip or linked", () => {
    expect(vaultLine(secret({}), configs)).toBeNull();
    expect(vaultLine(secret({ provider: "aws_secrets_manager", providerConfigId: "v1" }), configs)).toEqual({ linked: false, text: "Stored in Prod · AWS Secrets Manager", unavailable: true });
    expect(vaultLine(secret({ provider: "aws_secrets_manager", managedMode: "external_reference" }), configs)?.text).toBe("Linked from AWS Secrets Manager");
  });

  it("counts secrets per vault and lists the built-in storage first", () => {
    const counts = vaultSecretCounts([secret({}), secret({}), secret({ provider: "aws_secrets_manager", providerConfigId: "v1" }), secret({ provider: "vault" })]);
    expect(counts.get("built-in:local_encrypted")).toBe(2);
    expect(counts.get("v1")).toBe(1);
    const descriptors = [
      { id: "local_encrypted", label: "Local", requiresExternalRef: false, configured: true },
      { id: "aws_secrets_manager", label: "AWS", requiresExternalRef: false, configured: false },
      { id: "vault", label: "HashiCorp Vault", requiresExternalRef: true, configured: false },
    ] as SecretProviderDescriptor[];
    expect(builtInStores(descriptors, configs, counts).map((entry) => [entry.label, entry.isDefault, entry.count])).toEqual([
      ["Paperclip", true, 2],
      ["HashiCorp Vault", false, 1],
    ]);
  });

  it("badges the default vault", () => {
    const local = { id: "l", provider: "local_encrypted", displayName: "Main", status: "ready", isDefault: true, healthStatus: null, healthMessage: null } as unknown as CompanySecretProviderConfig;
    expect(vaultDefaultBadge(local, [local], "Paperclip-encrypted")).toBe("Default");
    const aws = { ...configs[0]!, healthStatus: null } as CompanySecretProviderConfig;
    expect(vaultDefaultBadge(aws, [aws], "AWS")).toBe("Default for AWS");
    expect(vaultDefaultBadge({ ...aws, isDefault: false }, [aws], "AWS")).toBeNull();
  });

  it("tells who read it and how a binding gets it", () => {
    const names = new Map([["a1", "CTO"]]);
    expect(activityLine({ consumerId: "a1", consumerType: "agent", actorId: null, outcome: "success" }, names)).toBe("CTO used it");
    expect(activityLine({ consumerId: "p", consumerType: "plugin_worker", actorId: null, outcome: "not_allowed" }, names)).toBe("Plugin worker was refused: no access");
    expect(bindingLine({ configPath: "env.GITHUB_TOKEN", required: true })).toBe("Env var GITHUB_TOKEN");
    expect(bindingLine({ configPath: "access.GH", required: false })).toBe("API access GH · optional");
  });
});

describe("each user's secrets", () => {
  it("counts who added theirs", () => {
    expect(coverageShort({ definitionId: "d", configuredCount: 1, missingCount: 2, inactiveCount: 1 })).toBe("1 of 4 added");
    expect(coverageShort(undefined)).toBe("");
  });

  it("puts the ones waiting on you first", () => {
    const entries = [
      { definition: { status: "active" as const }, secret: {}, id: "set" },
      { definition: { status: "disabled" as const }, secret: null, id: "off" },
      { definition: { status: "active" as const }, secret: null, id: "missing" },
    ];
    expect(sortMine(entries).map((entry) => entry.id)).toEqual(["missing", "set", "off"]);
    expect(missingMine(entries)).toBe(1);
  });
});

describe("requests", () => {
  const proposal = (overrides: Partial<SecretProposalView>) => ({ id: "p", kind: "binding", status: "pending", createdAt: "2026-11-01T00:00:00Z", resolvedAt: null, ...overrides }) as SecretProposalView;

  it("puts new secrets before access requests, oldest first", () => {
    const list = [proposal({ id: "b1", createdAt: "2026-11-02" }), proposal({ id: "s1", kind: "secret", createdAt: "2026-11-03" }), proposal({ id: "b0", createdAt: "2026-11-01" })];
    expect(sortPending(list).map((entry) => entry.id)).toEqual(["s1", "b0", "b1"]);
  });

  it("merges the decided lists by decision time", () => {
    const approved = [proposal({ id: "a", status: "approved", resolvedAt: "2026-11-05" }), proposal({ id: "stray", status: "pending" })];
    const rejected = [proposal({ id: "r", status: "rejected", resolvedAt: "2026-11-07" })];
    const expired = [proposal({ id: "e", status: "expired", createdAt: "2026-11-06" })];
    expect(recentlyDecided([approved, rejected, expired]).map((entry) => entry.id)).toEqual(["r", "e", "a"]);
    expect(recentlyDecided([approved, rejected, expired], 1).map((entry) => entry.id)).toEqual(["r"]);
    expect(recentlyDecided([undefined, undefined, undefined])).toEqual([]);
  });
});
