import { readFileSync } from "node:fs";
import { runInNewContext } from "node:vm";
import { describe, expect, it, vi } from "vitest";

const workerSource = readFileSync(new URL("../public/sw.js", import.meta.url), "utf8");

function createWorker(fetchImpl: typeof fetch, cachedResponses: Record<string, Response> = {}) {
  const listeners = new Map<string, (event: any) => void>();
  const waitPromises: Promise<unknown>[] = [];
  const cache = {
    match: vi.fn(async (request: string | Request) => {
      const key = typeof request === "string" ? request : new URL(request.url).pathname;
      return cachedResponses[key]?.clone();
    }),
    put: vi.fn(async () => undefined),
  };
  const context = {
    self: {
      location: { origin: "https://alpha.example" },
      registration: { showNotification: vi.fn(async () => undefined) },
      clients: { matchAll: vi.fn(async () => []), openWindow: vi.fn(async () => undefined), claim: vi.fn(async () => undefined) },
      skipWaiting: vi.fn(async () => undefined),
      addEventListener: (name: string, handler: (event: any) => void) => listeners.set(name, handler),
    },
    caches: {
      open: vi.fn(async () => cache),
      match: vi.fn(async (key: string) => cache.match(key)),
      keys: vi.fn(async () => ["alpha-shell-v1", "alpha-shell-v2", "alpha-static-v2"]),
      delete: vi.fn(async () => true),
    },
    fetch: fetchImpl,
    URL,
    Response,
    Request,
    Promise,
    console,
  };
  runInNewContext(workerSource, context);
  return {
    listeners,
    cache,
    waitPromises,
    fire(name: string, event: any) {
      event.waitUntil = (promise: Promise<unknown>) => waitPromises.push(promise);
      event.respondWith = (promise: Promise<Response>) => { event.response = promise; };
      listeners.get(name)?.(event);
    },
  };
}

describe("Alpha service worker offline behavior", () => {
  it("falls back to the cached app shell for offline navigation", async () => {
    const shell = new Response("<html>Alpha shell</html>", { headers: { "Content-Type": "text/html" } });
    const worker = createWorker(vi.fn(async () => { throw new Error("offline"); }), { "/": shell });
    const event: any = {
      request: new Request("https://alpha.example/reminders", { method: "GET" }),
    };
    Object.defineProperty(event.request, "mode", { value: "navigate" });

    worker.fire("fetch", event);
    const response = await event.response;
    expect(response.status).toBe(200);
    expect(await response.text()).toContain("Alpha shell");
  });

  it("serves cached static assets while offline", async () => {
    const cached = new Response("cached bundle");
    const worker = createWorker(vi.fn(async () => { throw new Error("offline"); }), {
      "/assets/app.js": cached,
    });
    const event: any = {
      request: new Request("https://alpha.example/assets/app.js", { method: "GET" }),
    };

    worker.fire("fetch", event);
    const response = await event.response;
    expect(response.status).toBe(200);
    expect(await response.text()).toBe("cached bundle");
  });

  it("does not intercept API requests", () => {
    const worker = createWorker(vi.fn(async () => new Response("ok")));
    const event: any = {
      request: new Request("https://alpha.example/api/push/cron", { method: "GET" }),
    };

    worker.fire("fetch", event);
    expect(event.response).toBeUndefined();
  });
});
