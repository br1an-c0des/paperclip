/// <reference types="vitest/config" />
import fs from "fs";
import type { IncomingMessage, ServerResponse } from "http";
import path from "path";
import { defineConfig, type Plugin, type ProxyOptions } from "vite";
import solid from "vite-plugin-solid";

// App and adapter logos (`/brands/apps/linear.svg`…), which the API's app gallery points at. The old
// UI's `ui/public/brands` stays the one copy: served from there in dev and preview, and copied into
// `dist/brands` at build, so the production image (which builds from the whole repo) has them.
const brandsDir = path.resolve(import.meta.dirname, "../ui/public/brands");
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

function serveBrand(req: IncomingMessage, res: ServerResponse, next: () => void) {
  const url = req.url ?? "";
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
  plugins: [solid({ hot: !process.env.VITEST }), brands()],
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
