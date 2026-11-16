/**
 * Acceso seguro a localStorage.
 * Todas las claves llevan el prefijo "pronosticos:" para no chocar con otras apps
 * publicadas en el mismo dominio (p. ej. usuario.github.io).
 * Cada lectura y escritura va en try/catch: en modo privado o con el
 * almacenamiento lleno, localStorage puede lanzar errores.
 */

const PREFIJO = 'pronosticos:';

/** Lee y parsea un valor JSON. Devuelve `porDefecto` si no existe o falla. */
export function leer(clave, porDefecto = null) {
  try {
    const crudo = localStorage.getItem(PREFIJO + clave);
    return crudo === null ? porDefecto : JSON.parse(crudo);
  } catch {
    return porDefecto;
  }
}

/** Guarda un valor como JSON. Devuelve true si se pudo guardar. */
export function escribir(clave, valor) {
  try {
    localStorage.setItem(PREFIJO + clave, JSON.stringify(valor));
    return true;
  } catch {
    return false;
  }
}

/** Elimina una clave. */
export function borrar(clave) {
  try {
    localStorage.removeItem(PREFIJO + clave);
  } catch {
    /* sin acceso a localStorage: no hay nada que borrar */
  }
}

/** Lista las claves (sin el prefijo general) que empiezan por `subprefijo`. */
export function clavesQueEmpiezan(subprefijo) {
  const resultado = [];
  try {
    for (let i = 0; i < localStorage.length; i++) {
      const k = localStorage.key(i);
      if (k && k.startsWith(PREFIJO + subprefijo)) {
        resultado.push(k.slice(PREFIJO.length));
      }
    }
  } catch {
    /* sin acceso a localStorage */
  }
  return resultado;
}

/* ---------- Ajustes del usuario ---------- */

export const obtenerApiKey = () => leer('apiKey', '');
export const guardarApiKey = (key) => escribir('apiKey', String(key).trim());
export const borrarApiKey = () => borrar('apiKey');

/**
 * Proxy CORS opcional. Si el navegador bloquea la API por CORS,
 * el usuario puede indicar un proxy propio; la URL de la API se añade al final.
 */
export const obtenerProxy = () => normalizarProxy(leer('proxy', ''));
export const guardarProxy = (url) => escribir('proxy', normalizarProxy(url));

/**
 * Completa la dirección del proxy si falta el parámetro final:
 *   "https://x.workers.dev"   → "https://x.workers.dev/?url="
 *   "https://x.workers.dev/"  → "https://x.workers.dev/?url="
 * Si ya trae "?" (p. ej. "…/?url=" u otro formato), se deja como está.
 */
export function normalizarProxy(url) {
  let p = String(url ?? '').trim();
  if (!p || p.includes('?')) return p;
  if (!p.endsWith('/')) p += '/';
  return `${p}?url=`;
}

/** Última liga elegida en la pantalla de partidos */
export const obtenerLigaActual = () => leer('ligaActual', 'PL');
export const guardarLigaActual = (codigo) => escribir('ligaActual', codigo);
