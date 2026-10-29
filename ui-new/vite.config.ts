/// <reference types="vitest/config" />
import fs from "fs";
import type { IncomingMessage, ServerResponse } from "http";
import path from "path";
import { defineConfig, type Plugin, type ProxyOptions } from "vite";
import solid from "vite-plugin-solid";

// App and adapter logos (`/brands/apps/linear.svg`…), which the API's app gallery points at, and the
// favicons and home-screen icons (decision 39, D11). The old UI's `ui/public` stays the one copy of
// these: served from there in dev and preview, and copied into `dist` at build, so the production
// image (which builds from the whole repo) has them. ui-new's own `public/` holds what differs: the
// web app manifest and the service worker.
const oldPublicDir = path.resolve(import.meta.dirname, "../ui/public");
const brandsDir = path.join(oldPublicDir, "brands");
export const SHARED_ICONS = [
  "favicon.ico",
  "favicon.svg",
  "favicon-16x16.png",
  "favicon-32x32.png",
  "apple-touch-icon.png",
  "android-chrome-192x192.png",
  "android-chrome-512x512.png",
];
const BRAND_TYPES: Record<string, string> = {
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".webp": "image/webp",
  ".ico": "image/x-icon",
  ".json": "application/json",
  ".md": "text/markdown; charset=utf-8",
};

function sendFile(res: ServerResponse, file: string) {
  fs.stat(file, (error, stat) => {
    if (error || !stat.isFile()) {
      res.statusCode = 404;
      return res.end();
    }
    res.setHeader("Content-Type", BRAND_TYPES[path.extname(file).toLowerCase()] ?? "text/plain; charset=utf-8");
    res.setHeader("Content-Length", stat.size);
    res.setHeader("Cache-Control", "public, max-age=3600");
    fs.createReadStream(file).pipe(res);
  });
}

function serveBrand(req: IncomingMessage, res: ServerResponse, next: () => void) {
  const url = req.url ?? "";
  const icon = url.split(/[?#]/)[0]!.slice(1);
  if (SHARED_ICONS.includes(icon)) return sendFile(res, path.join(oldPublicDir, icon));
  if (!url.startsWith("/brands/")) return next();
  let rel: string;
  try {
    rel = decodeURIComponent(url.slice("/brands/".length).split(/[?#]/)[0]!);
  } catch {
    res.statusCode = 400;
    return res.end();
  }
  const file = path.resolve(brandsDir, rel);
  // Never leave the folder (`..`, absolute paths, encoded separators).
  if (!file.startsWith(brandsDir + path.sep)) {
    res.statusCode = 404;
    return res.end();
  }
  sendFile(res, file);
}

function brands(): Plugin {
  let outDir = "dist";
  return {
    name: "paperclip-brands",
    configResolved(config) {
      outDir = path.resolve(config.root, config.build.outDir);
    },
    configureServer(server) {
      server.middlewares.use(serveBrand);
    },
    configurePreviewServer(server) {
      server.middlewares.use(serveBrand);
    },
    closeBundle() {
      if (process.env.VITEST || !fs.existsSync(brandsDir)) return;
      fs.cpSync(brandsDir, path.join(outDir, "brands"), { recursive: true });
      for (const icon of SHARED_ICONS) fs.copyFileSync(path.join(oldPublicDir, icon), path.join(outDir, icon));
    },
  };
}

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

export default defineConfig({
  // Hot reload has no place in tests, and its runtime module breaks Vitest's loader.
  plugins: [solid({ hot: !process.env.VITEST }), brands(), serviceWorkerBuildId()],
  resolve: {
    alias: {
      "@": path.resolve(import.meta.dirname, "./src"),
    },
  },
  server: {
    // 5173 is the existing React UI, so both can run side by side.
    port: 5174,
    strictPort: true,
    proxy: apiProxy,
  },
  preview: {
    port: 3102,
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
});
