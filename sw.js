// ═══════════════════════════════════════════════════════════════════════════
// sw.js  —  TaskFlow Service Worker
// Handles background push notifications for call reminders.
// Place this file in the ROOT of your project (same level as index.html).
// ═══════════════════════════════════════════════════════════════════════════

const CACHE_NAME = "taskflow-v1";

// ── Install: skip waiting so new SW activates immediately ──────────────────
self.addEventListener("install", () => self.skipWaiting());
self.addEventListener("activate", e => e.waitUntil(self.clients.claim()));

// ── Push event: show notification ─────────────────────────────────────────
self.addEventListener("push", event => {
  let data = { title: "📞 Call Reminder", body: "You have a call scheduled.", tag: "call" };
  try { data = { ...data, ...event.data.json() }; } catch(e) {}

  event.waitUntil(
    self.registration.showNotification(data.title, {
      body   : data.body,
      icon   : data.icon  || "/icon-192.png",
      badge  : data.badge || "/icon-192.png",
      tag    : data.tag   || "call-reminder",
      data   : data.url   || "/",
      vibrate: [200, 100, 200],
      actions: [
        { action: "call",    title: "📞 Call Now" },
        { action: "dismiss", title: "Dismiss"     }
      ]
    })
  );
});

// ── Notification click ─────────────────────────────────────────────────────
self.addEventListener("notificationclick", event => {
  event.notification.close();
  const url = event.notification.data || "/";

  if (event.action === "call" && event.notification.data?.phone) {
    // Open the tel: link — will trigger dialer on mobile
    event.waitUntil(self.clients.openWindow("tel:" + event.notification.data.phone));
    return;
  }

  event.waitUntil(
    self.clients.matchAll({ type: "window", includeUncontrolled: true }).then(clients => {
      const existing = clients.find(c => c.url.includes(self.location.origin));
      if (existing) { existing.focus(); return; }
      self.clients.openWindow("/");
    })
  );
});
