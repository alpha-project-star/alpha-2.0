/* Alpha offline application shell and notification service worker. */
const CACHE_VERSION = "alpha-shell-v2";
const SHELL_CACHE = CACHE_VERSION;
const STATIC_CACHE = "alpha-static-v2";
const PRECACHE_URLS = [
  "/",
  "/offline.html",
  "/manifest.webmanifest",
  "/icon-192.png",
  "/icon-512.png",
  "/favicon.png",
];

self.addEventListener("install", (event) => {
  event.waitUntil((async () => {
    const cache = await caches.open(SHELL_CACHE);
    await Promise.all(PRECACHE_URLS.map(async (url) => {
      try {
        const response = await fetch(url, { cache: "reload" });
        if (response.ok && response.type !== "opaque") {
          await cache.put(url, response);
        }
      } catch {
        // A failed optional precache must not prevent the worker installing.
      }
    }));
    await self.skipWaiting();
  })());
});

self.addEventListener("activate", (event) => {
  event.waitUntil((async () => {
    const keys = await caches.keys();
    await Promise.all(keys
      .filter((key) => key.startsWith("alpha-") && key !== SHELL_CACHE && key !== STATIC_CACHE)
      .map((key) => caches.delete(key)));
    await self.clients.claim();
  })());
});

self.addEventListener("push", (event) => {
  let data = {};
  try {
    data = event.data ? event.data.json() : {};
  } catch {
    data = { body: "You have a new reminder due." };
  }

  const title = typeof data.title === "string" ? data.title.slice(0, 120) : "Alpha Reminder";
  const options = {
    body: typeof data.body === "string" ? data.body.slice(0, 1000) : "",
    tag: typeof data.eventId === "string" ? data.eventId.slice(0, 128) : "alpha-notification",
    icon: "/icon-192.png",
    badge: "/favicon.png",
    data: {
      eventId: typeof data.eventId === "string" ? data.eventId : "",
      reminderId: typeof data.reminderId === "string" ? data.reminderId : "",
      url: typeof data.url === "string" ? data.url : "/",
    },
  };
  event.waitUntil(self.registration.showNotification(title, options));
});

self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  const requestedUrl = event.notification.data && event.notification.data.url;
  let urlToOpen = "/";
  try {
    const parsed = new URL(typeof requestedUrl === "string" ? requestedUrl : "/", self.location.origin);
    if (parsed.origin === self.location.origin) {
      urlToOpen = parsed.pathname + parsed.search + parsed.hash;
    }
  } catch {
    urlToOpen = "/";
  }

  event.waitUntil(self.clients.matchAll({ type: "window", includeUncontrolled: true }).then(async (clients) => {
    for (const client of clients) {
      try {
        if (client.url && new URL(client.url).origin === self.location.origin && "focus" in client) {
          await client.navigate(urlToOpen);
          return client.focus();
        }
      } catch {
        // Ignore an invalid/stale client and try another one.
      }
    }
    if (self.clients.openWindow) return self.clients.openWindow(urlToOpen);
    return undefined;
  }));
});

function isCacheableStaticAsset(url) {
  if (url.origin !== self.location.origin) return false;
  if (url.pathname.startsWith("/api/")) return false;
  return url.pathname.startsWith("/assets/") ||
    /\.(?:js|css|woff2?|ttf|otf|png|jpe?g|webp|svg|ico|wasm)$/i.test(url.pathname);
}

self.addEventListener("fetch", (event) => {
  const request = event.request;
  if (request.method !== "GET") return;

  let url;
  try {
    url = new URL(request.url);
  } catch {
    return;
  }
  if (url.origin !== self.location.origin) return;

  if (request.mode === "navigate") {
    // Always prefer fresh HTML. Keep only the application root as the offline
    // shell, avoiding accidental caching of user-specific deep-link responses.
    event.respondWith((async () => {
      try {
        const response = await fetch(request);
        if (response.ok && url.pathname === "/") {
          const cache = await caches.open(SHELL_CACHE);
          await cache.put("/", response.clone());
        }
        return response;
      } catch {
        const shell = await caches.match("/");
        if (shell) return shell;
        const offline = await caches.match("/offline.html");
        if (offline) return offline;
        return new Response("Alpha is offline. Reconnect and try again.", {
          status: 503,
          headers: { "Content-Type": "text/plain; charset=utf-8" },
        });
      }
    })());
    return;
  }

  if (!isCacheableStaticAsset(url)) return;

  event.respondWith((async () => {
    const cache = await caches.open(STATIC_CACHE);
    const cached = await cache.match(request);
    const network = fetch(request).then(async (response) => {
      if (response.ok && response.type === "basic") {
        await cache.put(request, response.clone());
      }
      return response;
    });
    if (cached) {
      event.waitUntil(network.catch(() => undefined));
      return cached;
    }
    try {
      return await network;
    } catch {
      return new Response("This resource is not available offline.", {
        status: 503,
        headers: { "Content-Type": "text/plain; charset=utf-8" },
      });
    }
  })());
});
