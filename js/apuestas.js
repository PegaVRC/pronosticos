/**
 * Almacenamiento del módulo de cuotas:
 *  - "cuotas":     cuotas que ingresaste para cada partido (con la foto del modelo en ese momento)
 *  - "boleto":     selecciones de la combinada que estás armando
 *  - "combinadas": combinadas guardadas y su resultado
 *
 * Forma de una selección:
 * { partidoId|null, liga, fecha, local, visita,          ← partido (null si no está en la API)
 *   mercado, seleccion, linea?, cuota,                    ← apuesta
 *   lambdas:{local,visita}|null, pModelo|null,            ← modelo al momento de guardarla
 *   estado: 'pendiente'|'ganada'|'perdida'|'anulada' }
 */

import { leer, escribir } from './storage.js';
import { probSeleccion, claveSeleccion } from './mercados.js';
import { resolverSeleccion, estadoCombinada } from './cuotas.js';
import { buscarPartidos, deberiaHaberTerminado } from './resultados.js';

const CLAVE_CUOTAS = 'cuotas';
const CLAVE_BOLETO = 'boleto';
const CLAVE_COMBINADAS = 'combinadas';

const lista = (clave) => {
  const v = leer(clave, []);
  return Array.isArray(v) ? v : [];
};

/* ======================= Cuotas por partido ======================= */

export const obtenerRegistros = () => lista(CLAVE_CUOTAS);
export const obtenerRegistro = (partidoId) => obtenerRegistros().find((r) => r.partidoId === partidoId) || null;

/**
 * Guarda las cuotas ingresadas para un partido, junto con lo que decía el modelo.
 * @param {string} liga
 * @param {object} partido
 * @param {object} pron     Resultado de pronosticar()
 * @param {{mercado, seleccion, linea?, cuota}[]} mercados
 */
export function guardarCuotasPartido(liga, partido, pron, mercados) {
  const registro = {
    partidoId: partido.id,
    liga,
    fecha: partido.fecha,
    local: partido.local.nombre,
    visita: partido.visita.nombre,
    lambdas: { local: pron.lambdaLocal, visita: pron.lambdaVisita },
    prob1X2: { 1: pron.pLocal, X: pron.pEmpate, 2: pron.pVisita },
    mercados: mercados.map((m) => ({
      ...m,
      pModelo: probSeleccion(m, pron.lambdaLocal, pron.lambdaVisita),
    })),
    registradoEn: new Date().toISOString(),
    estado: 'pendiente',
    goles: null,
  };
  const otros = obtenerRegistros().filter((r) => r.partidoId !== partido.id);
  if (!mercados.length) return escribir(CLAVE_CUOTAS, otros);
  return escribir(CLAVE_CUOTAS, [...otros, registro]);
}

export function eliminarRegistro(partidoId) {
  escribir(
    CLAVE_CUOTAS,
    obtenerRegistros().filter((r) => r.partidoId !== partidoId)
  );
}

/**
 * Añade cuotas sueltas a un partido (por ejemplo, las leídas de un cupón)
 * sin borrar las que ya había.
 */
export function anadirCuotasPartido(sel) {
  if (sel.partidoId == null || !sel.lambdas) return;
  const registros = obtenerRegistros();
  let reg = registros.find((r) => r.partidoId === sel.partidoId);
  if (!reg) {
    reg = {
      partidoId: sel.partidoId,
      liga: sel.liga,
      fecha: sel.fecha,
      local: sel.local,
      visita: sel.visita,
      lambdas: sel.lambdas,
      prob1X2: sel.prob1X2 || null,
      mercados: [],
      registradoEn: new Date().toISOString(),
      estado: 'pendiente',
      goles: null,
    };
    registros.push(reg);
  }
  const clave = claveSeleccion(sel);
  reg.mercados = reg.mercados.filter((m) => claveSeleccion(m) !== clave);
  reg.mercados.push({
    mercado: sel.mercado,
    seleccion: sel.seleccion,
    linea: sel.linea,
    cuota: sel.cuota,
    pModelo: sel.pModelo,
  });
  escribir(CLAVE_CUOTAS, registros);
}

/* ======================= Boleto (combinada en armado) ======================= */

export const obtenerBoleto = () => lista(CLAVE_BOLETO);

/**
 * Añade una selección al boleto. Si ya estaba la misma, la reemplaza.
 * @returns {'añadida'|'reemplazada'}
 */
export function anadirAlBoleto(sel) {
  const boleto = obtenerBoleto();
  const igual = (s) => s.partidoId === sel.partidoId && claveSeleccion(s) === claveSeleccion(sel);
  const existia = boleto.some(igual);
  escribir(CLAVE_BOLETO, [...boleto.filter((s) => !igual(s)), { ...sel, estado: 'pendiente' }]);
  return existia ? 'reemplazada' : 'añadida';
}

