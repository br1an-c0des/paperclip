import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { runAdapterExecutionTargetProcess } from "./execution-target.js";
import { runChildProcess, sanitizeInheritedPaperclipEnv } from "./server-utils.js";

describe("sanitizeInheritedPaperclipEnv", () => {
  it("drops the host-only Paperclip CLI command pointer", () => {
    expect(sanitizeInheritedPaperclipEnv({
      PAPERCLIPAI_CMD: "node /missing/paperclipai/dist/index.js",
      PAPERCLIP_RUNTIME_API_URL: "http://127.0.0.1:3100",
      PATH: "/usr/bin",
    })).toEqual({
      PAPERCLIP_RUNTIME_API_URL: "http://127.0.0.1:3100",
      PATH: "/usr/bin",
    });
  });
});

const PRINT_ENV = "process.stdout.write(JSON.stringify(process.env))";

async function childEnv(
  env: Record<string, string>,
  inheritHostEnv?: boolean,
): Promise<Record<string, string>> {
  const result = await runChildProcess(`env-test-${Date.now()}`, process.execPath, ["-e", PRINT_ENV], {
    cwd: process.cwd(),
    env,
    timeoutSec: 20,
    graceSec: 2,
    onLog: async () => {},
    ...(inheritHostEnv === undefined ? {} : { inheritHostEnv }),
  });
  expect(result.exitCode).toBe(0);
  return JSON.parse(result.stdout) as Record<string, string>;
}

describe("runChildProcess host environment", () => {
  let previous: string | undefined;

  beforeEach(() => {
    previous = process.env.SEALED_TEST_HOST_ONLY;
    process.env.SEALED_TEST_HOST_ONLY = "x";
  });

  afterEach(() => {
    if (previous === undefined) delete process.env.SEALED_TEST_HOST_ONLY;
    else process.env.SEALED_TEST_HOST_ONLY = previous;
  });

  it("inherits the host environment by default", async () => {
    const env = await childEnv({ FOO: "bar" });
    expect(env.SEALED_TEST_HOST_ONLY).toBe("x");
    expect(env.FOO).toBe("bar");
  });

  it("inheritHostEnv false passes only opts.env", async () => {
    const env = await childEnv({ FOO: "bar", PATH: process.env.PATH ?? "" }, false);
    expect(env.SEALED_TEST_HOST_ONLY).toBeUndefined();
    expect(env.FOO).toBe("bar");
  });

  it("inheritHostEnv false still strips CLAUDECODE", async () => {
    const env = await childEnv({ FOO: "bar", CLAUDECODE: "1", NOTIFY_SOCKET: "/tmp/x" }, false);
    expect(env.CLAUDECODE).toBeUndefined();
    expect(env.NOTIFY_SOCKET).toBeUndefined();
    expect(env.FOO).toBe("bar");
  });

  it("inheritHostEnv false still supplies a PATH", async () => {
    const env = await childEnv({ FOO: "bar" }, false);
    expect(typeof env.PATH).toBe("string");
    expect(env.PATH.length).toBeGreaterThan(0);
  });

  it("a local execution target passes inheritHostEnv through", async () => {
    const result = await runAdapterExecutionTargetProcess(
      `env-test-target-${Date.now()}`,
      { kind: "local" },
      process.execPath,
      ["-e", PRINT_ENV],
      { cwd: process.cwd(), env: { FOO: "bar" }, timeoutSec: 20, graceSec: 2, onLog: async () => {}, inheritHostEnv: false },
    );
    const env = JSON.parse(result.stdout) as Record<string, string>;
    expect(env.SEALED_TEST_HOST_ONLY).toBeUndefined();
    expect(env.FOO).toBe("bar");
  });
});
