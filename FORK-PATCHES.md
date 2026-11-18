# Fork patches

Retired. Since 2026-11-17 (hard-fork step 2, [fork/hard-fork-plan.md](fork/hard-fork-plan.md)) the
deployment builds its image from this repo's source ([deploy/README.md](deploy/README.md)), and
changes to the code upstream wrote are ordinary changes in `main`. There are no code patches and no
image patches.

The two image patches this file last listed, `deploy-runner-provider-authority` and
`deploy-runner-libc-probe`, are in source: `sourceWorkspaceProviderRoot` in
`packages/paperclip-runner/src/drivers/acpx/installed-provider-authority.ts` and the synchronous
glibc probe in `server/src/lib/agent-runner-platform.ts`. The history of this file and of
`deploy/patches/` is in git.
