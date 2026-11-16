/**
 * Punto de entrada: router basado en el "hash" de la URL.
 * Usar #/ruta permite que funcione en GitHub Pages sin configurar el servidor.
 *
 *   #/partidos/PL         → próximos partidos de una liga
 *   #/partido/PL/123456   → detalle de un partido
 *   #/historial           → mis pronósticos
 *   #/config              → ajustes (API key)
 */

import { obtenerApiKey } from './storage.js';
import { notificar } from './ui.js';
import { vistaPartidos } from './vistas/partidos.js';
import { vistaConfig } from './vistas/config.js';

const rutas = {
  partidos: vistaPartidos,
  config: vistaConfig,
};

/** Pestaña de la barra inferior que se marca para cada ruta. */
const pestanaDeRuta = { partidos: 'partidos', partido: 'partidos', historial: 'historial', config: 'config' };

/** Contador de navegaciones: permite descartar cargas lentas de pantallas anteriores. */
let navegacionActual = 0;

function leerHash() {
  const partes = location.hash.replace(/^#\/?/, '').split('/').filter(Boolean).map(decodeURIComponent);
  return { nombre: partes[0] || '', params: partes.slice(1) };
}

async function navegar() {
  const { nombre, params } = leerHash();

  // Ruta desconocida o vacía: a partidos, o a ajustes si aún no hay key
  if (!rutas[nombre]) {
    location.replace(obtenerApiKey() ? '#/partidos' : '#/config');
    return;
  }

  document.querySelectorAll('.nav__enlace').forEach((a) => {
    const activo = a.dataset.ruta === pestanaDeRuta[nombre];
    a.classList.toggle('activo', activo);
    if (activo) a.setAttribute('aria-current', 'page');
    else a.removeAttribute('aria-current');
  });

  const id = ++navegacionActual;
  const sigueActiva = () => id === navegacionActual;
  const contenedor = document.getElementById('app');
  window.scrollTo(0, 0);

  try {
    await rutas[nombre](contenedor, params, sigueActiva);
  } catch (error) {
    console.error(error);
    if (sigueActiva()) {
      contenedor.innerHTML = '<div class="error"><p>Ocurrió un error inesperado. Recarga la página.</p></div>';
    }
  }
}

// Aviso cuando el limitador hace esperar por el máximo de 10 llamadas por minuto
window.addEventListener('api:espera', (e) => {
  notificar(`Límite de 10 llamadas/min: esperando ${e.detail.segundos} s…`, 4000);
});

window.addEventListener('hashchange', navegar);
navegar();

