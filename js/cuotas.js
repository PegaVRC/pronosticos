/**
 * Cálculos con cuotas decimales (sin DOM ni almacenamiento, para poder probarlos).
 *
 * - Probabilidad implícita de una cuota = 1 / cuota.
 * - Las tres implícitas de un 1X2 suman más de 100 %: ese exceso es el MARGEN de la casa.
 *   Quitando el margen (normalizando) se obtiene la opinión "limpia" de la casa.
 * - Hay VALOR cuando la probabilidad del modelo es mayor que la implícita,
 *   es decir, cuando el valor esperado (VE) es positivo:
 *       VE = probabilidad_modelo × cuota − 1   (ganancia media por unidad apostada)
 */

import { probConjunta, cumple, seleccionValida } from './mercados.js';
import { signo } from './modelo.js';

/** Convierte "1,85" o "1.85" en 1.85. Devuelve null si no es una cuota válida (> 1). */
export function leerCuota(texto) {
  if (typeof texto === 'number') return texto > 1 ? texto : null;
  const limpio = String(texto ?? '').trim().replace(',', '.');
  if (!/^\d{1,4}(\.\d{1,3})?$/.test(limpio)) return null;
  const n = Number(limpio);
  return n > 1 && n < 10000 ? n : null;
}

export const probImplicita = (cuota) => 1 / cuota;
export const valorEsperado = (prob, cuota) => prob * cuota - 1;
export const hayValor = (prob, cuota) => prob > probImplicita(cuota);

/**
 * Análisis de un 1X2 completo.
 * @param {{'1':number,'X':number,'2':number}} cuotas
 */
export function analizar1X2(cuotas) {
  const imp = { 1: 1 / cuotas['1'], X: 1 / cuotas.X, 2: 1 / cuotas['2'] };
  const suma = imp['1'] + imp.X + imp['2'];
  return {
    implicitas: imp,
    margen: suma - 1,
    normalizadas: { 1: imp['1'] / suma, X: imp.X / suma, 2: imp['2'] / suma },
  };
}

/**
 * Resumen de una combinada.
 * Cada selección: { partidoId|null, lambdas:{local,visita}|null, mercado, seleccion, linea?, cuota }
 * Las selecciones del mismo partido se calculan juntas (probabilidad conjunta exacta);
 * las de partidos distintos se multiplican (se suponen independientes).
 */
export function resumenCombinada(selecciones) {
  const cuotaTotal = selecciones.reduce((t, s) => t * s.cuota, 1);
  const grupos = new Map();
  let sinModelo = 0;

  for (const s of selecciones) {
    if (s.partidoId == null || !s.lambdas || !seleccionValida(s)) {
      sinModelo++;
      continue;
    }
    if (!grupos.has(s.partidoId)) grupos.set(s.partidoId, []);
    grupos.get(s.partidoId).push(s);
  }

  let probModelo = 1;
  let mismosPartidos = false;
  for (const grupo of grupos.values()) {
    if (grupo.length > 1) mismosPartidos = true;
    probModelo *= probConjunta(grupo, grupo[0].lambdas.local, grupo[0].lambdas.visita);
  }

  const completa = selecciones.length > 0 && sinModelo === 0;
  return {
    n: selecciones.length,
    cuotaTotal,
    probImplicita: selecciones.length ? 1 / cuotaTotal : 0,
    probModelo: completa ? probModelo : null,
    ve: completa ? valorEsperado(probModelo, cuotaTotal) : null,
    sinModelo,
    mismosPartidos,
  };
}

/** Estado de una selección con el resultado real: 'ganada' | 'perdida'. */
export const resolverSeleccion = (sel, goles) => (cumple(sel, goles.local, goles.visita) ? 'ganada' : 'perdida');

/**
 * Estado de una combinada a partir de sus selecciones.
 * Una selección anulada cuenta como cuota 1 (como hacen las casas).
 */
export function estadoCombinada(selecciones) {
  if (selecciones.some((s) => s.estado === 'perdida')) return 'perdida';
  if (selecciones.every((s) => s.estado === 'ganada' || s.estado === 'anulada')) return 'ganada';
  return 'pendiente';
}

/** Cuota efectiva (sin las selecciones anuladas). */
export const cuotaEfectiva = (selecciones) =>
  selecciones.reduce((t, s) => t * (s.estado === 'anulada' ? 1 : s.cuota), 1);

/** Error de Brier de un 1X2 (0 = perfecto, 2 = el peor posible). */
export function brier(probs, signoReal) {
  return ['1', 'X', '2'].reduce((s, k) => s + (probs[k] - (k === signoReal ? 1 : 0)) ** 2, 0);
}

/**
 * Compara el modelo con las casas de apuestas a lo largo del tiempo.
 * @param {object[]} registros  Cuotas registradas (ver apuestas.js), algunas ya resueltas
 * @param {object[]} combinadas
 */
export function compararModeloYCasas(registros, combinadas) {
  const r = {
    partidos: 0,
    aciertosModelo: 0,
    aciertosCasa: 0,
    brierModelo: 0,
    brierCasa: 0,
    valor: { apuestas: 0, ganadas: 0, unidades: 0 },
    combinadas: { resueltas: 0, ganadas: 0, unidades: 0, importe: 0, retorno: 0 },
  };

  for (const reg of registros) {
    if (reg.estado !== 'resuelto' || !reg.goles) continue;
    const real = signo(reg.goles.local, reg.goles.visita);

    // 1) Comparación 1X2 (solo si se ingresaron las tres cuotas)
    const c = {};
    for (const m of reg.mercados) if (m.mercado === '1X2') c[m.seleccion] = m.cuota;
    if (c['1'] && c.X && c['2'] && reg.prob1X2) {
      const casa = analizar1X2(c).normalizadas;
      const favModelo = ['1', 'X', '2'].reduce((a, b) => (reg.prob1X2[b] > reg.prob1X2[a] ? b : a));
      const favCasa = ['1', 'X', '2'].reduce((a, b) => (c[b] < c[a] ? b : a));
      r.partidos++;
      if (favModelo === real) r.aciertosModelo++;
      if (favCasa === real) r.aciertosCasa++;
      r.brierModelo += brier(reg.prob1X2, real);
      r.brierCasa += brier(casa, real);
    }

    // 2) Apuestas simuladas de 1 unidad en cada selección con valor
    for (const m of reg.mercados) {
      if (m.pModelo == null || !hayValor(m.pModelo, m.cuota)) continue;
      r.valor.apuestas++;
      if (cumple(m, reg.goles.local, reg.goles.visita)) {
        r.valor.ganadas++;
        r.valor.unidades += m.cuota - 1;
      } else {
        r.valor.unidades -= 1;
      }
    }
  }

  if (r.partidos) {
    r.brierModelo /= r.partidos;
    r.brierCasa /= r.partidos;
  }

  // 3) Combinadas (1 unidad cada una, y en dinero si se indicó importe)
  for (const comb of combinadas) {
    if (comb.estado !== 'ganada' && comb.estado !== 'perdida') continue;
    const gano = comb.estado === 'ganada';
    const cuota = cuotaEfectiva(comb.selecciones);
    r.combinadas.resueltas++;
    if (gano) r.combinadas.ganadas++;
    r.combinadas.unidades += gano ? cuota - 1 : -1;
    if (comb.importe > 0) {
      r.combinadas.importe += comb.importe;
      if (gano) r.combinadas.retorno += comb.importe * cuota;
    }
  }
  return r;
}
