/**
 * Service worker de Pronósticos.
 *
 * 1. Guarda la app en caché para que abra sin conexión (y sea instalable).
 * 2. Recibe las imágenes que se comparten desde la galería en Android
 *    (Web Share Target): el manifest envía un POST a ./compartir con la imagen;
 *    aquí se guarda en una caché y se abre la pantalla del cupón, que la lee.
 *
 * Al cambiar archivos de la app, sube VERSION para que los teléfonos
 * descarguen la versión nueva.
 */

const VERSION = 'v6'; // igual que VERSION_APP en js/config.js
const CACHE_APP = `pronosticos-app-${VERSION}`;
const CACHE_CDN = 'pronosticos-cdn-v1'; // Tesseract.js y sus datos de idioma
const CACHE_COMPARTIDO = 'pronosticos-compartido';

/** Archivos de la app (rutas relativas a este archivo). */
const ARCHIVOS = [
  './',
  'index.html',
  'manifest.json',
  'css/styles.css',
  'icons/icon.svg',
  'icons/icon-192.png',
  'icons/icon-512.png',
  'icons/icon-maskable-512.png',
  'icons/icon-maskable.svg',
  'js/analisis.js',
  'js/api.js',
  'js/apuestas.js',
  'js/app.js',
  'js/cache.js',
  'js/config.js',
  'js/cuotas.js',
  'js/cupon.js',
  'js/emparejar.js',
  'js/formato.js',
  'js/historial.js',
  'js/limitador.js',
  'js/mercados.js',
  'js/ocr.js',
  'js/modelo.js',
  'js/resultados.js',
  'js/storage.js',
  'js/ui.js',
  'js/vistas/apuestas.js',
  'js/vistas/config.js',
  'js/vistas/cuotasPartido.js',
  'js/vistas/cupon.js',
  'js/vistas/detalle.js',
  'js/vistas/historial.js',
  'js/vistas/partidos.js',
];

/** Servidores de Tesseract.js: se guardan para que el OCR funcione sin conexión. */
const HOSTS_CDN = ['cdn.jsdelivr.net'];

self.addEventListener('install', (evento) => {
  evento.waitUntil(
    caches
      .open(CACHE_APP)
      // cache: 'reload' → descarga del servidor, sin usar la caché HTTP del navegador
      .then((cache) => cache.addAll(ARCHIVOS.map((url) => new Request(url, { cache: 'reload' }))))
      .then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', (evento) => {
  evento.waitUntil(
    caches
      .keys()
      .then((claves) =>
        Promise.all(
          claves
            .filter((c) => c.startsWith('pronosticos-app-') && c !== CACHE_APP)
            .map((c) => caches.delete(c))
        )
      )
      .then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', (evento) => {
  const peticion = evento.request;
  const url = new URL(peticion.url);

  // Imagen compartida desde otra app (Android)
  if (peticion.method === 'POST' && url.origin === self.location.origin && url.pathname.endsWith('/compartir')) {
    evento.respondWith(recibirCompartido(peticion));
    return;
  }
  if (peticion.method !== 'GET') return;

  // Archivos de la app: primero la red (para tener siempre la última versión),
  // y si no hay conexión, la copia guardada.
  if (url.origin === self.location.origin) {
    evento.respondWith(primeroRed(peticion));
    return;
  }

  // Tesseract.js: primero la caché (son archivos grandes que no cambian)
  if (HOSTS_CDN.includes(url.hostname)) {
    evento.respondWith(primeroCache(peticion));
  }
  // Todo lo demás (la API de fútbol, escudos) va directo a la red:
  // la app ya tiene su propia caché de la API en localStorage.
});

async function primeroRed(peticion) {
  const cache = await caches.open(CACHE_APP);
  try {
    // cache: 'no-cache' → el navegador siempre pregunta a GitHub si hay una versión nueva.
    // Sin esto, GitHub Pages permite reutilizar archivos viejos hasta 10 minutos y,
    // tras una actualización, la app podía quedar con la versión anterior.
    const respuesta = await fetch(peticion, { cache: 'no-cache' });
    if (respuesta.ok) cache.put(peticion, respuesta.clone());
    return respuesta;
  } catch {
    const guardada = await cache.match(peticion, { ignoreSearch: true });
    return guardada || (await cache.match('./')) || Response.error();
  }
}

async function primeroCache(peticion) {
  const cache = await caches.open(CACHE_CDN);
  const guardada = await cache.match(peticion);
  if (guardada) return guardada;
  const respuesta = await fetch(peticion);
  if (respuesta.ok) cache.put(peticion, respuesta.clone());
  return respuesta;
}

/** Guarda la imagen compartida y abre la pantalla del cupón. */
async function recibirCompartido(peticion) {
  const destino = new URL('./?compartido=1#/cupon', self.registration.scope).href;
  try {
    const datos = await peticion.formData();
    const archivo = datos.getAll('imagen').find((f) => f && typeof f !== 'string');
    if (archivo) {
      const cache = await caches.open(CACHE_COMPARTIDO);
      await cache.put(
        'compartido/imagen',
        new Response(archivo, { headers: { 'Content-Type': archivo.type || 'image/png' } })
      );
    }
  } catch {
    /* si falla, se abre igual la pantalla del cupón para subirla a mano */
  }
  return Response.redirect(destino, 303);
}
