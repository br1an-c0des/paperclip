import { describe, expect, it, vi } from "vitest";
import { randomId } from "./random-id";

const V4 = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;

describe("randomId", () => {
  it("uses crypto.randomUUID where it exists", () => {
    expect(randomId({ randomUUID: () => "11111111-1111-4111-8111-111111111111" })).toBe("11111111-1111-4111-8111-111111111111");
  });

  it("builds a v4 UUID from getRandomValues on plain HTTP", () => {
    const getRandomValues = vi.fn((array: Uint8Array) => array.fill(0xab));
    const id = randomId({ getRandomValues });
    expect(getRandomValues).toHaveBeenCalledOnce();
    expect(id).toBe("abababab-abab-4bab-abab-abababababab");
    expect(id).toMatch(V4);
  });

  it("falls back to getRandomValues when randomUUID throws", () => {
    const id = randomId({
      randomUUID: () => {
        throw new Error("insecure context");
      },
      getRandomValues: (array) => array,
    });
    expect(id).toBe("00000000-0000-4000-8000-000000000000");
  });

  it("still makes distinct v4 UUIDs without any crypto", () => {
    const ids = new Set(Array.from({ length: 50 }, () => randomId(undefined)));
    expect(ids.size).toBe(50);
    for (const id of ids) expect(id).toMatch(V4);
  });

  it("makes v4 UUIDs with the browser's crypto", () => {
    expect(randomId()).toMatch(V4);
  });
});

// U160: plain-HTTP origins have no crypto.randomUUID, so every id goes through randomId.
describe("no direct randomUUID calls", () => {
  const sources = import.meta.glob<string>("/src/**/*.{ts,tsx}", { query: "?raw", import: "default", eager: true });
  const allowed = new Set(["/src/lib/random-id.ts", "/src/lib/random-id.test.ts"]);

  it("reads the source tree", () => {
    expect(Object.keys(sources).length).toBeGreaterThan(100);
    expect(Object.keys(sources)).toContain("/src/lib/random-id.ts");
  });

  it("calls randomUUID only in lib/random-id.ts", () => {
    const offenders = Object.entries(sources)
      .filter(([path]) => !allowed.has(path))
      .flatMap(([path, text]) =>
        text.split("\n").flatMap((line, index) => (/randomUUID/.test(line) ? [`${path.slice(5)}:${index + 1}: ${line.trim()}`] : [])),
      );
    expect(offenders).toEqual([]);
  });
});
