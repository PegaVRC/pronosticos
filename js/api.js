/**
 * Cliente de la API de football-data.org (v4).
 *
 * Para gastar pocas llamadas se pide UNA vez la temporada completa de cada liga
 * (/competitions/{código}/matches). Con esa respuesta se calcula todo:
 * próximos partidos, fuerzas del modelo, forma reciente y resultados del historial.
 * La respuesta se "compacta" (solo los campos que usamos) antes de guardarla
 * en caché para no llenar localStorage.
 */

import { API_BASE, TTL_PARTIDOS_MS } from './config.js';
import { obtenerApiKey, obtenerProxy } from './storage.js';
import { leerCache, guardarCache } from './cache.js';
import { esperarTurno, marcarLimiteAgotado } from './limitador.js';

/** Error con un mensaje pensado para mostrar al usuario. */
export class ErrorApi extends Error {
  /**
   * @param {string} mensaje
   * @param {'sin-key'|'red'|'auth'|'limite'|'servidor'} tipo
   */
  constructor(mensaje, tipo) {
    super(mensaje);
    this.name = 'ErrorApi';
    this.tipo = tipo;
  }
}

/** Avisa a la interfaz (sin depender de ella) de que estamos esperando turno. */
function avisarEspera(segundos) {
  window.dispatchEvent(new CustomEvent('api:espera', { detail: { segundos } }));
}

/** Aplica el proxy CORS opcional: proxy + URL de la API codificada. */
function construirUrl(url) {
  const proxy = obtenerProxy();
  return proxy ? proxy + encodeURIComponent(url) : url;
}

/**
 * Hace una petición GET autenticada respetando el límite de llamadas.
 * @param {string} ruta Ruta relativa, p. ej. "/competitions/PL/matches"
 */
export async function pedir(ruta) {
  const key = obtenerApiKey();
  if (!key) {
    throw new ErrorApi('Falta la API key. Agrégala en Ajustes.', 'sin-key');
  }

  await esperarTurno(avisarEspera);

  let respuesta;
  try {
    respuesta = await fetch(construirUrl(API_BASE + ruta), {
      headers: { 'X-Auth-Token': key },
    });
  } catch {
    throw new ErrorApi(
      'No se pudo conectar con la API. Revisa tu conexión. Si el problema sigue, puede ser un bloqueo CORS del navegador (mira el README).',
      'red'
    );
  }

  if (respuesta.status === 401 || respuesta.status === 403) {
    throw new ErrorApi(
      'La API rechazó la petición: la API key no es válida o tu plan no incluye esta competición.',
      'auth'
    );
  }
  if (respuesta.status === 429) {
    marcarLimiteAgotado();
    throw new ErrorApi('Se alcanzó el límite de 10 llamadas por minuto. Espera un momento y vuelve a intentarlo.', 'limite');
  }
  if (!respuesta.ok) {
    throw new ErrorApi(`La API respondió con un error (${respuesta.status}). Inténtalo más tarde.`, 'servidor');
  }
  return respuesta.json();
}

/**
 * Goles al final del tiempo reglamentario (90').
 * En eliminatorias con prórroga, "fullTime" incluye la prórroga; para el modelo
 * y para comprobar el 1X2 nos interesa el resultado a los 90 minutos.
 */
function golesReglamentarios(score) {
  const rt = score?.regularTime;
  if (rt && rt.home != null && rt.away != null) return { local: rt.home, visita: rt.away };
  const ft = score?.fullTime;
  if (ft && ft.home != null && ft.away != null) return { local: ft.home, visita: ft.away };
  return null;
}

/** Datos mínimos de un equipo. `id` puede ser null si aún no está definido (eliminatorias). */
function compactarEquipo(e) {
  return {
    id: e?.id ?? null,
    nombre: e?.shortName || e?.name || 'Por definir',
    nombreCompleto: e?.name || '', // para emparejar nombres leídos de cupones
    tla: e?.tla || '', // siglas de 3 letras (p. ej. "ARS")
    escudo: e?.crest || '',
  };
}

/** Reduce la respuesta de la API a lo que la app necesita. */
function compactarPartidos(json) {
  return {
    competicion: {
      codigo: json.competition?.code ?? '',
      nombre: json.competition?.name ?? '',
    },
    temporada: json.filters?.season ?? null,
    partidos: (json.matches || []).map((m) => ({
      id: m.id,
      fecha: m.utcDate,
      estado: m.status, // SCHEDULED, TIMED, IN_PLAY, PAUSED, FINISHED, POSTPONED…
      jornada: m.matchday ?? null,
      fase: m.stage ?? '',
      local: compactarEquipo(m.homeTeam),
      visita: compactarEquipo(m.awayTeam),
      goles: m.status === 'FINISHED' ? golesReglamentarios(m.score) : null,
    })),
  };
}

/**
 * Partidos de la temporada actual de una liga (con caché).
 * @param {string} codigo Código de la liga (PL, PD, SA, CL)
 * @param {{forzar?: boolean}} opciones forzar = ignorar la caché vigente
 * @returns {Promise<{competicion, temporada, partidos, guardado:number, desdeCache:boolean, aviso?:string}>}
 */
export async function obtenerPartidosLiga(codigo, { forzar = false } = {}) {
  const clave = `partidos:${codigo}`;
  const enCache = leerCache(clave, TTL_PARTIDOS_MS);

  if (enCache && enCache.vigente && !forzar) {
    return { ...enCache.datos, guardado: enCache.guardado, desdeCache: true };
  }

  try {
    const json = await pedir(`/competitions/${codigo}/matches`);
    const datos = compactarPartidos(json);
    guardarCache(clave, datos);
    return { ...datos, guardado: Date.now(), desdeCache: false };
  } catch (error) {
    // Si falla pero hay datos viejos, se muestran con un aviso.
    if (enCache && error.tipo !== 'sin-key') {
      return {
        ...enCache.datos,
        guardado: enCache.guardado,
        desdeCache: true,
        aviso: `${error.message} Se muestran datos guardados anteriormente.`,
      };
    }
    throw error;
  }
}
