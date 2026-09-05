// Service worker de Lavandería El Sol.
//
// Existe por dos razones, en este orden:
//   1. Sin un service worker, Chrome/Android no ofrece instalar la app. Es
//      requisito de instalación, junto con el manifest y los íconos PNG.
//   2. De paso, la app abre al instante: los archivos del build llevan hash en
//      el nombre, así que se pueden guardar sin miedo.
//
// Lo que NO hace, a propósito: guardar datos. Todo lo que cuelga de /api y
// /uploads va SIEMPRE a la red. Una nota, un corte de caja o el inventario
// servidos desde una caché vieja serían peores que un error de red: el
// empleado no tendría cómo saber que lo que ve ya no es cierto.
//
// Tampoco intenta funcionar sin internet. La app entera vive del API: sin red
// no hay nada útil que mostrar, y fingir lo contrario confunde.

const VERSION = 'v1';
const CACHE = `el-sol-${VERSION}`;

// El armazón mínimo para que la app arranque estando cacheada.
const SHELL = ['/', '/manifest.json', '/icon.svg', '/icon-192.png'];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE)
      // addAll falla entero si un archivo falla; se piden por separado para que
      // un ícono que no esté no impida instalar el service worker.
      .then((cache) => Promise.allSettled(SHELL.map((url) => cache.add(url))))
      .then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys()
      .then((claves) => Promise.all(
        claves.filter((c) => c.startsWith('el-sol-') && c !== CACHE).map((c) => caches.delete(c))
      ))
      .then(() => self.clients.claim())
  );
});

// ¿Es una petición de datos? Esas no se tocan nunca.
const esDatos = (url) => url.pathname.startsWith('/api/') || url.pathname.startsWith('/uploads/');

// Los archivos del build (/assets/index-a1b2c3.js) llevan hash: si el nombre
// existe, el contenido nunca cambia.
const esAssetConHash = (url) => url.pathname.startsWith('/assets/');

self.addEventListener('fetch', (event) => {
  const { request } = event;
  if (request.method !== 'GET') return;

  const url = new URL(request.url);
  if (url.origin !== self.location.origin) return;  // fuentes de Google, etc.
  if (esDatos(url)) return;                          // siempre a la red

  if (esAssetConHash(url)) {
    event.respondWith(
      caches.match(request).then((hit) => hit || fetch(request).then((res) => {
        if (res.ok) {
          const copia = res.clone();
          caches.open(CACHE).then((cache) => cache.put(request, copia));
        }
        return res;
      }))
    );
    return;
  }

  // El resto (el HTML de cada ruta, íconos, manifest): primero la red, para que
  // una versión nueva de la app llegue sin tener que borrar nada. La caché solo
  // entra cuando la red falla, y para la navegación se cae al armazón, porque
  // la app es una SPA y cualquier ruta se sirve con el mismo index.html.
  event.respondWith(
    fetch(request)
      .then((res) => {
        if (res.ok) {
          const copia = res.clone();
          caches.open(CACHE).then((cache) => cache.put(request, copia));
        }
        return res;
      })
      .catch(() => caches.match(request).then(
        (hit) => hit || (request.mode === 'navigate' ? caches.match('/') : undefined)
      ))
  );
});