export function quitarDelBoleto(indice) {
  const boleto = obtenerBoleto();
  boleto.splice(indice, 1);
  escribir(CLAVE_BOLETO, boleto);
}

export const vaciarBoleto = () => escribir(CLAVE_BOLETO, []);

/* ======================= Combinadas ======================= */

export const obtenerCombinadas = () => lista(CLAVE_COMBINADAS);

/**
 * Guarda una combinada.
 * @param {object[]} selecciones
 * @param {{importe?: number, origen?: 'manual'|'cupon', cuotaCupon?: number}} extra
 */
export function guardarCombinada(selecciones, { importe = 0, origen = 'manual', cuotaCupon = null } = {}) {
  const combinada = {
    id: Date.now(),
    creadaEn: new Date().toISOString(),
    origen,
    importe: importe > 0 ? importe : 0,
    cuotaCupon,
    selecciones: selecciones.map((s) => ({ ...s, estado: 'pendiente' })),
    estado: 'pendiente',
  };
  return escribir(CLAVE_COMBINADAS, [...obtenerCombinadas(), combinada]);
}

export function eliminarCombinada(id) {
  escribir(
    CLAVE_COMBINADAS,
    obtenerCombinadas().filter((c) => c.id !== id)
  );
}

/** Para partidos que no están en la API: el usuario marca el resultado a mano. */
export function marcarSeleccion(idCombinada, indice, estado) {
  const combinadas = obtenerCombinadas();
  const c = combinadas.find((x) => x.id === idCombinada);
  if (!c || !c.selecciones[indice]) return;
  c.selecciones[indice].estado = estado;
  c.estado = estadoCombinada(c.selecciones);
  escribir(CLAVE_COMBINADAS, combinadas);
}

/* ======================= Resolución automática ======================= */

/** ¿Hay algo pendiente cuyo partido ya debería haber terminado? */
export function hayApuestasPorComprobar() {
  const pend = (s) => s.partidoId != null && s.estado === 'pendiente' && deberiaHaberTerminado(s.fecha);
  return obtenerRegistros().some(pend) || obtenerCombinadas().some((c) => c.selecciones.some(pend));
}

/**
 * Busca resultados de cuotas registradas y combinadas pendientes.
 * @returns {Promise<{actualizados:number, errores:string[]}>}
 */
export async function actualizarApuestas() {
  const registros = obtenerRegistros();
  const combinadas = obtenerCombinadas();
  const pend = (s) => s.partidoId != null && s.estado === 'pendiente' && deberiaHaberTerminado(s.fecha);

  const pedidos = [
    ...registros.filter(pend).map((r) => ({ liga: r.liga, id: r.partidoId, fecha: r.fecha })),
    ...combinadas.flatMap((c) =>
      c.selecciones.filter(pend).map((s) => ({ liga: s.liga, id: s.partidoId, fecha: s.fecha }))
    ),
  ];
  if (!pedidos.length) return { actualizados: 0, errores: [] };

  const { porId, errores } = await buscarPartidos(pedidos);
  let actualizados = 0;

  /** Estado de un partido: goles, 'anulado' o null si sigue pendiente. */
  const desenlace = (id) => {
    const p = porId.get(id);
    if (!p) return null;
    if (p.estado === 'FINISHED' && p.goles) return { goles: p.goles };
    if (p.estado === 'CANCELLED' || p.estado === 'AWARDED') return { anulado: true };
    return null;
  };

  for (const r of registros.filter(pend)) {
    const d = desenlace(r.partidoId);
    if (!d) continue;
    r.estado = d.anulado ? 'anulado' : 'resuelto';
    r.goles = d.goles || null;
    actualizados++;
  }

  for (const c of combinadas) {
    let cambio = false;
    c.selecciones.forEach((s) => {
      if (!pend(s)) return;
      const d = desenlace(s.partidoId);
      if (!d) return;
      s.estado = d.anulado ? 'anulada' : resolverSeleccion(s, d.goles);
      s.goles = d.goles || null;
      cambio = true;
    });
    if (cambio) {
      c.estado = estadoCombinada(c.selecciones);
      actualizados++;
    }
  }

  if (actualizados) {
    escribir(CLAVE_CUOTAS, registros);
    escribir(CLAVE_COMBINADAS, combinadas);
  }
  return { actualizados, errores };
}

/** Borra todo el módulo de apuestas. */
export function borrarApuestas() {
  escribir(CLAVE_CUOTAS, []);
  escribir(CLAVE_BOLETO, []);
  escribir(CLAVE_COMBINADAS, []);
}
