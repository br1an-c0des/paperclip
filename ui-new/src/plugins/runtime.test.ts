import { beforeAll, describe, expect, it } from "vitest";
import { ApiError } from "@/api/client";
import { SDK_UI_COMPONENTS } from "./loader";
import { loadReactRuntime } from "./runtime";

// The runtime pulls in the icon library, whose first transform is slow under Vitest.
beforeAll(() => loadReactRuntime(), 60_000);

describe("the React runtime", () => {
  it("lends plugins the host's React, ReactDOM and jsx runtime", () => {
    const bridge = globalThis.__paperclipPluginBridge__!;
    expect(typeof bridge.react.createElement).toBe("function");
    expect(typeof bridge.reactDomClient.createRoot).toBe("function");
    expect(typeof bridge.reactDom.createPortal).toBe("function");
    expect(typeof bridge.reactJsxRuntime.jsx).toBe("function");
  });

  it("provides every hook and shared component the SDK declares", () => {
    const sdkUi = globalThis.__paperclipPluginBridge__!.sdkUi;
    for (const name of [
      "usePluginData",
      "usePluginAction",
      "useHostContext",
      "useHostLocation",
      "useHostNavigation",
      "usePluginStream",
      "usePluginToast",
      "copyTextToClipboard",
      ...SDK_UI_COMPONENTS,
    ]) {
      expect(sdkUi[name], name).toBeDefined();
    }
  });

  it("turns bridge failures into the SDK's error shape", async () => {
    const { extractBridgeError } = await import("./react/bridge");
    expect(extractBridgeError(new ApiError("x", 502, { code: "WORKER_UNAVAILABLE", message: "Worker is starting" }))).toEqual({
      code: "WORKER_UNAVAILABLE",
      message: "Worker is starting",
      details: undefined,
    });
    expect(extractBridgeError(new ApiError("x", 404, { error: "Plugin not found" }))).toEqual({ code: "UNKNOWN", message: "Plugin not found" });
    expect(extractBridgeError(new Error("offline"))).toEqual({ code: "UNKNOWN", message: "offline" });
  });
});
