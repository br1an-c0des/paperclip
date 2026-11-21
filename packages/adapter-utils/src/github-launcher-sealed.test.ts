import { execFile } from "node:child_process";
import { createServer } from "node:http";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import { afterEach, describe, expect, it } from "vitest";
import { githubBrokerEnvironment, githubLauncherSource } from "./github-launcher.js";

/**
 * The managed `git`/`gh` launchers as a sealed claude_local run uses them (step 4b, agent F),
 * against a fake broker: no real GitHub credential and no network beyond loopback.
 */

const exec = promisify(execFile);
const cleanups: Array<() => Promise<unknown>> = [];
afterEach(async () => { for (const cleanup of cleanups.splice(0).reverse()) await cleanup(); });

type BrokerAnswer = { status: string; reason?: string; env?: Record<string, string> };

async function fakeBroker(answer: BrokerAnswer): Promise<string> {
  const server = createServer((_req, res) => {
    res.writeHead(200, { "content-type": "application/json" });
    res.end(JSON.stringify(answer));
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  cleanups.push(() => new Promise<void>((resolve) => server.close(() => resolve())));
  return `http://127.0.0.1:${(server.address() as { port: number }).port}`;
}

/** A repo with one staged file, and the managed `git` launcher in front of the real one. */
async function launcherRepo(prefix: string) {
  const root = await mkdtemp(path.join(os.tmpdir(), prefix));
  cleanups.push(() => rm(root, { recursive: true, force: true }));
  const bin = path.join(root, "managed"), repo = path.join(root, "repo");
  await mkdir(bin); await mkdir(repo);
  await exec("git", ["init", "-q", repo]);
  await writeFile(path.join(bin, "git"), githubLauncherSource(), { mode: 0o700 });
  await writeFile(path.join(repo, "work.txt"), "work\n");
  return { root, bin, repo, git: path.join(bin, "git") };
}

describe("managed launchers in a sealed run", () => {
  it("says why a GitHub operation failed when no connection covers the run", async () => {
    const { root, bin, repo, git } = await launcherRepo("paperclip-github-absent-");
    const url = await fakeBroker({ status: "absent", reason: "No GitHub identity connected" });
    const env = { ...process.env, ...githubBrokerEnvironment({}, { url, token: "run-capability" }),
      GH_CONFIG_DIR: path.join(root, "gh-config"), PATH: `${bin}${path.delimiter}${process.env.PATH}` };
    // Nothing listens on port 1: the fetch fails as an unauthenticated private fetch would.
    const failed = exec(git, ["-C", repo, "fetch", "http://127.0.0.1:1/private.git"], { env, timeout: 20_000 });
    await expect(failed).rejects.toMatchObject({
      stderr: expect.stringContaining("this command ran without GitHub credentials (No GitHub identity connected)"),
    });
    // A commit with nothing staged also fails, but not for lack of access: no hint.
    const commit = exec(git, ["-C", repo, "commit", "-m", "empty"], { env });
    await expect(commit).rejects.toMatchObject({ stderr: expect.not.stringContaining("without GitHub credentials") });
  });

  it("adds no hint when the operation succeeds", async () => {
    const { root, bin, repo, git } = await launcherRepo("paperclip-github-absent-ok-");
    const url = await fakeBroker({ status: "absent", reason: "No GitHub identity connected" });
    const env = { ...process.env, ...githubBrokerEnvironment({}, { url, token: "run-capability" }),
      GH_CONFIG_DIR: path.join(root, "gh-config"), PATH: `${bin}${path.delimiter}${process.env.PATH}` };
    const result = await exec(git, ["-C", repo, "stash", "list"], { env });
    expect(result.stderr).not.toContain("without GitHub credentials");
  });
});
