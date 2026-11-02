import { describe, expect, it, vi } from "vitest";
import { ApiError } from "@/api/client";
import type { AdapterInfo } from "@/api/agents";
import {
  adapterOverrides,
  clearImportJob,
  defaultCheckedFiles,
  envInputKey,
  fileGroups,
  githubAddress,
  githubLabel,
  githubProblem,
  ImportJobGoneError,
  importAgents,
  importEnvInputs,
  initialEnvValues,
  missingRequired,
  readImportJob,
  runningJobFrom,
  secretValuesPayload,
  selectedFilesPayload,
  storeImportJob,
  watchImportJob,
} from "./import-model";

const adapter = (type: string, extra: Partial<AdapterInfo> = {}): AdapterInfo =>
  ({ type, label: type, source: "builtin", disabled: false, capabilities: {} as never, ...extra }) as AdapterInfo;

describe("GitHub address", () => {
  it("adds https and checks owner and repository", () => {
    expect(githubAddress(" github.com/acme/agents ")).toBe("https://github.com/acme/agents");
    expect(githubProblem("github.com/acme/agents/tree/main/company")).toBeNull();
    expect(githubProblem("")).toMatch(/Enter/);
    expect(githubProblem("http://github.com/acme/agents")).toMatch(/https/);
    expect(githubProblem("github.com/acme")).toMatch(/owner and repository/);
    expect(githubLabel("https://github.com/acme/agents.git")).toBe("acme/agents");
  });
});

describe("files", () => {
  it("groups by top folder, root files first", () => {
    expect(fileGroups(["skills/a/SKILL.md", "COMPANY.md", "agents/ceo/AGENTS.md", "agents/cto/AGENTS.md"])).toEqual([
      { key: "", label: "Package files", paths: ["COMPANY.md"] },
      { key: "agents", label: "agents", paths: ["agents/ceo/AGENTS.md", "agents/cto/AGENTS.md"] },
      { key: "skills", label: "skills", paths: ["skills/a/SKILL.md"] },
    ]);
  });

  it("leaves the company file out of a merge, and sends nothing when every file is picked", () => {
    const preview = {
      plan: { companyAction: "update" },
      manifest: { company: { path: "COMPANY" } },
      files: { "COMPANY.md": "", "agents/ceo/AGENTS.md": "", "projects/web/PROJECT.md": "" },
    } as never;
    const merged = defaultCheckedFiles(preview, true);
    expect([...merged].sort()).toEqual(["agents/ceo/AGENTS.md", "projects/web/PROJECT.md"]);
    expect(defaultCheckedFiles(preview, false).size).toBe(3);
    const all = Object.keys((preview as { files: object }).files);
    expect(selectedFilesPayload(merged, all)).toEqual(["agents/ceo/AGENTS.md", "projects/web/PROJECT.md"]);
    expect(selectedFilesPayload(new Set(all), all)).toBeUndefined();
  });
});

describe("harnesses", () => {
  const preview = {
    plan: { agentPlans: [{ slug: "old", action: "skip" }], projectPlans: [] },
    manifest: {
      agents: [
        { slug: "ceo", name: "CEO", adapterType: "claude_local", adapterConfig: { model: "x", cwd: "/w", instructionsFilePath: "AGENTS.md", dangerouslySkipPermissions: true } },
        { slug: "dev", name: "Dev", adapterType: "hermes_local", adapterConfig: { env: { A: { type: "plain", value: "1" } } } },
        { slug: "run", name: "Runner", adapterType: "paperclip_runner", adapterConfig: { provider: "codex" } },
        { slug: "old", name: "Old", adapterType: "claude_local", adapterConfig: {} },
      ],
    },
  } as never;
  const adapters = [adapter("claude_local"), adapter("codex_local"), adapter("opencode_local"), adapter("paperclip_runner")];

  it("lists imported agents, with a fallback when the harness isn't installed", () => {
    const agents = importAgents(preview, adapters, "codex_local");
    expect(agents.map((agent) => agent.slug)).toEqual(["ceo", "dev", "run"]);
    expect(agents[0]).toMatchObject({ harness: "claude_local", missing: false, fallback: null });
    expect(agents[1]).toMatchObject({ harness: "hermes_local", missing: true, fallback: "codex_local" });
    expect(agents[2]).toMatchObject({ harness: "codex_local", missing: false });
    // Unknown availability: trust the package.
    expect(importAgents(preview, undefined, null)[1]).toMatchObject({ missing: null, fallback: null });
  });

  it("overrides only agents that move, keeping harness-agnostic keys and the model", () => {
    const agents = importAgents(preview, adapters, "codex_local");
    expect(adapterOverrides(agents, {}, {})).toEqual({
      dev: { adapterType: "codex_local", adapterConfig: { env: { A: { type: "plain", value: "1" } } }, runner: "auto" },
    });
    expect(adapterOverrides(agents, { dev: "opencode_local", ceo: "claude_local" }, { dev: " anthropic/claude " })).toEqual({
      dev: { adapterType: "opencode_local", adapterConfig: { env: { A: { type: "plain", value: "1" } }, model: "anthropic/claude" }, runner: "auto" },
    });
    const moved = adapterOverrides(agents, { ceo: "codex_local", dev: "claude_local" }, {});
    expect(moved?.ceo).toEqual({ adapterType: "codex_local", adapterConfig: { cwd: "/w", instructionsFilePath: "AGENTS.md" }, runner: "auto" });
  });

  it("sends a runner choice when a Runner agent's runner is missing", () => {
    const agents = importAgents(preview, [adapter("claude_local"), adapter("codex_local")], null);
    expect(agents[2]).toMatchObject({ missing: true });
    expect(adapterOverrides(agents, { run: "codex_local", dev: "claude_local" }, {})?.run).toEqual({ adapterType: "codex_local", adapterConfig: {}, runner: "auto" });
  });
});

