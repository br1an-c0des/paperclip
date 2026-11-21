import { afterEach, describe, expect, it, vi } from "vitest";
import type { Db } from "@paperclipai/db";
import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import { prepareConnectorSkillDelivery, resolveConnectorAssignments } from "./connector-runtime.js";

const resolvers = vi.hoisted(() => ({
  browser: vi.fn(), speko: vi.fn(), slack: vi.fn(), inboxes: vi.fn(),
}));
vi.mock("./native-runtime/assigned-mcp-tools.js", () => ({ getAssignedMcpGateway: () => ({ browserUseResources: resolvers.browser }) }));
vi.mock("./voice/speko-agent-tools.js", () => ({ spekoAssignedResources: resolvers.speko }));
vi.mock("./connectors/slack.js", () => ({ slackAssignedResource: resolvers.slack, executeGovernedSlackTool: vi.fn() }));
vi.mock("./email-channels.js", () => ({ emailChannelService: () => ({ assignedInboxes: resolvers.inboxes }) }));

afterEach(() => vi.resetAllMocks());

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (error: Error) => void;
  const promise = new Promise<T>((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
}

describe("connector assignment preparation", () => {
  it("starts independent resolvers together and retains connector order", async () => {
    const pending = Array.from({ length: 4 }, () => deferred<Array<{ id: string; label: string; connectionId: string; address: string }>>());
    Object.values(resolvers).forEach((resolver, i) => resolver.mockReturnValue(pending[i].promise));
    const assignments = resolveConnectorAssignments({} as Db, { companyId: "company", agentId: "agent" });
    await vi.waitFor(() => Object.values(resolvers).forEach(resolver => expect(resolver).toHaveBeenCalledOnce()));
    for (const i of [3, 2, 1, 0]) pending[i].resolve([{ id: `resource-${i}`, connectionId: `connection-${i}`, label: "Resource", address: "inbox@example.com" }]);
    expect((await assignments).map(assignment => assignment.key)).toEqual(["browser-use-cloud", "speko", "slack", "agentmail"]);
  });

  it("settles outstanding resolution before propagating a failed connector", async () => {
    const slack = deferred<[]>();
    resolvers.browser.mockResolvedValue([]);
    resolvers.speko.mockRejectedValue(new Error("Speko unavailable"));
    resolvers.slack.mockReturnValue(slack.promise);
    resolvers.inboxes.mockResolvedValue([]);
    let settled = false;
    const assignments = resolveConnectorAssignments({} as Db, { companyId: "company", agentId: "agent" });
    const result = expect(assignments).rejects.toThrow("Speko unavailable").finally(() => { settled = true; });
    await vi.waitFor(() => expect(resolvers.slack).toHaveBeenCalledOnce());
    expect(settled).toBe(false);
    slack.resolve([]);
    await result;
  });
});

describe("connector skill delivery", () => {
  async function connectorConfig(engine?: string) {
    const source = await fs.mkdtemp(path.join(os.tmpdir(), "paperclip-connector-skill-"));
    await fs.writeFile(path.join(source, "SKILL.md"), "---\nname: browser-use-cloud\n---\nUse the browser.\n");
    return {
      ...(engine === undefined ? {} : { engine }),
      paperclipRuntimeSkills: [{
        key: "paperclipai/paperclip/browser-use-cloud",
        runtimeName: "browser-use-cloud",
        source,
        sourceStatus: "available" as const,
      }],
      paperclipConnectorSkillDigest: "digest",
    };
  }

  it.each([undefined, "auto", "cli"])("connector skills for a claude_local agent with engine=%s are staged as files", async (engine) => {
    const config = await connectorConfig(engine);
    const delivery = await prepareConnectorSkillDelivery(config, "claude_local");
    expect(delivery.config.paperclipRuntimeSkills).toEqual(config.paperclipRuntimeSkills);
    expect(delivery.instructions).toBe("");
  });

  it("connector skills for an ACP claude_local agent go in the prompt", async () => {
    const delivery = await prepareConnectorSkillDelivery(await connectorConfig("acp"), "claude_local");
    expect(delivery.config.paperclipRuntimeSkills).toEqual([]);
    expect(delivery.instructions).toContain("Use the browser.");
  });

  it("codex_local still needs an explicit CLI engine for staged files", async () => {
    const delivery = await prepareConnectorSkillDelivery(await connectorConfig(), "codex_local");
    expect(delivery.config.paperclipRuntimeSkills).toEqual([]);
    expect(delivery.instructions).toContain("Use the browser.");
  });
});
