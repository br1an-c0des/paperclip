import fs from "node:fs";
import { createIsolatedTestHome } from "./helpers/isolated-test-home.js";
import { probeModuleSingletons, resetModuleSingletons, resetSharedWorkerState } from "./helpers/shared-worker-state.js";
import { beforeEach } from "vitest";
import { createRequire } from "node:module";
import type { AddressInfo, Server as NetServer } from "node:net";
import os from "node:os";
import path from "node:path";
import { Server as TlsServer } from "node:tls";


type SupertestServer = NetServer & {
  address(): ReturnType<NetServer["address"]>;
  listen(port: number): NetServer;
};

type SupertestTestInstance = {
  _server?: SupertestServer;
};

type SupertestTestConstructor = {
  prototype: {
    serverAddress(this: SupertestTestInstance, app: SupertestServer, path: string): string;
    __paperclipLoopbackPatched?: boolean;
  };
};

// Before anything else, put back what the previous test file in this worker changed: environment,
// stubbed globals, fake timers, working directory. Only the `shared` project runs several files in
// one worker; elsewhere this records the baseline and nothing more (helpers/shared-worker-state.ts).
const workerState = resetSharedWorkerState();

// Keep the original home available only for read-only host port-lease checks.
process.env.PAPERCLIP_TEST_HOST_HOME ??= process.env.PAPERCLIP_HOME?.trim() || path.join(os.homedir(), ".paperclip");

// Receipt-spool recovery must never scan a developer's instance during tests.
// Each test file gets its own home, also when files share a worker process
// (`isolate: false`), where this setup file runs again before every file.
const { home: paperclipTestHome, cleanup: cleanupPaperclipTestHome } = createIsolatedTestHome();
process.env.PAPERCLIP_HOME = paperclipTestHome;
process.env.PAPERCLIP_CONFIG = path.join(paperclipTestHome, "config.json");
process.env.PAPERCLIP_INSTANCE_ID = `vt-${process.pid}`;
// Setup-file afterAll hooks run before suites drain asynchronous heartbeats, so the homes are
// removed when the worker stops, after every file's teardown (helpers/shared-worker-state.ts).
workerState.cleanups.push(cleanupPaperclipTestHome);

const require = createRequire(import.meta.url);
const SupertestTest = require("supertest/lib/test.js") as SupertestTestConstructor;

// One Codex home per worker, removed with the test homes.
if (!process.env.CODEX_HOME) {
  if (!workerState.codexHome) {
    const codexHome = fs.mkdtempSync(path.join(os.tmpdir(), "paperclip-vitest-codex-home-"));
    fs.writeFileSync(path.join(codexHome, "auth.json"), '{"OPENAI_API_KEY":"sk-vitest"}\n', { mode: 0o600 });
    workerState.codexHome = codexHome;
    workerState.cleanups.push(() => fs.rmSync(codexHome, { recursive: true, force: true }));
  }
  process.env.CODEX_HOME = workerState.codexHome;
}

// The automatic Tailscale HTTPS default (PAP-17158) probes for a real host
// broker socket, so leaving it enabled would make every test that starts a
// service named `paperclip-dev` behave differently on a broker-capable host
// than on CI. Tests that exercise the default opt in explicitly.
if (!process.env.PAPERCLIP_MANAGED_RUNTIME_HTTPS) {
  process.env.PAPERCLIP_MANAGED_RUNTIME_HTTPS = "off";
}

if (!SupertestTest.prototype.__paperclipLoopbackPatched) {
  SupertestTest.prototype.serverAddress = function serverAddress(app, path) {
    const addr = app.address();

    if (!addr) {
      this._server = app.listen(0) as SupertestServer;
    }

    const listeningAddress = app.address() as AddressInfo | string | null;
    if (!listeningAddress || typeof listeningAddress === "string") {
      throw new Error("Expected Supertest server to listen on a TCP port");
    }

    const host = listeningAddress.address === "::"
      ? "[::1]"
      : listeningAddress.address === "0.0.0.0"
        ? "127.0.0.1"
        : listeningAddress.address;
    const protocol = app instanceof TlsServer ? "https" : "http";
    return `${protocol}://${host}:${listeningAddress.port}${path}`;
  };

  SupertestTest.prototype.__paperclipLoopbackPatched = true;
}

// Report mode only (see helpers/shared-worker-state.ts): what the previous files left set.
if (process.env.PAPERCLIP_TEST_LEAK_REPORT) await probeModuleSingletons();
// Shared workers: reset server modules' process-wide state (run admission, controller lease,
// caches) that the previous file in this worker may have left set.
await resetModuleSingletons(workerState);

beforeEach(async () => {
  const { invalidateInstanceSettingsCache } = await import("../services/instance-settings-cache.js");
  invalidateInstanceSettingsCache();
});
