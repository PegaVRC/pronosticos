/**
 * Historial de pronósticos guardados por el usuario.
 *
 * Cada entrada guarda una "foto" del pronóstico en el momento de guardarlo
 * (aunque luego cambien los datos, lo que se evalúa es lo que se pronosticó).
 * Cuando el partido termina, se busca el resultado en los datos de la liga
 * (que ya están en caché, así casi no se gastan llamadas) y se marca el acierto.
 *
 * Criterio principal de acierto: el resultado 1X2 con mayor probabilidad.
 * También se registran el marcador exacto y "más de 2,5 goles".
 */

import { leer, escribir } from './storage.js';
import { buscarPartidos, deberiaHaberTerminado } from './resultados.js';
import { signo } from './modelo.js';

const CLAVE = 'historial';

/** Lista completa (array). */
export function obtenerHistorial() {
  const lista = leer(CLAVE, []);
  return Array.isArray(lista) ? lista : [];
}

function guardarLista(lista) {
  return escribir(CLAVE, lista);
}

export const estaGuardado = (idPartido) => obtenerHistorial().some((e) => e.id === idPartido);

/**
 * Guarda (o reemplaza) el pronóstico de un partido.
 * @returns {boolean} true si se pudo guardar
 */
export function guardarPronostico(ligaCodigo, partido, pron) {
  const entrada = {
    id: partido.id,
    liga: ligaCodigo,
    fecha: partido.fecha,
    local: { nombre: partido.local.nombre, escudo: partido.local.escudo },
    visita: { nombre: partido.visita.nombre, escudo: partido.visita.escudo },
    pronostico: {
      pLocal: pron.pLocal,
      pEmpate: pron.pEmpate,
      pVisita: pron.pVisita,
      favorito: pron.favorito,
      marcador: { local: pron.marcador.local, visita: pron.marcador.visita },
      pMas25: pron.pMas25,
    },
    guardadoEn: new Date().toISOString(),
    estado: 'pendiente', // pendiente | resuelto | anulado
    resultado: null,
  };
  const lista = obtenerHistorial().filter((e) => e.id !== partido.id);
  lista.push(entrada);
  return guardarLista(lista);
}

export function eliminarPronostico(idPartido) {
  guardarLista(obtenerHistorial().filter((e) => e.id !== idPartido));
}

export function borrarHistorial() {
  guardarLista([]);
}

/** Evaluación de una entrada ya resuelta. */
export function evaluar(entrada) {
  if (entrada.estado !== 'resuelto' || !entrada.resultado) return null;
  const { local, visita } = entrada.resultado;
  const p = entrada.pronostico;
  return {
    signoReal: signo(local, visita),
    acierto1X2: signo(local, visita) === p.favorito,
    aciertoMarcador: local === p.marcador.local && visita === p.marcador.visita,
    // Se pronosticó "más de 2,5" si su probabilidad era ≥ 50 %
    aciertoGoles: local + visita > 2.5 === p.pMas25 >= 0.5,
  };
}

/** Totales para la pantalla de historial. */
export function estadisticas(lista = obtenerHistorial()) {
  const evaluadas = lista.map(evaluar).filter(Boolean);
  const cuenta = (campo) => evaluadas.filter((e) => e[campo]).length;
  const resueltos = evaluadas.length;
  return {
    total: lista.length,
    resueltos,
    pendientes: lista.filter((e) => e.estado === 'pendiente').length,
    aciertos: cuenta('acierto1X2'),
    porcentaje: resueltos ? cuenta('acierto1X2') / resueltos : null,
    aciertosMarcador: cuenta('aciertoMarcador'),
    aciertosGoles: cuenta('aciertoGoles'),
  };
}

/** ¿Hay pronósticos pendientes cuyo partido ya debería haber terminado? */
export function hayPendientesPorComprobar(lista = obtenerHistorial()) {
  return lista.some((e) => e.estado === 'pendiente' && deberiaHaberTerminado(e.fecha));
}

/**
 * Busca los resultados de los partidos pendientes ya jugados.
 * @returns {Promise<{actualizados:number, errores:string[]}>}
 */
export async function actualizarResultados() {
  const lista = obtenerHistorial();
  const porComprobar = lista.filter((e) => e.estado === 'pendiente' && deberiaHaberTerminado(e.fecha));
  if (!porComprobar.length) return { actualizados: 0, errores: [] };

  const { porId, errores } = await buscarPartidos(porComprobar);
  let actualizados = 0;
  for (const entrada of porComprobar) {
    const partido = porId.get(entrada.id);
    if (!partido) continue;
    if (partido.estado === 'FINISHED' && partido.goles) {
      entrada.estado = 'resuelto';
      entrada.resultado = { ...partido.goles };
      actualizados++;
    } else if (partido.estado === 'CANCELLED' || partido.estado === 'AWARDED') {
      entrada.estado = 'anulado';
      actualizados++;
    } else if (partido.fecha !== entrada.fecha) {
      // Partido aplazado: se actualiza la fecha y sigue pendiente
      entrada.fecha = partido.fecha;
      actualizados++;
    }
  }

  if (actualizados) guardarLista(lista);
  return { actualizados, errores };
}
