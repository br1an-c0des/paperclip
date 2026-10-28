import { describe, expect, it } from "vitest";
import { crc32, createZipArchive } from "./zip";

const decoder = new TextDecoder();

/** Reads a STORE-only archive back: name → contents. */
function readStored(bytes: Uint8Array) {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const end = bytes.length - 22;
  expect(view.getUint32(end, true)).toBe(0x06054b50);
  const count = view.getUint16(end + 10, true);
  let at = view.getUint32(end + 16, true);
  const out: Record<string, Uint8Array> = {};
  for (let i = 0; i < count; i++) {
    expect(view.getUint32(at, true)).toBe(0x02014b50);
    const size = view.getUint32(at + 24, true);
    const nameLength = view.getUint16(at + 28, true);
    const local = view.getUint32(at + 42, true);
    const name = decoder.decode(bytes.subarray(at + 46, at + 46 + nameLength));
    const localNameLength = view.getUint16(local + 26, true);
    const data = bytes.subarray(local + 30 + localNameLength, local + 30 + localNameLength + size);
    expect(crc32(data)).toBe(view.getUint32(at + 16, true));
    out[name] = data;
    at += 46 + nameLength;
  }
  return out;
}

describe("crc32", () => {
  it("matches the standard check value", () => {
    expect(crc32(new TextEncoder().encode("123456789"))).toBe(0xcbf43926);
  });
});

describe("createZipArchive", () => {
  it("stores text and base64 files under the root", () => {
    const zip = createZipArchive({ "README.md": "# Hi ✓", "agents/ceo/AGENTS.md": "be good", "logo.png": { encoding: "base64", data: "AAEC" } }, "test-shell-co");
    const files = readStored(zip);
    expect(Object.keys(files).sort()).toEqual(["test-shell-co/README.md", "test-shell-co/agents/ceo/AGENTS.md", "test-shell-co/logo.png"]);
    expect(decoder.decode(files["test-shell-co/README.md"])).toBe("# Hi ✓");
    expect([...files["test-shell-co/logo.png"]!]).toEqual([0, 1, 2]);
  });

  it("writes an empty archive", () => {
    expect(createZipArchive({}, "x").length).toBe(22);
  });
});
