import { describe, expect, it } from "vitest";
import { addressWithPrefix, addressWithSegment, followKey, rememberedId, type KeyMemory } from "./renamed-address";

type Item = { id: string; urlKey: string };
const byKey = (item: Item, key: string) => item.urlKey === key || item.id === key;

describe("followKey", () => {
  it("finds a record by its key and remembers it", () => {
    const memory: KeyMemory = new Map();
    const items = [{ id: "p1", urlKey: "alpha" }];
    expect(followKey(items, "alpha", byKey, memory)?.id).toBe("p1");
    expect(rememberedId(memory, "alpha")).toBe("p1");
  });

  it("keeps finding a renamed record under the key it had", () => {
    const memory: KeyMemory = new Map();
    followKey([{ id: "p1", urlKey: "alpha" }], "alpha", byKey, memory);
    const renamed = [{ id: "p1", urlKey: "beta" }];
    expect(followKey(renamed, "alpha", byKey, memory)).toEqual({ id: "p1", urlKey: "beta" });
    // The new key finds it directly, and the old one still does (an older history entry).
    expect(followKey(renamed, "beta", byKey, memory)?.id).toBe("p1");
    expect(followKey(renamed, "alpha", byKey, memory)?.id).toBe("p1");
  });

  it("prefers a record that has the key now over the one it used to find", () => {
    const memory: KeyMemory = new Map();
    followKey([{ id: "p1", urlKey: "alpha" }], "alpha", byKey, memory);
    const items = [
      { id: "p1", urlKey: "beta" },
      { id: "p2", urlKey: "alpha" },
    ];
    expect(followKey(items, "alpha", byKey, memory)?.id).toBe("p2");
    expect(rememberedId(memory, "alpha")).toBe("p2");
  });

  it("finds nothing for a key it never found, or before the list loads", () => {
    const memory: KeyMemory = new Map();
    expect(followKey([{ id: "p1", urlKey: "beta" }], "alpha", byKey, memory)).toBeUndefined();
    expect(followKey(undefined, "alpha", byKey, memory)).toBeUndefined();
  });

  it("keeps scopes apart", () => {
    const memory: KeyMemory = new Map();
    followKey([{ id: "p1", urlKey: "alpha" }], "alpha", byKey, memory, "company-a");
    expect(followKey([{ id: "p1", urlKey: "beta" }], "alpha", byKey, memory, "company-b")).toBeUndefined();
    expect(followKey([{ id: "p1", urlKey: "beta" }], "alpha", byKey, memory, "company-a")?.id).toBe("p1");
  });

  it("forgets a record that's gone", () => {
    const memory: KeyMemory = new Map();
    followKey([{ id: "p1", urlKey: "alpha" }], "alpha", byKey, memory);
    expect(followKey([{ id: "p2", urlKey: "gamma" }], "alpha", byKey, memory)).toBeUndefined();
  });
});

describe("addressWithSegment", () => {
  it("swaps one path segment and keeps the rest, the query and the fragment", () => {
    const place = { pathname: "/TES/projects/alpha/settings/goals", search: "?goal=g1", hash: "#top" };
    expect(addressWithSegment(place, 2, "beta")).toBe("/TES/projects/beta/settings/goals?goal=g1#top");
  });

  it("works on the record's own address and on a run under an agent", () => {
    expect(addressWithSegment({ pathname: "/TES/projects/alpha", search: "", hash: "" }, 2, "beta")).toBe("/TES/projects/beta");
    expect(addressWithSegment({ pathname: "/TES/agents/old/runs/r1", search: "", hash: "" }, 2, "new")).toBe("/TES/agents/new/runs/r1");
  });

  it("encodes the new key", () => {
    expect(addressWithSegment({ pathname: "/TES/agents/old", search: "", hash: "" }, 2, "a b")).toBe("/TES/agents/a%20b");
  });
});

describe("addressWithPrefix", () => {
  it("moves the address to the new prefix", () => {
    expect(addressWithPrefix({ pathname: "/OLD/company/settings/general", search: "", hash: "#name" }, "OLD", "NEW")).toBe("/NEW/company/settings/general#name");
  });

  it("re-keys task and case identifiers in the path, as the server does", () => {
    expect(addressWithPrefix({ pathname: "/OLD/issues/OLD-12/runs", search: "", hash: "" }, "OLD", "NEW")).toBe("/NEW/issues/NEW-12/runs");
    expect(addressWithPrefix({ pathname: "/old/cases/old-c3", search: "", hash: "" }, "OLD", "NEW")).toBe("/NEW/cases/NEW-C3");
    expect(addressWithPrefix({ pathname: "/OLD/projects/p/issues/OLD-4", search: "", hash: "" }, "OLD", "NEW")).toBe("/NEW/projects/p/issues/NEW-4");
  });

  it("re-keys identifiers in the query and leaves other values alone", () => {
    const place = { pathname: "/OLD/issues", search: "?task=OLD-7&section=runs&q=OLD-thing", hash: "" };
    expect(addressWithPrefix(place, "OLD", "NEW")).toBe("/NEW/issues?task=NEW-7&section=runs&q=OLD-thing");
  });

  it("leaves names that only look like the prefix alone", () => {
    expect(addressWithPrefix({ pathname: "/OLD/projects/old-12", search: "", hash: "" }, "OLD", "NEW")).toBe("/NEW/projects/old-12");
    expect(addressWithPrefix({ pathname: "/OLD/issues/OTHER-12", search: "", hash: "" }, "OLD", "NEW")).toBe("/NEW/issues/OTHER-12");
  });
});
