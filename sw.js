/* Cerca — service worker: deja la app abrible sin red (el mapa necesita red para los mosaicos). */
const CACHE = 'cerca-v1';
const SHELL = ['./', './index.html', './app.js', './manifest.webmanifest', './icon-192.png', './icon-512.png',
  './vendor/leaflet.js', './vendor/leaflet.css'];

self.addEventListener('install', (e) => {
  e.waitUntil(caches.open(CACHE).then((c) => c.addAll(SHELL)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', (e) => {
  e.waitUntil(caches.keys()
    .then((ks) => Promise.all(ks.filter((k) => k !== CACHE).map((k) => caches.delete(k))))
    .then(() => self.clients.claim()));
});

self.addEventListener('fetch', (e) => {
  const req = e.request;
  if(req.method !== 'GET') return;
  const url = new URL(req.url);

  // Firestore y mosaicos del mapa: siempre a la red, nunca al caché.
  if(/googleapis|firebaseio|firebase|tile\.openstreetmap/.test(url.hostname)) return;

  // La copia al caché se saca ANTES de devolver la respuesta: después el cuerpo ya está consumido.
  const guardando = (r) => {
    if(r && r.ok){ const copia = r.clone(); e.waitUntil(caches.open(CACHE).then((c) => c.put(req, copia))); }
    return r;
  };

  // Librerías de CDN: caché primero, se refresca en segundo plano.
  if(url.hostname.includes('cdnjs.cloudflare.com') || url.hostname.includes('gstatic.com')){
    e.respondWith(caches.match(req).then((hit) => {
      const red = fetch(req).then(guardando).catch(() => hit);
      return hit || red;
    }));
    return;
  }

  // Archivos propios: red primero (para recibir cambios), caché como respaldo.
  if(url.origin === location.origin){
    e.respondWith(fetch(req).then(guardando)
      .catch(() => caches.match(req).then((hit) => hit || caches.match('./index.html'))));
  }
});
