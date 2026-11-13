import { describe, expect, it } from "vitest";
import { ApiError } from "@/api/client";
import { modelStillUnavailableToast } from "./model-retry";

const agent = { id: "agent-1", name: "Morgan", urlKey: "morgan" };
const refusal = (setting: string) =>
  new ApiError('The provider rejected the model "bad/model", and it is still selected.', 409, {
    error: 'The provider rejected the model "bad/model", and it is still selected.',
    details: { code: "native_provider_model_still_unavailable", setting, rejectedModel: "bad/model", agentId: "agent-1" },
  });

describe("modelStillUnavailableToast (#21244)", () => {
  it("names the refusal and links to the agent's model settings", () => {
    expect(modelStillUnavailableToast(refusal("agent_model"), agent, "TES")).toMatchObject({
      tone: "error",
      title: "Model still unavailable",
      body: expect.stringContaining("still selected"),
      action: { label: "Open Morgan's model settings", href: "/TES/agents/morgan/runtime" },
    });
  });

  it("explains a task model override without linking away from the task", () => {
    const toast = modelStillUnavailableToast(refusal("task_model_override"), agent, "TES");
    expect(toast?.title).toBe("Model still unavailable");
    expect(toast?.action).toBeUndefined();
  });

  it("falls back to the agent's id without a URL key, and leaves other failures to the usual message", () => {
    expect(modelStillUnavailableToast(refusal("agent_model"), { id: "agent-1", name: "Morgan" }, "TES")?.action?.href).toBe("/TES/agents/agent-1/runtime");
    expect(modelStillUnavailableToast(new ApiError("Conflict", 409, { error: "Conflict" }), agent, "TES")).toBeNull();
    expect(modelStillUnavailableToast(new Error("network"), agent, "TES")).toBeNull();
  });
});
