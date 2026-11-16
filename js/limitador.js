/**
 * Limitador de llamadas a la API (plan gratuito: 10 por minuto).
 *
 * Guarda en localStorage la hora de cada llamada del último minuto, así el
 * límite se respeta aunque recargues la página o tengas la app abierta en
 * dos pestañas. Si ya se hicieron 10 llamadas, espera a que la más antigua
 * salga de la ventana de 60 segundos antes de dejar pasar la siguiente.
 */

import { leer, escribir } from './storage.js';
import { LIMITE_LLAMADAS, VENTANA_LIMITE_MS } from './config.js';

const CLAVE = 'llamadasApi';

const dormir = (ms) => new Promise((resolver) => setTimeout(resolver, ms));

/** Horas (timestamps) de las llamadas hechas dentro de la ventana actual. */
export function llamadasRecientes() {
  const ahora = Date.now();
  const lista = leer(CLAVE, []);
  return Array.isArray(lista) ? lista.filter((t) => ahora - t < VENTANA_LIMITE_MS) : [];
}

/** Cuántas llamadas quedan disponibles en este minuto. */
export function llamadasDisponibles() {
  return Math.max(0, LIMITE_LLAMADAS - llamadasRecientes().length);
}

/**
 * Espera hasta que haya hueco y registra la nueva llamada.
 * @param {(segundos:number) => void} [alEsperar] Avisa cuántos segundos faltan
 */
export async function esperarTurno(alEsperar) {
  for (;;) {
    const recientes = llamadasRecientes();
    if (recientes.length < LIMITE_LLAMADAS) {
      recientes.push(Date.now());
      escribir(CLAVE, recientes);
      return;
    }
    // La más antigua sale de la ventana en este tiempo (+ un pequeño margen)
    const espera = VENTANA_LIMITE_MS - (Date.now() - recientes[0]) + 300;
    if (alEsperar) alEsperar(Math.ceil(espera / 1000));
    await dormir(espera);
  }
}

/**
 * Si la API responde 429 (demasiadas peticiones), marca el minuto como agotado
 * para que las siguientes llamadas esperen.
 */
export function marcarLimiteAgotado() {
  const ahora = Date.now();
  escribir(CLAVE, Array(LIMITE_LLAMADAS).fill(ahora));
}