describe("environment values", () => {
  const inputs = [
    { key: "GITHUB_TOKEN", description: null, agentSlug: "ceo", projectSlug: null, kind: "secret", requirement: "required", defaultValue: null, portability: "portable" },
    { key: "REGION", description: null, agentSlug: null, projectSlug: "web", kind: "plain", requirement: "optional", defaultValue: "eu", portability: "portable" },
    { key: "TEAM", description: null, agentSlug: null, projectSlug: null, kind: "plain", requirement: "required", defaultValue: null, portability: "portable" },
    { key: "SKIPPED", description: null, agentSlug: "old", projectSlug: null, kind: "secret", requirement: "required", defaultValue: null, portability: "portable" },
  ] as const;
  const preview = { envInputs: inputs, plan: { agentPlans: [{ slug: "old", action: "skip" }], projectPlans: [] } } as never;

  it("keys values as the server reads them and asks only about imported items", () => {
    expect(inputs.map((input) => envInputKey(input))).toEqual(["agent:ceo:GITHUB_TOKEN", "project:web:REGION", "TEAM", "agent:old:SKIPPED"]);
    const asked = importEnvInputs(preview);
    expect(asked.map((input) => input.key)).toEqual(["GITHUB_TOKEN", "REGION", "TEAM"]);
    const values = initialEnvValues(asked);
    expect(values).toEqual({ "agent:ceo:GITHUB_TOKEN": "", "project:web:REGION": "eu", TEAM: "" });
    expect(missingRequired(asked, values).map((input) => input.key)).toEqual(["GITHUB_TOKEN", "TEAM"]);
    expect(secretValuesPayload(asked, { ...values, TEAM: "  " })).toEqual({ "project:web:REGION": "eu" });
    expect(secretValuesPayload(asked, { "agent:ceo:GITHUB_TOKEN": "", "project:web:REGION": "", TEAM: "" })).toBeUndefined();
  });
});

describe("the running job", () => {
  const memory = () => {
    const map = new Map<string, string>();
    return { getItem: (key: string) => map.get(key) ?? null, setItem: (key: string, value: string) => void map.set(key, value), removeItem: (key: string) => void map.delete(key) };
  };

  it("is kept per company for the session", () => {
    const store = memory();
    expect(readImportJob("c1", store)).toBeNull();
    storeImportJob("c1", { jobId: "j1", label: "acme.zip", target: "existing" }, store);
    expect(readImportJob("c1", store)).toEqual({ jobId: "j1", label: "acme.zip", target: "existing" });
    expect(readImportJob("c2", store)).toBeNull();
    clearImportJob("c1", store);
    expect(readImportJob("c1", store)).toBeNull();
    store.setItem("paperclip:company-import-job:c1", "{not json");
    expect(readImportJob("c1", store)).toBeNull();
  });

  it("adopts the job a 409 names", () => {
    expect(runningJobFrom(new ApiError("busy", 409, { job: { id: "j9" }, statusUrl: "/x" }))).toEqual({ job: { id: "j9", status: "running" }, statusUrl: "/x" });
    expect(runningJobFrom(new ApiError("bad", 422, { job: { id: "j9" } }))).toBeNull();
    expect(runningJobFrom(new Error("x"))).toBeNull();
  });

  it("polls through hiccups until the job settles", async () => {
    const get = vi
      .fn()
      .mockResolvedValueOnce({ job: { id: "j", status: "running" }, retryAfterMs: 10 })
      .mockRejectedValueOnce(new ApiError("gateway", 502, null))
      .mockResolvedValueOnce({ job: { id: "j", status: "succeeded", result: { companyId: "c" } } });
    const wait = vi.fn().mockResolvedValue(undefined);
    const job = await watchImportJob("j", { get, wait, stopped: () => false }, 5);
    expect(job).toMatchObject({ status: "succeeded", result: { companyId: "c" } });
    expect(wait.mock.calls.map((call) => call[0])).toEqual([5, 10, 3000]);
  });

  it("reports a failed or forgotten job, and stops when asked", async () => {
    const wait = vi.fn().mockResolvedValue(undefined);
    await expect(watchImportJob("j", { get: vi.fn().mockResolvedValue({ job: { id: "j", status: "failed", error: { message: "boom" } } }), wait, stopped: () => false })).rejects.toThrow("boom");
    await expect(watchImportJob("j", { get: vi.fn().mockRejectedValue(new ApiError("gone", 404, null)), wait, stopped: () => false })).rejects.toBeInstanceOf(ImportJobGoneError);
    expect(await watchImportJob("j", { get: vi.fn(), wait, stopped: () => true })).toBeNull();
  });
});
