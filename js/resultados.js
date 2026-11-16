/**
 * Búsqueda de resultados de partidos ya jugados, compartida por el historial
 * de pronósticos y por el módulo de apuestas.
 *
 * Agrupa los partidos por liga: como mucho una llamada por liga
 * (y ninguna si la caché es posterior al final de los partidos).
 */

import { obtenerPartidosLiga } from './api.js';

/** Margen tras el inicio antes de buscar el resultado (un partido dura ~2 h). */
export const MARGEN_FIN_MS = 2 * 60 * 60 * 1000;

/** ¿Ya debería haber terminado un partido que empezó en `fecha`? */
export const deberiaHaberTerminado = (fecha) => new Date(fecha).getTime() + MARGEN_FIN_MS < Date.now();

/**
 * @param {{liga:string, id:number, fecha:string}[]} pedidos
 * @returns {Promise<{porId: Map<number, object>, errores: string[]}>}
 */
export async function buscarPartidos(pedidos) {
  const porId = new Map();
  const errores = [];
  const ligas = [...new Set(pedidos.map((p) => p.liga))];

  for (const liga of ligas) {
    let datos;
    try {
      datos = await obtenerPartidosLiga(liga);
      // Si la caché es de antes del final de algún partido, se piden datos nuevos
      const vieja = pedidos.some(
        (p) => p.liga === liga && datos.guardado < new Date(p.fecha).getTime() + MARGEN_FIN_MS
      );
      if (vieja && datos.desdeCache) datos = await obtenerPartidosLiga(liga, { forzar: true });
      if (datos.aviso) errores.push(datos.aviso);
    } catch (error) {
      errores.push(error.message);
      if (!datos) continue;
    }
    for (const p of datos.partidos) porId.set(p.id, p);
  }
  return { porId, errores: [...new Set(errores)] };
}
