/**
 * Mercados de apuestas que entiende la app y su probabilidad según el modelo.
 *
 * Todas las probabilidades salen de la misma matriz de Poisson que el pronóstico
 * (P de cada marcador). Así, varias selecciones de un MISMO partido se pueden
 * combinar de forma exacta: se suman los marcadores que cumplen todas a la vez.
 *
 * Una "selección" es: { mercado, seleccion, linea? }
 *   1X2    → seleccion '1' | 'X' | '2'
 *   DOBLE  → seleccion '1X' | 'X2' | '12'
 *   GOLES  → seleccion 'mas' | 'menos', linea 0.5, 1.5, 2.5…
 *   AMBOS  → seleccion 'si' | 'no'
 */

import { matrizResultados } from './modelo.js';
import { decimal } from './formato.js';

export const MERCADOS = {
  '1X2': {
    nombre: 'Resultado (1X2)',
    opciones: [
      ['1', 'Local'],
      ['X', 'Empate'],
      ['2', 'Visita'],
    ],
  },
  DOBLE: {
    nombre: 'Doble oportunidad',
    opciones: [
      ['1X', 'Local o empate'],
      ['X2', 'Empate o visita'],
      ['12', 'Local o visita'],
    ],
  },
  GOLES: {
    nombre: 'Más/menos goles',
    conLinea: true,
    opciones: [
      ['mas', 'Más de'],
      ['menos', 'Menos de'],
    ],
  },
  AMBOS: {
    nombre: 'Ambos marcan',
    opciones: [
      ['si', 'Sí'],
      ['no', 'No'],
    ],
  },
};

/** ¿La selección está completa y bien formada? */
export function seleccionValida(sel) {
  const m = MERCADOS[sel?.mercado];
  if (!m || !m.opciones.some(([v]) => v === sel.seleccion)) return false;
  // Solo líneas x,5 (sin posibilidad de devolución)
  if (m.conLinea) return Number.isFinite(sel.linea) && sel.linea > 0 && Math.abs((sel.linea % 1) - 0.5) < 1e-9;
  return true;
}

/** ¿Se cumple la selección con este marcador (goles a los 90')? */
export function cumple(sel, gl, gv) {
  switch (sel.mercado) {
    case '1X2':
      return sel.seleccion === '1' ? gl > gv : sel.seleccion === '2' ? gl < gv : gl === gv;
    case 'DOBLE':
      return sel.seleccion === '1X' ? gl >= gv : sel.seleccion === 'X2' ? gl <= gv : gl !== gv;
    case 'GOLES':
      return sel.seleccion === 'mas' ? gl + gv > sel.linea : gl + gv < sel.linea;
    case 'AMBOS':
      return sel.seleccion === 'si' ? gl > 0 && gv > 0 : gl === 0 || gv === 0;
    default:
      return false;
  }
}

/**
 * Probabilidad de que se cumplan TODAS las selecciones (de un mismo partido).
 * @param {object[]} selecciones
 * @param {number} lambdaLocal  Goles esperados del local
 * @param {number} lambdaVisita Goles esperados del visitante
 */
export function probConjunta(selecciones, lambdaLocal, lambdaVisita) {
  const matriz = matrizResultados(lambdaLocal, lambdaVisita);
  let p = 0;
  matriz.forEach((fila, i) =>
    fila.forEach((q, j) => {
      if (selecciones.every((s) => cumple(s, i, j))) p += q;
    })
  );
  return p;
}

/** Probabilidad de una sola selección. */
export const probSeleccion = (sel, lambdaLocal, lambdaVisita) => probConjunta([sel], lambdaLocal, lambdaVisita);

/** Texto legible: "Gana Arsenal", "Más de 2,5 goles", "Ambos marcan: Sí"… */
export function textoSeleccion(sel, local = 'Local', visita = 'Visita') {
  switch (sel.mercado) {
    case '1X2':
      return sel.seleccion === '1' ? `Gana ${local}` : sel.seleccion === '2' ? `Gana ${visita}` : 'Empate';
    case 'DOBLE':
      return {
        '1X': `${local} o empate`,
        X2: `Empate o ${visita}`,
        12: `${local} o ${visita}`,
      }[sel.seleccion];
    case 'GOLES':
      return `${sel.seleccion === 'mas' ? 'Más' : 'Menos'} de ${decimal(sel.linea)} goles`;
    case 'AMBOS':
      return `Ambos marcan: ${sel.seleccion === 'si' ? 'Sí' : 'No'}`;
    default:
      return '¿?';
  }
}

/** Clave única de una selección dentro de un partido (para no repetirla). */
export const claveSeleccion = (sel) => `${sel.mercado}:${sel.seleccion}:${sel.linea ?? ''}`;
