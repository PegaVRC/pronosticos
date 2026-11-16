/**
 * Caché de respuestas de la API en localStorage.
 *
 * Cada entrada guarda { t: momento de guardado, datos }.
 * Al leer se informa si sigue "vigente" (dentro del TTL). Si caducó, los datos
 * se devuelven igual, por si la API falla y conviene mostrar algo aunque sea viejo.
 */

import { leer, escribir, borrar, clavesQueEmpiezan } from './storage.js';

const PREFIJO_CACHE = 'cache:';

/**
 * Lee una entrada de la caché.
 * @param {string} clave
 * @param {number} ttlMs  Milisegundos durante los que la entrada es válida
 * @returns {{datos:any, guardado:number, vigente:boolean} | null}
 */
export function leerCache(clave, ttlMs) {
  const entrada = leer(PREFIJO_CACHE + clave);
  if (!entrada || typeof entrada.t !== 'number') return null;
  return {
    datos: entrada.datos,
    guardado: entrada.t,
    vigente: Date.now() - entrada.t < ttlMs,
  };
}

/**
 * Guarda una entrada en la caché. Si localStorage está lleno,
 * vacía la caché (nunca el historial ni la API key) y vuelve a intentar.
 */
export function guardarCache(clave, datos) {
  const entrada = { t: Date.now(), datos };
  if (escribir(PREFIJO_CACHE + clave, entrada)) return true;
  vaciarCache();
  return escribir(PREFIJO_CACHE + clave, entrada);
}

/** Borra todas las entradas de la caché. */
export function vaciarCache() {
  clavesQueEmpiezan(PREFIJO_CACHE).forEach(borrar);
}
