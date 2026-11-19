import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { configDefaults, defineConfig } from "vitest/config";

const serverRoot = path.dirname(fileURLToPath(import.meta.url));
const include = ["src/**/*.test.ts", "scripts/**/*.test.mjs"];

// The server's test files run in two projects (see fork/test-suite-audit/results-overhead.md):
//
// - `shared` (`isolate: false`): one worker process runs many files one after another, so the
//   server's module graph (~4 s to evaluate) loads once per worker instead of once per file.
// - `isolated` (`isolate: true`): a fresh process per file, as before.
//
// A file goes to `isolated` when it replaces modules. A module mocked in one file stays mocked,
// through every module that imported it, for the files that run after it in the same worker, and
// a file's own mock doesn't reach modules an earlier file already loaded. These calls mark it:
const MODULE_REPLACEMENT =
  /\bvi\s*\.\s*(?:mock|doMock|unmock|doUnmock|resetModules|importActual|importMock|hoisted)\s*\(/;

// Files without those calls that still fail when they share a worker with other files. Paths are
// relative to server/.
const ISOLATED_BY_NAME = new Set<string>([]);

function serverTestFiles() {
  return fs
    .globSync(include, { cwd: serverRoot, exclude: (name) => path.basename(name) === "node_modules" })
    .map((file) => file.split(path.sep).join("/"))
    .sort();
}

export const isolatedTestFiles = serverTestFiles().filter(
  (file) =>
    ISOLATED_BY_NAME.has(file) ||
    MODULE_REPLACEMENT.test(fs.readFileSync(path.join(serverRoot, file), "utf8")),
);

export default defineConfig({
  resolve: {
    alias: [
      {
        find: /^@paperclipai\/paperclip-runner\/live$/,
        replacement: fileURLToPath(
          new URL("../packages/paperclip-runner/src/live/index.ts", import.meta.url),
        ),
      },
      {
        find: /^@paperclipai\/paperclip-runner$/,
        replacement: fileURLToPath(
          new URL("../packages/paperclip-runner/src/index.ts", import.meta.url),
        ),
      },
    ],
  },
  test: {
    environment: "node",
    // Each server suite boots + tears down its own embedded Postgres in
    // beforeAll/afterAll. Under the loaded serial shard (maxWorkers=1) the
    // graceful shutdown can occasionally cross vitest's default 10s hookTimeout,
    // producing flaky "Hook timed out in 10000ms" afterAll failures on CI. Give
    // the boot/teardown hooks generous headroom; 30s is far above the observed
    // worst-case teardown yet still catches a genuinely hung hook. teardownTimeout
    // mirrors it for the same reason.
    hookTimeout: 30000,
    teardownTimeout: 30000,
    // The route/authz suites import very large modules (for example
    // src/routes/issues.ts and its dependency graph). The first test in each
    // file pays the one-time transform cost inside its own timeout budget. On
    // the loaded serial shard (maxWorkers=1) that cost can cross vitest's
    // default 5s testTimeout and fail the first test, which also lets its
    // fire-and-forget wake leak into the next test. Give each test generous
    // headroom; 15s is far above the observed module-load cost yet still
    // catches a genuinely hung test well inside the 20 minute job limit.
    testTimeout: 15000,
    // Persist transformed modules across runs (node_modules/.vitest-cache at the workspace root).
    // Keys hash each module's source and the config, so an edited file is re-transformed.
    fsModuleCache: true,
    maxConcurrency: 1,
    maxWorkers: 1,
    pool: "forks",
    // Server suites share process state and one embedded Postgres instance,
    // so tests inside a file must run one at a time. Do not set
    // sequence.concurrent to true.
    sequence: {
      concurrent: false,
      hooks: "list",
    },
    setupFiles: ["./src/__tests__/setup-supertest.ts"],
    // Run from the repo root these are `@paperclipai/server (shared)` and
    // `@paperclipai/server (isolated)`; `--project @paperclipai/server` selects both.
    projects: [
      {
        extends: true,
        test: {
          name: "shared",
          include,
          exclude: [...configDefaults.exclude, ...isolatedTestFiles],
          // Isolated for now (2026-11-18): without isolation, about 39 files failed in a full run
          // because state leaks from earlier files in the same worker (Cloud runtime config,
          // PAPERCLIP_MANAGED_CONFIG, counters). Step 3a round 2 finds the leaking files; then
          // this goes back to `false` (bench set: 116 s against 127 s at 6 workers).
          isolate: true,
        },
      },
      {
        extends: true,
        test: {
          name: "isolated",
          include: isolatedTestFiles,
          isolate: true,
        },
      },
    ],
  },
});
