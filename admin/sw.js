"use strict";
// Just enough of a service worker to make the admin panel installable on
// iOS/iPadOS as a standalone app. Unlike the storefront's service worker,
// this deliberately does NOT cache /api/admin/* — admin data (quotes,
// pricing, sync status) should always come from the network, never a stale
// cached copy of something behind a login.

const CACHE_NAME = "n3d-admin-shell-v1";
const APP_SHELL = [
  "/admin",
  "/admin/assets/admin.css",
  "/admin/assets/admin.js",
  "/admin/manifest.json",
  "/assets/theme.css"
];

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => cache.addAll(APP_SHELL)).then(() => self.skipWaiting())
  );
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(keys.filter((k) => k !== CACHE_NAME).map((k) => caches.delete(k)))
    ).then(() => self.clients.claim())
  );
});

self.addEventListener("fetch", (event) => {
  const req = event.request;
  if (req.method !== "GET") return;

  const url = new URL(req.url);
  if (url.origin !== self.location.origin || url.pathname.startsWith("/api/")) return; // never touch API calls

  const isAppShell = APP_SHELL.includes(url.pathname) || url.pathname === "/admin/index.html";
  if (isAppShell) {
    // cache-first so the shell launches instantly, falling back to network
    // for anything new (e.g. after a deploy the cache hasn't caught up to)
    event.respondWith(
      caches.match(req).then((cached) => cached || fetch(req))
    );
  }
  // everything else (icons, admin-specific images): let the browser's own
  // HTTP cache handle it, no need to duplicate that here
});
