import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import {
  companySecrets,
  connectionGrants,
  createDb,
  toolApplications,
  toolConnectionInstalls,
  toolConnections,
} from "@paperclipai/db";
import { githubCredentialsFixture } from "./helpers/github-credentials-fixture.js";
import {
  getEmbeddedPostgresTestSupport,
  startEmbeddedPostgresTestDatabase,
} from "./helpers/embedded-postgres.js";
import { resolveGitHubOperationCredentials } from "../services/github-operation-credentials.js";
import { resolveManagedGitHubIdentitySelection } from "../services/git-credentials.js";

// Bug 100: a GitHub connection set up with one shared token (an organization grant whose
// credential is the `credentials.authorization` header) gives runs that token for git, gh and
// the connector's tools when no sign-in of the agent's own or of the responsible person matches.

const vault = vi.hoisted(() => ({
  resolveUserSecretValue: vi.fn(
    async (_company: string, input: { responsibleUserId: string }) => ({
      value: `test-token-${input.responsibleUserId}`,
    }),
  ),
  resolveSecretValue: vi.fn(async () => "github_pat_shared"),
}));
vi.mock("../services/secrets.js", () => ({ secretService: () => vault }));

const support = await getEmbeddedPostgresTestSupport();
(support.supported ? describe : describe.skip)("a GitHub connection's shared token", () => {
  let database: Awaited<ReturnType<typeof startEmbeddedPostgresTestDatabase>> | undefined;
  let db: ReturnType<typeof createDb>;
  beforeAll(async () => {
    vi.stubEnv("PAPERCLIP_AGENT_JWT_SECRET", "test-github-shared-token-secret");
    database = await startEmbeddedPostgresTestDatabase("paperclip-github-shared-token-");
    db = createDb(database.connectionString);
  }, 30_000);
  afterAll(async () => {
    await db?.$client.end({ timeout: 1 });
    await database?.cleanup();
    vi.unstubAllEnvs();
  }, 60_000);
  beforeEach(() => vault.resolveSecretValue.mockClear());

  const { seed, grant } = githubCredentialsFixture(() => db);

  /** A company-wide GitHub connection holding one token, the way the connection settings save a fine-grained token. */
  async function sharedConnection(
    input: Awaited<ReturnType<typeof seed>>,
    options: { configPath?: string } = {},
  ) {
    const applicationId = randomUUID(), connectionId = randomUUID(), secretId = randomUUID(), grantId = randomUUID();
    await db.insert(toolApplications).values({ id: applicationId, companyId: input.companyId, name: applicationId, type: "mcp_http" });
    await db.insert(toolConnections).values({
      id: connectionId, companyId: input.companyId, applicationId, name: "GitHub", uid: connectionId,
      transport: "mcp_remote", status: "active", enabled: true, credentialPolicy: "shared",
      config: { sourceTemplateKey: "github" }, transportConfig: { sourceTemplateKey: "github" },
    });
    await db.insert(toolConnectionInstalls).values({
      companyId: input.companyId, connectionId, targetType: "company", targetId: input.companyId,
    });
    await db.insert(companySecrets).values({
      id: secretId, companyId: input.companyId, key: secretId, name: `GitHub token ${secretId.slice(0, 8)}`, scope: "company",
    });
    await db.insert(connectionGrants).values({
      id: grantId, companyId: input.companyId, connectionId, kind: "organization", status: "active",
      credentialSecretRefs: [{ secretId, configPath: options.configPath ?? "credentials.authorization", versionSelector: "latest" }],
    });
    return { connectionId, secretId, grantId };
  }

  it("selects the shared token when nobody has signed in", async () => {
    const input = await seed();
    const shared = await sharedConnection(input);
    await expect(resolveManagedGitHubIdentitySelection(db, input.companyId, {
      agentId: input.agentId, responsibleUserId: "A", allowStandingDelegation: false,
    })).resolves.toMatchObject({ configured: true, identitySource: "shared", grant: { id: shared.grantId } });
    await expect(resolveManagedGitHubIdentitySelection(db, input.companyId, {
      agentId: input.agentId, responsibleUserId: null, allowStandingDelegation: false,
    })).resolves.toMatchObject({ configured: true, identitySource: "shared", grant: { id: shared.grantId } });
  });

  it("keeps a sign-in of the responsible person, or of the agent, ahead of the shared token", async () => {
    const input = await seed();
    await sharedConnection(input);
    const personal = await grant(input, "A");
    await expect(resolveManagedGitHubIdentitySelection(db, input.companyId, {
      agentId: input.agentId, responsibleUserId: "A", allowStandingDelegation: false,
    })).resolves.toMatchObject({ identitySource: "personal", grant: { id: personal.id } });
    const dedicated = await grant(input, "bot", true);
    await expect(resolveManagedGitHubIdentitySelection(db, input.companyId, {
      agentId: input.agentId, responsibleUserId: "A", allowStandingDelegation: false,
    })).resolves.toMatchObject({ identitySource: "dedicated", grant: { id: dedicated.id } });
  });

  it("ignores an organization grant without a token", async () => {
    const input = await seed();
    await sharedConnection(input, { configPath: "oauth.client_secret" });
    await expect(resolveManagedGitHubIdentitySelection(db, input.companyId, {
      agentId: input.agentId, responsibleUserId: "A", allowStandingDelegation: false,
    })).resolves.toMatchObject({ configured: true, error: "No managed GitHub identity is available for this run" });
  });

  it("refuses to choose between two shared tokens", async () => {
    const input = await seed();
    await sharedConnection(input);
    await sharedConnection(input);
    const selection = await resolveManagedGitHubIdentitySelection(db, input.companyId, {
      agentId: input.agentId, responsibleUserId: "A", allowStandingDelegation: false,
    });
    expect(selection).toMatchObject({ configured: true, error: "More than one managed GitHub identity matches this run" });
    expect(selection.grant).toBeUndefined();
  });

  it("gives a run's git and gh the shared token", async () => {
    const input = await seed();
    const shared = await sharedConnection(input);
    const result = await resolveGitHubOperationCredentials(db, input);
    expect(result).toMatchObject({
      status: "available", source: "shared", connectionId: shared.connectionId, grantId: shared.grantId, authenticationMode: "managed",
    });
    expect(result.env).toMatchObject({ GH_TOKEN: "github_pat_shared", GITHUB_TOKEN: "github_pat_shared" });
    // A token doesn't say whose it is: the launchers make the agent the committer.
    expect(result.env.GIT_COMMITTER_NAME).toBeUndefined();
    expect(vault.resolveSecretValue).toHaveBeenCalledWith(input.companyId, shared.secretId, "latest", expect.anything());
  });

  it("drops an Authorization scheme saved with the token", async () => {
    const input = await seed();
    await sharedConnection(input);
    vault.resolveSecretValue.mockResolvedValueOnce("Bearer github_pat_with_scheme");
    const result = await resolveGitHubOperationCredentials(db, input);
    expect(result.env).toMatchObject({ GH_TOKEN: "github_pat_with_scheme" });
  });
});
