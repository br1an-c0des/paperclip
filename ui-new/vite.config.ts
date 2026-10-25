/// <reference types="vitest/config" />
import path from "path";
import { defineConfig, type ProxyOptions } from "vite";
import solid from "vite-plugin-solid";

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
};

export default defineConfig({
  // Hot reload has no place in tests, and its runtime module breaks Vitest's loader.
  plugins: [solid({ hot: !process.env.VITEST })],
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
