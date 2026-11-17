import { expect, type BrowserContext, type Route } from "@playwright/test";

/*
 * The fake Paperclip API the smoke suite runs against. It answers the app's `/api/*` and
 * `/_plugins/*` requests from a table of handlers (fixtures/handlers.ts registers the default set,
 * a test can add or override its own), so no request ever reaches a server.
 *
 * - A request with no handler is answered `501` with a message naming it, and listed in
 *   `unmocked`; the test fixture fails the test when that list isn't empty. A missing fixture shows
 *   up as a failure naming the request, never as a hang.
 * - Every write (POST, PATCH, PUT, DELETE) is recorded in `writes` with its parsed body, whether or
 *   not a handler answers it, so a test can assert what would have been sent.
 * - The live-events socket is answered by a fake socket that stays open and says nothing; `emit`
 *   pushes an event down it.
 * - In live mode (`E2E_LIVE=1`) reads go through to the dev server's proxy (and on to :3100);
 *   writes are still answered here, by their handler or with `{}`, and never sent.
 */

export type Method = "GET" | "POST" | "PATCH" | "PUT" | "DELETE";

export type MockRequest = {
  method: Method;
  /** The path after `/api`, without the query: `/companies/c1/issues`. */
  path: string;
  query: URLSearchParams;
  params: Record<string, string>;
  /** The JSON body, parsed; the raw text when it isn't JSON; null for none or a form. */
  body: unknown;
};

export type RecordedRequest = MockRequest & { url: string };

/** A handler's answer: a value is sent as JSON with status 200; `reply()` sets the status. */
export type Reply = { __reply: true; status: number; body: unknown; contentType?: string };
export type Handler = (req: MockRequest) => unknown | Reply | Promise<unknown | Reply>;

export function reply(status: number, body: unknown = null, contentType?: string): Reply {
  return { __reply: true, status, body, contentType };
}

const isReply = (value: unknown): value is Reply => !!value && typeof value === "object" && (value as Reply).__reply === true;

type Entry = { method: Method; pattern: string; regex: RegExp; keys: string[]; handler: Handler };

/** `/companies/:companyId/issues/*` → a regex with named segments; `*` matches the rest. */
function compile(pattern: string) {
  const keys: string[] = [];
  const source = pattern
    .split("/")
    .map((segment) => {
      if (segment === "*") return ".*";
      if (segment.startsWith(":")) {
        keys.push(segment.slice(1));
        return "([^/]+)";
      }
      return segment.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    })
    .join("/");
  return { regex: new RegExp(`^${source}$`), keys };
}

const WRITE_METHODS = new Set<Method>(["POST", "PATCH", "PUT", "DELETE"]);

export class MockApi {
  readonly live: boolean;
  private entries: Entry[] = [];
  readonly requests: RecordedRequest[] = [];
  readonly writes: RecordedRequest[] = [];
  readonly unmocked: string[] = [];
  private sockets: Array<{ send: (message: string) => void }> = [];

  constructor(options: { live?: boolean } = {}) {
    this.live = !!options.live;
  }

  /** Registers a handler. A later registration for the same request wins, so tests can override defaults. */
  on(method: Method, pattern: string, handler: Handler) {
    const { regex, keys } = compile(pattern);
    this.entries.unshift({ method, pattern, regex, keys, handler });
    return this;
  }
  get(pattern: string, handler: Handler) {
    return this.on("GET", pattern, handler);
  }
  post(pattern: string, handler: Handler) {
    return this.on("POST", pattern, handler);
  }
  patch(pattern: string, handler: Handler) {
    return this.on("PATCH", pattern, handler);
  }
  put(pattern: string, handler: Handler) {
    return this.on("PUT", pattern, handler);
  }
  delete(pattern: string, handler: Handler) {
    return this.on("DELETE", pattern, handler);
  }

  /** Sends a live event to every open live-events socket. */
  emit(event: unknown) {
    const message = JSON.stringify(event);
    for (const socket of this.sockets) socket.send(message);
  }

  /** Waits for a write matching the method and path (a string is an exact path, after `/api`). */
  async waitForWrite(method: Method, path: string | RegExp, options: { timeout?: number } = {}) {
    const matches = (request: RecordedRequest) =>
      request.method === method && (typeof path === "string" ? request.path === path : path.test(request.path));
    await expect
      .poll(() => this.writes.some(matches), {
        message: `expected a ${method} ${path} write; saw ${this.writes.map((w) => `${w.method} ${w.path}`).join(", ") || "none"}`,
        timeout: options.timeout ?? 10_000,
      })
      .toBe(true);
    return this.writes.filter(matches).at(-1)!;
  }

  async install(context: BrowserContext) {
    // Nothing leaves the machine: anything not served by the dev server is refused.
    await context.route(
      (url) => url.hostname !== "localhost" && url.hostname !== "127.0.0.1",
      (route) => {
        this.unmocked.push(`${route.request().method()} ${route.request().url()} (external)`);
        return route.abort("blockedbyclient");
      },
    );
    await context.route(
      (url) => url.pathname.startsWith("/api/") || url.pathname.startsWith("/_plugins/"),
      (route) => this.handle(route),
    );
    await context.routeWebSocket(
      (url) => url.pathname.startsWith("/api/"),
      (socket) => {
        // Not connected to any server: the app sees an open, quiet socket.
        const entry = { send: (message: string) => socket.send(message) };
        this.sockets.push(entry);
        socket.onClose(() => {
          this.sockets = this.sockets.filter((s) => s !== entry);
        });
      },
    );
  }

  private async handle(route: Route) {
    const request = route.request();
    const url = new URL(request.url());
    const method = request.method().toUpperCase() as Method;
    const path = url.pathname.startsWith("/api/") ? url.pathname.slice("/api".length) : url.pathname;
    let body: unknown = null;
    const raw = request.postData();
    const contentType = (await request.headerValue("content-type")) ?? "";
    if (raw && !contentType.includes("multipart/form-data")) {
      try {
        body = JSON.parse(raw);
      } catch {
        body = raw;
      }
    }
    const recorded: RecordedRequest = { method, path, query: url.searchParams, params: {}, body, url: request.url() };
    this.requests.push(recorded);
    const isWrite = WRITE_METHODS.has(method);
    if (isWrite) this.writes.push(recorded);

    if (this.live && !isWrite) return route.fallback();

    for (const entry of this.entries) {
      if (entry.method !== method) continue;
      const match = entry.regex.exec(path);
      if (!match) continue;
      const params = Object.fromEntries(entry.keys.map((key, i) => [key, decodeURIComponent(match[i + 1]!)]));
      recorded.params = params;
      let result: unknown;
      try {
        result = await entry.handler({ method, path, query: url.searchParams, params, body });
      } catch (error) {
        this.unmocked.push(`${method} ${path}${url.search} (handler threw: ${(error as Error).message})`);
        return route.fulfill({ status: 500, json: { error: `e2e handler threw: ${(error as Error).message}` } });
      }
      if (isReply(result)) {
        if (result.status === 204) return route.fulfill({ status: 204 });
        if (result.contentType) {
          const raw = Buffer.isBuffer(result.body) ? result.body : String(result.body ?? "");
          return route.fulfill({ status: result.status, contentType: result.contentType, body: raw });
        }
        return route.fulfill({ status: result.status, json: result.body });
      }
      return route.fulfill({ status: 200, json: result ?? null });
    }

    if (this.live) return route.fulfill({ status: 200, json: {} });
    this.unmocked.push(`${method} ${path}${url.search}`);
    return route.fulfill({ status: 501, json: { error: `e2e: no fixture for ${method} /api${path}` } });
  }
}
