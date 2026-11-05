import { afterEach, describe, expect, it, vi } from "vitest";
import { ApiError } from "@/api/client";
import type { ResolvedPluginSlot } from "./model";
import { activated, mergeActivations, PanelNotReadyError, panelsForActivity, retryAvailability, taskPanelsApi } from "./task-panels-model";

const slot = (id: string, activation?: { namespace: string; activityKey: string }) =>
  ({
    type: "detailTab",
    id,
    displayName: id,
    exportName: id,
    entityTypes: ["agent"],
    pluginId: "p1",
    pluginKey: "acme.browser",
    pluginDisplayName: "Browser",
    pluginVersion: "1.0.0",
    taskSidePanel: { availabilityPath: "/panels/:entityId", ...(activation ? { activation } : {}) },
  }) as unknown as ResolvedPluginSlot;

const run = { runId: "r1", agentId: "a1", issueId: "i1" };
const activity = (payload: unknown, overrides: Record<string, unknown> = {}) => ({
  runId: "r1",
  agentId: "a1",
  issueId: "i1",
  eventType: "runtime.activity.recorded",
  payload: { prpEvent: { eventType: "runtime.activity.recorded", sourceKind: "runner", payload } },
  ...overrides,
});

describe("plugin task panels", () => {
  afterEach(() => vi.unstubAllGlobals());

  it("matches runtime activity to the panels that declared it", () => {
    const browser = slot("browser", { namespace: "acme", activityKey: "browser.opened" });
    const other = slot("other", { namespace: "acme", activityKey: "other" });
    expect(panelsForActivity(activity({ namespace: "acme", activityKey: "browser.opened" }), run, [browser, other])).toEqual([
      { pluginKey: "acme.browser", slotId: "browser" },
    ]);
  });

  it("ignores activity from another run, agent or task, or not from the Runner", () => {
    const browser = slot("browser", { namespace: "acme", activityKey: "browser.opened" });
    const match = { namespace: "acme", activityKey: "browser.opened" };
    expect(panelsForActivity(activity(match, { runId: "r2" }), run, [browser])).toEqual([]);
    expect(panelsForActivity(activity(match, { agentId: "a2" }), run, [browser])).toEqual([]);
    expect(panelsForActivity(activity(match, { issueId: "i2" }), run, [browser])).toEqual([]);
    expect(panelsForActivity(activity(match, { eventType: "adapter.invoke" }), run, [browser])).toEqual([]);
    const fromAdapter = activity(match);
    (fromAdapter.payload as { prpEvent: { sourceKind: string } }).prpEvent.sourceKind = "adapter";
    expect(panelsForActivity(fromAdapter, run, [browser])).toEqual([]);
    // Only the two fields: anything more isn't a plain activity hint.
    expect(panelsForActivity(activity({ ...match, extra: 1 }), run, [browser])).toEqual([]);
  });

  it("only grows the activations", () => {
    const known = [{ pluginKey: "k", slotId: "a" }];
    const merged = mergeActivations(known, [{ pluginKey: "k", slotId: "a" }, { pluginKey: "k", slotId: "b" }]);
    expect(merged).toEqual([{ pluginKey: "k", slotId: "a" }, { pluginKey: "k", slotId: "b" }]);
    expect(mergeActivations(undefined, [])).toEqual([]);
    expect(activated(merged, { pluginKey: "k", id: "b" })).toBe(true);
    expect(activated(merged, { pluginKey: "k", id: "c" })).toBe(false);
  });

  it("checks availability three times at most, and never again after a refusal", () => {
    expect(retryAvailability(0, new PanelNotReadyError())).toBe(true);
    expect(retryAvailability(1, new PanelNotReadyError())).toBe(true);
    expect(retryAvailability(2, new PanelNotReadyError())).toBe(false);
    expect(retryAvailability(0, new ApiError("Forbidden", 403, null))).toBe(false);
    expect(retryAvailability(0, new ApiError("Boom", 500, null))).toBe(true);
  });

  it("asks the plugin with the run and task, and treats a not-ready answer as a failure", async () => {
    const fetch = vi.fn(async () => new Response(JSON.stringify({ available: false }), { status: 200 }));
    vi.stubGlobal("fetch", fetch);
    await expect(taskPanelsApi.availability(slot("browser"), "a 1", "r1", "i1")).rejects.toBeInstanceOf(PanelNotReadyError);
    expect(fetch.mock.calls[0]![0]).toBe("/api/plugins/p1/api/panels/a%201?runId=r1&issueId=i1");
  });
});
