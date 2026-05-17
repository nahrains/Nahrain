const CACHE_NAME = 'nahrain-app-v17.1';
const ASSETS = [
    './',
    './index.html',
    './js/accounts.js',
    './css/accounts.css',
    './logo.jpg',
    './g1.jpg',
    './g2.jpg',
    './g3.jpg',
    './partner.jpg',
    'https://fonts.googleapis.com/css2?family=Cairo:wght@300;400;600;700;900&display=swap',
    'https://cdnjs.cloudflare.com/ajax/libs/font-awesome/6.4.0/css/all.min.css'
];

// Domains that must NEVER be intercepted by the SW —
// Firebase uses streaming/WebSocket responses that break when cloned or cached.
const BYPASS_HOSTS = [
    'firebaseio.com',
    'googleapis.com',
    'gstatic.com',
    'firebaseapp.com',
    'firebasestorage.app',
    'firebasestorage.googleapis.com',
    'identitytoolkit.googleapis.com',
    'api.telegram.org',
    'api.callmebot.com',
    'cdn.jsdelivr.net',
    'cdnjs.cloudflare.com',
    'fonts.googleapis.com',
    'fonts.gstatic.com',
];

function shouldBypass(url) {
    try {
        const host = new URL(url).hostname;
        return BYPASS_HOSTS.some(d => host === d || host.endsWith('.' + d));
    } catch { return true; }
}

// Install
self.addEventListener('install', (e) => {
    self.skipWaiting();
    e.waitUntil(
        caches.open(CACHE_NAME).then((cache) => cache.addAll(ASSETS))
    );
});

// Activate — clear old caches
self.addEventListener('activate', (e) => {
    e.waitUntil(
        Promise.all([
            self.clients.claim(),
            caches.keys().then((keys) =>
                Promise.all(keys.map((key) => {
                    if (key !== CACHE_NAME) return caches.delete(key);
                }))
            )
        ])
    );
});

// Fetch — Network First for app assets only; bypass everything else
self.addEventListener('fetch', (e) => {
    if (e.request.method !== 'GET') return;
    if (shouldBypass(e.request.url)) return;  // Let Firebase & CDN go straight to network

    e.respondWith(
        fetch(e.request)
            .then((networkRes) => {
                const resClone = networkRes.clone();
                caches.open(CACHE_NAME).then((cache) => cache.put(e.request, resClone));
                return networkRes;
            })
            .catch(() => caches.match(e.request))
    );
});
