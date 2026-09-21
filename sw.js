// OneSignal push notification handling, merged into our own service worker
// (instead of a separate file) so it doesn't conflict with PWA installability below.
importScripts("https://cdn.onesignal.com/sdks/web/v16/OneSignalSDK.sw.js");

// Minimal service worker — intentionally does NOT cache content.
// This exists only to satisfy installability requirements (Chrome/Android),
// while avoiding the stale-content issues a caching service worker can cause.
self.addEventListener('install', function(event){
  self.skipWaiting();
});

self.addEventListener('activate', function(event){
  event.waitUntil(self.clients.claim());
});

self.addEventListener('fetch', function(event){
  // Always go to the network — never serve from a cache.
  event.respondWith(fetch(event.request));
});
