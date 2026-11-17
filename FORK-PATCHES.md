# Fork patches

Since the hard fork (2026-11-17, [fork/hard-fork-plan.md](fork/hard-fork-plan.md)), changes to the
code upstream wrote are ordinary changes in `main`: no `FORK:` markers and no entries here. The soft
fork's code entries (`runner-libc-probe-sync`, `workspace-ui-new`, `lockfile`) are retired; their
changes stay in the tree as ordinary code, and their history is in git (this file before
2026-11-17).

What's left are the two patches the deployment applies to upstream's published image.

## Image patches

Changes the deployment makes to upstream's built image (`deploy/Dockerfile`), not to source,
because the image is still upstream's for `upstream-freeze`. Both copy an upstream pull request
that's still open. Hard-fork step 2 replaces them with the same changes in source, once the
deployment builds from source; then this file goes.

### deploy-runner-provider-authority

- **Files:** none in the source tree. At image build, `deploy/patches/runner-provider-authority.mjs`
  edits two compiled files in upstream's image: `server/dist/vendor/paperclip-runner/drivers/acpx/installed-provider-authority.js`
  and the `server/dist-runtime/chunk-*.mjs` bundle that inlines it (what the server runs). [Fork-only:
  `deploy/patches/runner-provider-authority.mjs`, the step at the end of `deploy/Dockerfile`.]
- **What:** `resolveInstalledProviderAuthority` returns the pnpm workspace root (`/app`) instead of
  the server package (`/app/server`) when the server sits in a workspace, so the server-side ACPX
  verifier accepts the Claude and Codex bridges. A build-time copy of upstream PR
  [#20710](https://github.com/paperclipai/paperclip/pull/20710) (issue #18557), with the same rule
  as `sourceWorkspaceProviderRoot` there.
- **Why:** temporary. Without it, Claude and Codex agents on the Paperclip Runner fail their
  environment test in the Docker image and never run
  ([upstream-fixes 28](fork/upstream-fixes.md#28-let-claude-runner-agents-pass-verification-in-the-docker-image)).
  Added 2026-11-15 at the user's request. Local `pnpm dev` doesn't need it: the failing check only
  applies to the vendored build.
- **Depends on:** a `function resolveInstalledProviderAuthority(` that ends with
  `return { root, manifest };`, in the vendored file and in exactly one `server/dist-runtime/*.mjs`
  file; the image layout (`/app/server` in a workspace with `node_modules/.pnpm`,
  `pnpm-workspace.yaml`, root package `paperclip`); Node with `process.getBuiltinModule` (22.3+).
- **If upstream changes this:** the script skips a copy that already calls
  `sourceWorkspaceProviderRoot`, and fails the image build if the function no longer ends as
  expected. If #20710 (or another fix for #18557) is in the base image: the build log says
  "already has upstream's fix" for both copies; delete the script, the Dockerfile step and this
  entry, If the build fails on a rewrite
  without the fix, update the script to the new code and keep the same rule. To check a new base
  image before deploying (patches only the throwaway container and prints what it did):
  `docker run --rm --network none --entrypoint node -v "$PWD/deploy/patches:/p:ro" ghcr.io/paperclipai/paperclip:sha-<sha> /p/runner-provider-authority.mjs`

### deploy-runner-libc-probe

- **Files:** none in the source tree. At image build, `deploy/patches/runner-libc-probe.mjs` edits
  the `server/dist-runtime/chunk-*.mjs` bundle file that defines `detectLocalRunnerTarget`.
  [Fork-only: `deploy/patches/runner-libc-probe.mjs`, the step at the end of `deploy/Dockerfile`.]
- **What:** the startup glibc check runs synchronously (`execFileSync`) instead of an asynchronous
  `execFile` behind a top-level await. The image-build counterpart of the same change in `main`'s source
  (`server/src/lib/agent-runner-platform.ts`), which never reaches the image; both copy upstream PR
  [#17905](https://github.com/paperclipai/paperclip/pull/17905).
- **Why:** temporary. In the image, the asynchronous check's 1 s timeout sometimes runs out while
  the bundle loads (1 of 3 cold starts in a test on 2026-11-15). The server then caches
  `libc: "unknown"` and offers only the legacy runner for every harness until it restarts
  ([upstream-fixes 6](fork/upstream-fixes.md#6-detect-glibc-reliably-at-server-startup-so-paperclip-runner-is-offered-on-linux)).
  Found after the 2026-11-15 redeploy, when the agent page said "Paperclip Runner isn't available
  for this harness in this environment"; added the same day at the user's request.
- **Depends on:** exactly one `localTarget = await detectLocalRunnerTarget();` (names may carry a
  bundler suffix) in a `server/dist-runtime/*.mjs` file; Node with `process.getBuiltinModule`
  (22.3+).
- **If upstream changes this:** the script skips a file that calls `detectLocalRunnerTarget()`
  without `await`, and fails the image build if it finds neither form. Once #17905 (or another
  fix) is in the base image, the build log says "already has upstream's fix": delete the script,
  its Dockerfile line and this entry, If the build fails on
  a rewrite without the fix, update the script and keep the check synchronous. Check a new base
  image the same way as for [deploy-runner-provider-authority](#deploy-runner-provider-authority),
  with `/p/runner-libc-probe.mjs`.

