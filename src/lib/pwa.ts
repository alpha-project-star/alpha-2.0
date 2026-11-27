/**
 * Guarded service-worker registration for Alpha.
 * Registers only on the real production origin, then lets the worker cache
 * the application shell and same-origin static assets for offline reopening.
 */
export function registerAlphaPWA(): void {
  if (typeof window === "undefined" || !("serviceWorker" in navigator)) return;

  const inIframe = (() => {
    try { return window.self !== window.top; } catch { return true; }
  })();
  const host = window.location.hostname;
  const looksLikePreview =
    host.startsWith("id-preview--") ||
    host.startsWith("preview--") ||
    host === "lovableproject.com" || host.endsWith(".lovableproject.com") ||
    host === "lovableproject-dev.com" || host.endsWith(".lovableproject-dev.com") ||
    host === "beta.lovable.dev" || host.endsWith(".beta.lovable.dev");
  const killSwitch = new URL(window.location.href).searchParams.get("sw") === "off";
  const shouldRefuse = !import.meta.env.PROD || inIframe || looksLikePreview || killSwitch;

  if (shouldRefuse) {
    // Remove only Alpha's worker; leave unrelated workers on the origin alone.
    void navigator.serviceWorker.getRegistrations().then((registrations) => {
      for (const registration of registrations) {
        const workerUrl = registration.active?.scriptURL ||
          registration.installing?.scriptURL ||
          registration.waiting?.scriptURL || "";
        if (workerUrl.endsWith("/sw.js")) void registration.unregister();
      }
    }).catch(() => undefined);
    return;
  }

  const register = async () => {
    try {
      const registration = await navigator.serviceWorker.register("/sw.js", {
        scope: "/",
        updateViaCache: "none",
      });
      // Check for a newer worker when the app is opened online. Offline startup
      // still uses the last installed worker and its cached application shell.
      void registration.update().catch(() => undefined);
    } catch (error) {
      console.warn("[Alpha PWA] Service-worker registration failed:", error);
    }
  };

  if (document.readyState === "complete") {
    void register();
  } else {
    window.addEventListener("load", () => void register(), { once: true });
  }
}
