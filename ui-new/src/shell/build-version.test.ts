import { describe, expect, it } from "vitest";
import { buildVersion, formatBuiltAt, fullCommit, shortCommit } from "./build-version";

const UI = "9F92E49BA0c1d2e3f4a5b6c7d8e9f0a1b2c3d4e5";
const SERVER = "49a2b7b245fec7b78cb4467cb547c06be6d30ea1";

describe("build version", () => {
  it("shortens both commits to 7 characters", () => {
    const version = buildVersion({ uiCommit: UI, uiBuiltAt: "2026-11-16T10:42:00.000Z", serverCommit: SERVER });
    expect(version.line).toBe("ui 9f92e49 · server 49a2b7b");
    expect(version.ui).toBe(UI.toLowerCase());
    expect(version.server).toBe(SERVER);
    expect(version.builtAt).toBe("2026-11-16T10:42:00.000Z");
  });

  it("leaves the server out when health reports no commit", () => {
    expect(buildVersion({ uiCommit: UI, uiBuiltAt: null, serverCommit: null }).line).toBe("ui 9f92e49");
    expect(buildVersion({ uiCommit: UI, uiBuiltAt: null, serverCommit: undefined }).server).toBeNull();
    expect(buildVersion({ uiCommit: UI, uiBuiltAt: null, serverCommit: "" }).line).toBe("ui 9f92e49");
  });

  it("says unknown for a UI built without a commit", () => {
    expect(buildVersion({ uiCommit: null, uiBuiltAt: null, serverCommit: SERVER }).line).toBe("ui unknown · server 49a2b7b");
    expect(buildVersion({ uiCommit: "dev", uiBuiltAt: null, serverCommit: null }).line).toBe("ui unknown");
    expect(buildVersion({ uiCommit: "unknown", uiBuiltAt: null, serverCommit: null }).ui).toBeNull();
  });

  it("accepts short shas and rejects what isn't one", () => {
    expect(shortCommit("abc1234")).toBe("abc1234");
    expect(shortCommit(` ${SERVER}\n`)).toBe("49a2b7b");
    expect(shortCommit("abc123")).toBeNull();
    expect(fullCommit("zzzzzzz")).toBeNull();
  });

  it("drops an invalid build time and formats a valid one", () => {
    expect(buildVersion({ uiCommit: UI, uiBuiltAt: "not a date", serverCommit: null }).builtAt).toBeNull();
    expect(formatBuiltAt(null)).toBe("Unknown");
    expect(formatBuiltAt("2026-11-16T10:42:00.000Z", "en-US", "UTC")).toBe("Nov 16, 2026, 10:42 AM");
  });
});
