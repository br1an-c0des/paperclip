// FORK: deploy-runner-libc-probe
//
// Build-time patch for upstream's published image, applied by deploy/Dockerfile.
// Temporary: carries upstream PR paperclipai/paperclip#17905 until a published
// upstream image includes it. The source-tree copy of the same fix is the
// runner-libc-probe-sync entry; it never reaches this image, which isn't rebuilt
// from source. See FORK-PATCHES.md and fork/upstream-fixes.md item 6.
//
// Problem: at startup the server checks for glibc by running
// `getconf GNU_LIBC_VERSION` asynchronously, with a 1 s timeout, behind a
// top-level await. While the rest of the server bundle loads, the event loop is
// busy, so the timeout can fire first. The server then caches `libc: "unknown"`
// and offers only the legacy runner for every Runner harness until it restarts.
// In this image that happens on some starts and not others.
//
// Fix: run the same check synchronously (execFileSync), as #17905 does, so
// module loading can't use up its timeout.
//
// For each server/dist-runtime/*.mjs file that defines the check, the script:
//   - leaves it alone if it already calls the check without `await` (upstream's fix);
//   - patches it if it still does `localTarget = await detectLocalRunnerTarget();`;
//   - otherwise fails the build, so an upstream rewrite can't silently skip it.
//
//   node runner-libc-probe.mjs [appRoot]     (default /app)

import { readdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

const appRoot = process.argv[2] ?? "/app";
const DEFINITION = /function detectLocalRunnerTarget\w*\(/;
const AWAITED = /\b(localTarget\w*) = await detectLocalRunnerTarget\w*\(\);/g;
const SYNC = /\blocalTarget\w* = detectLocalRunnerTarget\w*\(\);/;
const HELPER = "__paperclipForkDetectLocalRunnerTarget";

// Mirrors detectLocalRunnerTarget from #17905. Uses process.getBuiltinModule so
// it needs no imports and works in the bundle, whose import names are mangled.
const HELPER_SOURCE = `
// FORK: deploy-runner-libc-probe (upstream PR #17905)
function ${HELPER}() {
  const target = { driver: "local", platform: process.platform, architecture: process.arch };
  if (target.platform !== "linux") return target;
  target.libc = "unknown";
  try {
    const { execFileSync } = process.getBuiltinModule("node:child_process");
    const stdout = execFileSync("getconf", ["GNU_LIBC_VERSION"], {
      encoding: "utf8", timeout: 1000, killSignal: "SIGKILL", maxBuffer: 1024, stdio: ["ignore", "pipe", "ignore"],
    });
    const version = /^glibc\\s+(\\d+\\.\\d+(?:\\.\\d+)?)$/.exec(stdout.trim())?.[1];
    if (version) {
      target.libc = "glibc";
      target.glibcVersion = version;
    }
  } catch {}
  return target;
}
`;

const bundleDir = join(appRoot, "server/dist-runtime");
const files = readdirSync(bundleDir)
  .filter((name) => name.endsWith(".mjs"))
  .map((name) => join(bundleDir, name))
  .filter((path) => DEFINITION.test(readFileSync(path, "utf8")));

if (files.length === 0) fail(`no file in ${bundleDir} defines detectLocalRunnerTarget`);

let patched = 0;
for (const path of files) {
  const text = readFileSync(path, "utf8");
  if (text.includes(HELPER)) {
    console.log(`runner-libc-probe: ${path} is already patched; skipping`);
    continue;
  }
  const awaited = [...text.matchAll(AWAITED)];
  if (awaited.length === 0 && SYNC.test(text)) {
    console.log(`runner-libc-probe: ${path} already has upstream's fix; skipping`);
    continue;
  }
  if (awaited.length !== 1) {
    fail(`${path}: expected one \`localTarget = await detectLocalRunnerTarget();\`, found ${awaited.length}; check whether upstream changed it`);
  }
  const [match, name] = awaited[0];
  const next = text.slice(0, awaited[0].index) + `${name} = ${HELPER}();` + text.slice(awaited[0].index + match.length) + HELPER_SOURCE;
  writeFileSync(path, next);
  console.log(`runner-libc-probe: patched ${path}`);
  patched += 1;
}
console.log(`runner-libc-probe: ${patched} file(s) patched`);

function fail(message) {
  console.error(`runner-libc-probe: ${message}`);
  console.error("Update deploy/patches/runner-libc-probe.mjs, or remove it if upstream merged #17905.");
  process.exit(1);
}
