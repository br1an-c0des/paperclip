/*
 * The one place ui-new makes random ids: request and idempotency keys, local write ids, and ids for
 * rows the UI adds before saving them (U160, after ui/src/lib/uuid.ts in #20308).
 *
 * `crypto.randomUUID` exists only in secure contexts, so a board served over plain HTTP (a LAN or
 * Tailscale address) doesn't have it. Without it, a v4 UUID is built from `crypto.getRandomValues`,
 * which plain HTTP still has, and where even that is missing, from `Math.random`: not for secrets,
 * but enough for keys the server dedupes by. random-id.test.ts fails if anything else in src/ calls
 * `randomUUID` itself.
 */

type CryptoLike = { randomUUID?: () => string; getRandomValues?: (array: Uint8Array) => unknown };

function format(bytes: Uint8Array) {
  bytes[6] = (bytes[6]! & 0x0f) | 0x40;
  bytes[8] = (bytes[8]! & 0x3f) | 0x80;
  const hex = Array.from(bytes, (byte) => byte.toString(16).padStart(2, "0")).join("");
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

function browserCrypto(): CryptoLike | undefined {
  return typeof globalThis === "undefined" ? undefined : (globalThis.crypto as CryptoLike | undefined);
}

/** A v4 UUID, also on plain HTTP. `source` is for tests; it defaults to the browser's `crypto`. */
export function randomId(source: CryptoLike | undefined = browserCrypto()): string {
  if (typeof source?.randomUUID === "function") {
    try {
      return source.randomUUID();
    } catch {
      // Some browsers expose it and throw outside a secure context.
    }
  }
  const bytes = new Uint8Array(16);
  if (typeof source?.getRandomValues === "function") {
    try {
      source.getRandomValues(bytes);
      return format(bytes);
    } catch {
      // Fall through to the non-crypto fallback.
    }
  }
  for (let index = 0; index < bytes.length; index += 1) bytes[index] = Math.floor(Math.random() * 256);
  return format(bytes);
}
