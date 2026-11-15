// FORK: deploy-runner-provider-authority
//
// Build-time patch for upstream's published image, applied by deploy/Dockerfile.
// Temporary: carries upstream PR paperclipai/paperclip#20710 (issue #18557)
// until a published upstream image includes it. See FORK-PATCHES.md and
// fork/upstream-fixes.md item 28.
//
// Problem: in the image the server package (/app/server) sits inside a pnpm
// workspace, so its node_modules entries for the Claude and Codex ACP bridges
// are symlinks into /app/node_modules/.pnpm. The server-side ACPX verifier
// takes /app/server as the provider root and rejects both bridges ("resolves
// outside the selected provider root"), so Claude agents on the Paperclip
// Runner never pass their environment test.
//
// Fix: make resolveInstalledProviderAuthority return the workspace root for
// that layout, using the same rule runnerd already applies (#15912). The
// manifest (the server package) stays the authority.
//
// The function exists twice: in the vendored runner module and inlined in the
// server bundle (server/dist-runtime/chunk-*.mjs, which is what the server
// runs). Both are patched. For each copy the script:
//   - leaves it alone if it already has upstream's fix (sourceWorkspaceProviderRoot);
//   - patches it if the function still ends with `return { root, manifest };`;
//   - otherwise fails the build, so an upstream rewrite can't silently skip it.
//
//   node runner-provider-authority.mjs [appRoot]     (default /app)

import { readdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

const appRoot = process.argv[2] ?? "/app";
const FUNCTION = "function resolveInstalledProviderAuthority(";
const RETURN = "return { root, manifest };";
const HELPER = "__paperclipForkWorkspaceProviderRoot";
const PATCHED_RETURN = `return { root: ${HELPER}(root) ?? root, manifest };`;

// Mirrors sourceWorkspaceProviderRoot from #20710. Uses process.getBuiltinModule
// so it needs no imports and works in the bundle, whose import names are mangled.
const HELPER_SOURCE = `
// FORK: deploy-runner-provider-authority (upstream PR #20710)
function ${HELPER}(serverRoot) {
  const { existsSync, readFileSync } = process.getBuiltinModule("node:fs");
  const { basename, dirname, resolve } = process.getBuiltinModule("node:path");
  const workspaceRoot = dirname(serverRoot);
  if (basename(serverRoot) !== "server" ||
      existsSync(resolve(serverRoot, "node_modules/.pnpm")) ||
      !existsSync(resolve(workspaceRoot, "node_modules/.pnpm")) ||
      !existsSync(resolve(workspaceRoot, "pnpm-workspace.yaml")) ||
      !existsSync(resolve(workspaceRoot, "package.json"))) {
    return undefined;
  }
  const workspace = JSON.parse(readFileSync(resolve(workspaceRoot, "package.json"), "utf8"));
  const server = JSON.parse(readFileSync(resolve(serverRoot, "package.json"), "utf8"));
  return workspace.name === "paperclip" && workspace.private === true && server.name === "@paperclipai/server"
    ? workspaceRoot
    : undefined;
}
`;

const vendored = join(appRoot, "server/dist/vendor/paperclip-runner/drivers/acpx/installed-provider-authority.js");
const bundleDir = join(appRoot, "server/dist-runtime");
const bundles = readdirSync(bundleDir)
  .filter((name) => name.endsWith(".mjs"))
  .map((name) => join(bundleDir, name))
  .filter((path) => readFileSync(path, "utf8").includes(FUNCTION));

if (bundles.length === 0) fail(`no file in ${bundleDir} defines resolveInstalledProviderAuthority`);

let patched = 0;
for (const path of [vendored, ...bundles]) {
  const text = readFileSync(path, "utf8");
  const start = text.indexOf(FUNCTION);
  if (start < 0) fail(`${path} doesn't define resolveInstalledProviderAuthority`);
  if (text.indexOf(FUNCTION, start + 1) >= 0) fail(`${path} defines resolveInstalledProviderAuthority more than once`);
  if (text.includes(HELPER)) {
    console.log(`runner-provider-authority: ${path} is already patched; skipping`);
    continue;
  }
  // The function body: from its declaration to the next top-level declaration.
  const next = text.slice(start + FUNCTION.length).search(/\n(?:export |async )?function |\n(?:var|let|const|class) |\n\/\/ /);
  const body = next < 0 ? text.slice(start) : text.slice(start, start + FUNCTION.length + next);
  if (body.includes("sourceWorkspaceProviderRoot")) {
    console.log(`runner-provider-authority: ${path} already has upstream's fix; skipping`);
    continue;
  }
  const at = body.lastIndexOf(RETURN);
  if (at < 0 || body.indexOf(RETURN) !== at) {
    fail(`${path}: resolveInstalledProviderAuthority no longer ends with \`${RETURN}\`; check whether upstream changed it`);
  }
  const offset = start + at;
  writeFileSync(path, text.slice(0, offset) + PATCHED_RETURN + text.slice(offset + RETURN.length) + HELPER_SOURCE);
  console.log(`runner-provider-authority: patched ${path}`);
  patched += 1;
}
console.log(`runner-provider-authority: ${patched} file(s) patched`);

function fail(message) {
  console.error(`runner-provider-authority: ${message}`);
  console.error("Update deploy/patches/runner-provider-authority.mjs, or remove it if upstream fixed #18557.");
  process.exit(1);
}
