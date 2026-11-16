/**
 * Vista "Ajustes": API key, proxy CORS opcional y mantenimiento de datos.
 * Ruta: #/config
 * La API key se guarda SOLO en el localStorage de este navegador.
 */

import { LIMITE_LLAMADAS } from '../config.js';
import { obtenerApiKey, guardarApiKey, borrarApiKey, obtenerProxy, guardarProxy } from '../storage.js';
import { vaciarCache } from '../cache.js';
import { llamadasDisponibles } from '../limitador.js';
import { obtenerPartidosLiga } from '../api.js';
import { borrarHistorial, obtenerHistorial } from '../historial.js';
import { escaparHtml, notificar, htmlError } from '../ui.js';

export async function vistaConfig(contenedor) {
  const key = obtenerApiKey();
  const proxy = obtenerProxy();

  contenedor.innerHTML = `
    ${
      key
        ? ''
        : `<div class="tarjeta">
            <h2>¡Bienvenido!</h2>
            <p>Para empezar necesitas una API key <strong>gratuita</strong> de football-data.org:</p>
            <ol>
              <li>Regístrate en <a href="https://www.football-data.org/client/register" target="_blank" rel="noopener">football-data.org</a>.</li>
              <li>Te llegará la key por correo.</li>
              <li>Pégala aquí abajo y toca <strong>Guardar</strong>.</li>
            </ol>
          </div>`
    }

    <form class="tarjeta" id="form-config" autocomplete="off">
      <h2>API key</h2>
      <div class="campo">
        <label for="api-key">Tu API key de football-data.org</label>
        <div class="campo__fila">
          <input id="api-key" type="password" inputmode="text" spellcheck="false"
                 autocapitalize="off" placeholder="Pega aquí tu key" value="${escaparHtml(key)}">
          <button type="button" class="boton boton--secundario" id="ver-key" aria-label="Mostrar u ocultar la key">👁</button>
        </div>
        <span class="suave">Se guarda solo en este navegador (localStorage). Nunca se sube a GitHub.</span>
      </div>

      <details class="campo">
        <summary>Opciones avanzadas</summary>
        <div class="campo" style="margin-top:.75rem">
          <label for="proxy">Proxy CORS (opcional)</label>
          <input id="proxy" type="url" spellcheck="false" autocapitalize="off"
                 placeholder="https://mi-proxy.workers.dev/?url=" value="${escaparHtml(proxy)}">
          <span class="suave">Solo si el navegador bloquea la API (error de conexión). La URL de la API se añade al final, codificada. Ojo: el proxy verá tu key; usa uno propio (ver README).</span>
        </div>
      </details>

      <div class="fila-botones">
        <button type="submit" class="boton">Guardar</button>
        <button type="button" class="boton boton--secundario" id="probar">Probar conexión</button>
      </div>
      <div id="resultado-prueba" style="margin-top:.75rem"></div>
    </form>

    <div class="tarjeta">
      <h2>Datos</h2>
      <p class="suave">Llamadas disponibles este minuto: <strong id="disponibles">${llamadasDisponibles()}</strong> de ${LIMITE_LLAMADAS}.
      Las respuestas se guardan en caché 10 minutos para no gastar llamadas.</p>
      <div class="fila-botones">
        <button type="button" class="boton boton--secundario" id="vaciar-cache">Vaciar caché</button>
        ${key ? '<button type="button" class="boton boton--peligro" id="borrar-key">Borrar API key</button>' : ''}
        <button type="button" class="boton boton--peligro" id="borrar-historial">Borrar historial</button>
      </div>
    </div>

    <p class="suave centrado">Datos: football-data.org · Modelo de Poisson · Los pronósticos son estimaciones estadísticas, no garantías.</p>`;

  const inputKey = contenedor.querySelector('#api-key');
  const inputProxy = contenedor.querySelector('#proxy');
  const resultado = contenedor.querySelector('#resultado-prueba');

  contenedor.querySelector('#ver-key').addEventListener('click', () => {
    inputKey.type = inputKey.type === 'password' ? 'text' : 'password';
  });

  /** Guarda los campos del formulario. */
  function guardar() {
    const nuevaKey = inputKey.value.trim();
    if (!nuevaKey) {
      notificar('Escribe tu API key.');
      return false;
    }
    const proxyNuevo = inputProxy.value.trim();
    if (proxyNuevo && !/^https:\/\//i.test(proxyNuevo)) {
      notificar('El proxy debe empezar por https://');
      return false;
    }
    guardarApiKey(nuevaKey);
    guardarProxy(proxyNuevo);
    return true;
  }

  contenedor.querySelector('#form-config').addEventListener('submit', (e) => {
    e.preventDefault();
    if (!guardar()) return;
    notificar('Ajustes guardados ✓');
    if (!key) location.hash = '#/partidos';
  });

  contenedor.querySelector('#probar').addEventListener('click', async (e) => {
    if (!guardar()) return;
    const boton = e.currentTarget;
    boton.disabled = true;
    resultado.innerHTML = '<span class="suave">Probando…</span>';
    try {
      const datos = await obtenerPartidosLiga('PL', { forzar: true });
      if (datos.aviso) throw new Error(datos.aviso);
      resultado.innerHTML = `<p>✅ Conexión correcta: ${datos.partidos.length} partidos de la Premier League recibidos.</p>`;
    } catch (error) {
      resultado.innerHTML = htmlError(error);
    } finally {
      boton.disabled = false;
      contenedor.querySelector('#disponibles').textContent = llamadasDisponibles();
    }
  });

  contenedor.querySelector('#vaciar-cache').addEventListener('click', () => {
    vaciarCache();
    notificar('Caché vaciada.');
  });

  contenedor.querySelector('#borrar-key')?.addEventListener('click', () => {
    if (!confirm('¿Borrar la API key de este navegador?')) return;
    borrarApiKey();
    vaciarCache();
    notificar('API key borrada.');
    vistaConfig(contenedor);
  });

  contenedor.querySelector('#borrar-historial').addEventListener('click', () => {
    const n = obtenerHistorial().length;
    if (!n) {
      notificar('El historial ya está vacío.');
      return;
    }
    if (!confirm(`¿Borrar los ${n} pronósticos guardados? No se puede deshacer.`)) return;
    borrarHistorial();
    notificar('Historial borrado.');
  });
}
