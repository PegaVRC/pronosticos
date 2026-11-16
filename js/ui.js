/**
 * Utilidades de interfaz compartidas por todas las vistas.
 */

import { porcentaje } from './formato.js';

/** Escapa texto para insertarlo de forma segura dentro de HTML. */
export function escaparHtml(texto) {
  return String(texto ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

/** Muestra un mensaje temporal en la parte inferior. */
let temporizadorToast;
export function notificar(mensaje, duracionMs = 3000) {
  const toast = document.getElementById('toast');
  if (!toast) return;
  toast.textContent = mensaje;
  toast.hidden = false;
  clearTimeout(temporizadorToast);
  temporizadorToast = setTimeout(() => {
    toast.hidden = true;
  }, duracionMs);
}

/** HTML de un indicador de carga. */
export const htmlCargando = (texto = 'Cargando…') => `<div class="cargando">${escaparHtml(texto)}</div>`;

/** HTML de un mensaje de error; si falta la key, añade un enlace a Ajustes. */
export function htmlError(error) {
  const mensaje = error?.message || String(error);
  const enlace =
    error?.tipo === 'sin-key' || error?.tipo === 'auth'
      ? '<p><a class="boton boton--chico" href="#/config">Ir a Ajustes</a></p>'
      : '';
  return `<div class="error"><p>${escaparHtml(mensaje)}</p>${enlace}</div>`;
}

/** Escudo de un equipo (o un hueco si no hay imagen). */
export function htmlEscudo(url, nombre, grande = false) {
  const clase = grande ? 'escudo escudo--grande' : 'escudo';
  if (!url) return `<span class="${clase}" aria-hidden="true"></span>`;
  return `<img class="${clase}" src="${escaparHtml(url)}" alt="" loading="lazy" referrerpolicy="no-referrer" title="${escaparHtml(nombre)}">`;
}

/** Barra horizontal con los porcentajes 1X2 y sus etiquetas. */
export function htmlBarraProbabilidades(pron) {
  const tramo = (clase, p) => `<span class="barra__tramo--${clase}" style="width:${(p * 100).toFixed(1)}%"></span>`;
  return `
    <div class="barra" role="img" aria-label="Local ${porcentaje(pron.pLocal)}, empate ${porcentaje(
      pron.pEmpate
    )}, visita ${porcentaje(pron.pVisita)}">
      ${tramo('local', pron.pLocal)}${tramo('empate', pron.pEmpate)}${tramo('visita', pron.pVisita)}
    </div>
    <div class="probs">
      <span class="prob--local">Local <strong>${porcentaje(pron.pLocal)}</strong></span>
      <span class="prob--empate">Empate <strong>${porcentaje(pron.pEmpate)}</strong></span>
      <span class="prob--visita">Visita <strong>${porcentaje(pron.pVisita)}</strong></span>
    </div>`;
}

/** "hace 3 min", "hace un momento"… */
export function haceCuanto(timestamp) {
  const seg = Math.round((Date.now() - timestamp) / 1000);
  if (seg < 45) return 'hace un momento';
  const min = Math.round(seg / 60);
  if (min < 60) return `hace ${min} min`;
  const h = Math.round(min / 60);
  return `hace ${h} h`;
}

/** Texto de la confianza del pronóstico. */
export const textoConfianza = (c) => ({ alta: 'Confianza alta', media: 'Confianza media', baja: 'Pocos datos' })[c] || '';
