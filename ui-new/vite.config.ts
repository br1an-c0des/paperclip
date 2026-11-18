/// <reference types="vitest/config" />
import { execFileSync } from "child_process";
import fs from "fs";
import path from "path";
import { defineConfig, type Plugin, type ProxyOptions } from "vite";
import solid from "vite-plugin-solid";
import { pluginTailwind } from "./scripts/plugin-tailwind";

// public/ holds the app and adapter logos (`/brands/apps/linear.svg`…), which the API's app gallery
// points at, the favicons and home-screen icons (decision 39, D11), the web app manifest and the
// service worker. They moved here from the old UI's `ui/public` when `ui/` was removed.

// The service worker (public/sw.js) carries a placeholder the production build replaces with an id
// taken from the entry chunk's hash, as ui/src/lib/vite-sw-build-id.ts does for the old UI: each
// deploy that changes the app changes sw.js byte for byte, so browsers install the new worker and
// parked tabs reload onto the new build (src/shell/service-worker-updates.ts). Development serves
// the placeholder, which tells the worker to stay out of the way.
export const SW_BUILD_ID_PLACEHOLDER = "__PAPERCLIP_BUILD_ID__";

export function stampServiceWorker(source: string, buildId: string) {
  if (!source.includes(SW_BUILD_ID_PLACEHOLDER)) {
    throw new Error(`public/sw.js is missing ${SW_BUILD_ID_PLACEHOLDER}; parked tabs would never pick up a deploy`);
  }
  if (!buildId) throw new Error("refusing to stamp the service worker with an empty build id");
  return source.split(SW_BUILD_ID_PLACEHOLDER).join(buildId);
}

export function buildIdFromEntry(fileName: string) {
  return path.basename(fileName).replace(/\.js$/, "").replace(/[^A-Za-z0-9_-]/g, "-") || "build";
}

function serviceWorkerBuildId(): Plugin {
  let buildId = "build";
  let outDir = "dist";
  return {
    name: "paperclip-sw-build-id",
    apply: "build",
    configResolved(config) {
      outDir = path.resolve(config.root, config.build.outDir);
    },
    generateBundle(_options, bundle) {
      const entry = Object.values(bundle).find((chunk) => chunk.type === "chunk" && chunk.isEntry);
      if (entry) buildId = buildIdFromEntry(entry.fileName);
    },
    closeBundle() {
      const file = path.join(outDir, "sw.js");
      if (!fs.existsSync(file)) return;
      fs.writeFileSync(file, stampServiceWorker(fs.readFileSync(file, "utf8"), buildId));
    },
  };
}

// The UI's source commit: PAPERCLIP_UI_COMMIT (deploy/deploy.sh passes it to the Docker build, whose
// context has no .git), else PAPERCLIP_BUILD_COMMIT (the old UI's variable, ui/src/lib/vite-build-commit.ts),
// else `git rev-parse HEAD` (a build or dev server inside the repo), else null. Shown under You in the
// nav (src/shell/BuildVersion.tsx) and part of the build id below.
export function uiCommit(env: Record<string, string | undefined> = process.env, git: () => string = gitHead): string | null {
  for (const value of [env.PAPERCLIP_UI_COMMIT, env.PAPERCLIP_BUILD_COMMIT]) {
    const commit = value?.trim() ?? "";
    if (/^[0-9a-f]{7,40}$/i.test(commit)) return commit.toLowerCase();
  }
  try {
    const commit = git().trim();
    return /^[0-9a-f]{40}$/i.test(commit) ? commit.toLowerCase() : null;
  } catch {
    return null;
  }
}

function gitHead() {
  return execFileSync("git", ["rev-parse", "HEAD"], { cwd: import.meta.dirname, encoding: "utf8", stdio: ["ignore", "pipe", "ignore"], timeout: 1000 });
}

// The build the reads saved for offline belong to (src/lib/offline/persisted-cache.ts): records from
// another build are dropped. The source commit (`uiCommit`), or the time of the build where there's
// none. The dev server is "dev" plus the commit.
function buildStamp(command: "build" | "serve", commit: string | null) {
  if (command === "serve") return `dev-${commit || "local"}`;
  return commit ? `${commit}-${Date.now().toString(36)}` : `build-${Date.now().toString(36)}`;
}

// The Paperclip server (`pnpm dev` at the repo root) listens on :3100.
// Override with PAPERCLIP_API_URL to point at another instance.
const apiTarget = process.env.PAPERCLIP_API_URL ?? "http://localhost:3100";

// Mirrors ui/src/lib/vite-api-proxy.ts. Forwarding the browser's Host as
// x-forwarded-host lets the server's board mutation guard trust the Origin
// even though this app is served from a different port than the API.
const apiProxy: Record<string, ProxyOptions> = {
  "/api": {
    target: apiTarget,
    ws: true,
    configure: (proxy) => {
      proxy.on("proxyReq", (proxyReq, req) => {
        const originalHost = req.headers.host;
        if (!originalHost) return;
        proxyReq.setHeader("x-forwarded-host", originalHost);
        const upstreamProto = req.headers["x-forwarded-proto"];
        const proto = Array.isArray(upstreamProto) ? upstreamProto[0] : upstreamProto;
        const isTls = (req.socket as { encrypted?: boolean }).encrypted === true;
        proxyReq.setHeader("x-forwarded-proto", proto ?? (isTls ? "https" : "http"));
      });
    },
  },
  // Plugin UI bundles (plugin hosting, src/plugins/loader.ts), served by the server next to /api.
  "/_plugins": { target: apiTarget },
};

const commit = uiCommit();
const builtAt = new Date().toISOString();

export default defineConfig(({ command }) => ({
  define: {
    "import.meta.env.VITE_UI_NEW_BUILD_ID": JSON.stringify(process.env.VITEST ? "test" : buildStamp(command, commit)),
    __UI_COMMIT__: JSON.stringify(commit),
    __UI_BUILT_AT__: JSON.stringify(builtAt),
  },
  // Hot reload has no place in tests, and its runtime module breaks Vitest's loader.
  plugins: [solid({ hot: !process.env.VITEST }), serviceWorkerBuildId(), pluginTailwind()],
  resolve: {
    alias: {
      "@": path.resolve(import.meta.dirname, "./src"),
    },
  },
  server: {
    port: 5174,
    strictPort: true,
    // Reaching the dev server from other devices through `tailscale serve`, which keeps the
    // tailnet hostname as Host. The server needs that hostname too: PAPERCLIP_ALLOWED_HOSTNAMES.
    allowedHosts: [".ts.net"],
    proxy: apiProxy,
  },
  preview: {
    port: 3102,
    allowedHosts: [".ts.net"],
    proxy: apiProxy,
  },
  // Tests for view models and key components (build plan, "How it's built"). They run in jsdom so
  // components can render; vite-plugin-solid resolves Solid's browser build for them.
  test: {
    environment: "jsdom",
    include: ["src/**/*.test.{ts,tsx}"],
    setupFiles: ["./src/test/setup.ts"],
    restoreMocks: true,
  },
}));
