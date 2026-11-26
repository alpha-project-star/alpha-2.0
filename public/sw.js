// public/sw.js
/**
 * Alpha - Minimal Service Worker for Browser Notification Support.
 *
 * Scoped strictly to standard notification click and window focusing.
 * Does not contain background schedulers, LLM execution, or credentials.
 */

self.addEventListener('install', (event) => {
  self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  event.waitUntil(self.clients.claim());
});

self.addEventListener('push', (event) => {
  try {
    let data = {};
    try {
      data = event.data ? event.data.json() : {};
    } catch {
      data = { body: 'You have a new reminder due.' };
    }
    const title = typeof data.title === 'string' ? data.title.slice(0, 120) : '🔔 Alpha Reminder';
    const options = {
      body: typeof data.body === 'string' ? data.body.slice(0, 1000) : '',
      tag: data.eventId || 'alpha-notification',
      icon: data.icon || '/icon-192.png',
      data: {
        eventId: data.eventId,
        reminderId: data.reminderId,
        url: data.url || '/',
        notes: data.notes,
        metadata: data.metadata,
      },
    };
    event.waitUntil(self.registration.showNotification(title, options));
  } catch (err) {
    const title = '🔔 Alpha Reminder';
    const text = event.data ? event.data.text() : 'You have a new reminder due.';
    event.waitUntil(
      self.registration.showNotification(title, {
        body: text,
        icon: '/icon-192.png',
      })
    );
  }
});

self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  const requestedUrl = event.notification.data && event.notification.data.url;
  let urlToOpen = '/';
  try {
    const parsedUrl = new URL(typeof requestedUrl === 'string' ? requestedUrl : '/', self.location.origin);
    if (parsedUrl.origin === self.location.origin) {
      urlToOpen = parsedUrl.pathname + parsedUrl.search + parsedUrl.hash;
    }
  } catch {
    urlToOpen = '/';
  }

  event.waitUntil(
    self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then((clientList) => {
      for (const client of clientList) {
        if (client.url && new URL(client.url).origin === self.location.origin && 'focus' in client) {
          await client.navigate(urlToOpen);
          return client.focus();
        }
      }
      if (self.clients.openWindow) {
        return self.clients.openWindow(urlToOpen);
      }
    })
  );
});
