/**
 * Formatos de números y fechas en español.
 * Sin dependencias del DOM, para poder usarlo también en las pruebas con Node.
 */

const numero1 = new Intl.NumberFormat('es-ES', { minimumFractionDigits: 1, maximumFractionDigits: 1 });

/** 1.234 → "1,2" */
export const decimal = (n) => numero1.format(n);

/** 0.4567 → "46 %" */
export const porcentaje = (p) => `${Math.round(p * 100)}\u00a0%`; // espacio no separable: el % no queda solo en otra línea

/** Fecha corta con hora local: "sáb 22 nov, 16:00" */
export function fechaHora(iso) {
  return new Date(iso).toLocaleString('es-ES', {
    weekday: 'short',
    day: 'numeric',
    month: 'short',
    hour: '2-digit',
    minute: '2-digit',
  });
}

/** Solo hora local: "16:00" */
export const hora = (iso) =>
  new Date(iso).toLocaleTimeString('es-ES', { hour: '2-digit', minute: '2-digit' });

/** Fecha para agrupar por día: "sábado, 22 de noviembre" */
export const dia = (iso) =>
  new Date(iso).toLocaleDateString('es-ES', { weekday: 'long', day: 'numeric', month: 'long' });

/** Fecha corta sin hora: "22 nov" */
export const fechaCorta = (iso) =>
  new Date(iso).toLocaleDateString('es-ES', { day: 'numeric', month: 'short' });

/** Clave AAAA-MM-DD en hora local, para agrupar partidos por día */
export function claveDia(iso) {
  const d = new Date(iso);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

/** Cuota decimal con 2 decimales mínimo: 1.8 → "1,80" */
export const cuota = (c) => c.toLocaleString('es-ES', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
