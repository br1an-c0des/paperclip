import { describe, expect, it } from "vitest";
import { createServer } from "node:http";
import {
  listenViteHmrServer,
  resolveViteHmrPort,
} from "../app.ts";

describe("resolveViteHmrPort", () => {
  it("uses serverPort + 10000 when the result stays in range", () => {
    expect(resolveViteHmrPort(3100)).toBe(13_100);
    expect(resolveViteHmrPort(55_535)).toBe(65_535);
  });

  it("falls back below the server port when adding 10000 would overflow", () => {
    expect(resolveViteHmrPort(55_536)).toBe(45_536);
    expect(resolveViteHmrPort(63_000)).toBe(53_000);
  });

  it("never returns a privileged or invalid port", () => {
    expect(resolveViteHmrPort(65_535)).toBe(55_535);
    expect(resolveViteHmrPort(9_000)).toBe(19_000);
  });
});

describe("listenViteHmrServer", () => {
  it("binds the placeholder HMR listener to loopback", async () => {
    const server = createServer();
    await listenViteHmrServer(server, 0, "127.0.0.1");

    expect(server.address()).toMatchObject({ address: "127.0.0.1" });

    await new Promise<void>((resolve, reject) => {
      server.close((error) => error ? reject(error) : resolve());
    });
  });
});
