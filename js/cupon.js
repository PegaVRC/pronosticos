/**
 * Lectura del texto de un cupón de apuestas (salida del OCR).
 *
 * No depende del diseño de ninguna casa de apuestas: busca patrones generales.
 *  - Partidos:  "Equipo A vs Equipo B", "A - B", "A v B", "A x B"
 *               o, si se pasan los partidos de la API, dos líneas seguidas con
 *               los nombres de un partido conocido.
 *  - Cuotas:    números decimales como 1.85 o 1,85.
 *  - Mercados:  1X2 / resultado final, doble oportunidad, más/menos goles,
 *               ambos marcan.
 *  - Totales:   "cuota total", "importe", "monto", "apuesta $…".
 *
 * Cada casa ordena los datos de una selección de forma distinta (selección,
 * mercado, partido y cuota, en cualquier orden), pero el orden se repite en todo
 * el cupón. Por eso el texto se corta en bloques alrededor de cada partido y se
 * elige el corte que deja una cuota y un mercado por bloque.
 *
 * Lo que no se reconoce se deja vacío para completarlo a mano.
 */

import { similitud, similitudEquipo } from './emparejar.js';

/* ---------------- Utilidades de texto ---------------- */

/** minúsculas y sin tildes, para buscar palabras clave */
const plano = (t) =>
  String(t)
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '');

/** Limpia una línea del OCR: guiones raros, barras, espacios y "O" leída en vez de "0". */
function limpiarLinea(l) {
  return l
    .replace(/[–—−‒]/g, '-')
    .replace(/[|¦]/g, ' ')
    .replace(/(\d[.,]\d?)[Oo](?![a-z])/g, '$10') // "1.8O" → "1.80"
    .replace(/\s+/g, ' ')
    .trim();
}

/** Contexto que indica que un número x,5 es una línea de goles y no una cuota. */
const CONTEXTO_LINEA = /(m[aá]s|menos|over|under|goles?|total|de|o|u|\+|-)\s*$/i;

/**
 * Cuotas decimales de una línea (1,85 / 1.85 / 12.50).
 * Ignora horas (18:45), fechas (16.11.2026), porcentajes y líneas de goles (más de 2.5).
 */
export function extraerCuotas(linea) {
  const cuotas = [];
  const re = /(?<![\d.,:/])(\d{1,3})[.,](\d{1,2})(?![\d.,:/%])/g;
  let m;
  while ((m = re.exec(linea))) {
    const valor = Number(`${m[1]}.${m[2]}`);
    const antes = linea.slice(Math.max(0, m.index - 12), m.index);
    const esLineaGoles = m[2] === '5' && CONTEXTO_LINEA.test(antes);
    if (!esLineaGoles && valor >= 1.01 && valor <= 1000) cuotas.push(valor);
  }
  return cuotas;
}

/** Convierte "$5.000", "2500", "10.000,50" en número. */
export function leerImporte(texto) {
  const m = String(texto).match(/(\d[\d.,]*)/g);
  if (!m) return null;
  let n = m[m.length - 1].replace(/[.,]$/, '');
  if (/^\d{1,3}([.,]\d{3})+$/.test(n)) n = n.replace(/[.,]/g, ''); // separadores de miles
  else if (/^\d{1,3}(\.\d{3})+,\d{1,2}$/.test(n)) n = n.replace(/\./g, '').replace(',', '.');
  else if (/^\d{1,3}(,\d{3})+\.\d{1,2}$/.test(n)) n = n.replace(/,/g, '');
  else n = n.replace(',', '.');
  const v = Number(n);
  return Number.isFinite(v) && v > 0 ? v : null;
}

/* ---------------- Palabras clave ---------------- */

const RE_TOTAL = /(cuotas?\s*(total(es)?|combinadas?|finale?s?)|total\s*(de\s*)?cuotas?|total odds|cuota\s*:)/;
const RE_IMPORTE = /(importe|monto|stake|apostado|valor\s*apuesta|apuesta\s*total|tu\s*apuesta)/;
const RE_IGNORAR = /(ganancia|pago|premio|retorno|posible|potencial|bono|saldo|cobro|payout|ganar)/;

/** Palabras que nunca forman parte del nombre de un equipo (para descartar falsos "A - B"). */
const RE_NO_EQUIPO =
  /(resultado|final|goles?|ambos|marcan|anotan|tiempo|total|cuota|mercado|apuesta|doble|oportunidad|handicap|empate|ganador|combinada|simple|selecci|m[aá]s de|menos de|over|under)/;

/** Señales de mercado en una línea (normalizada). */
function senales(lp) {
  const s = new Set();
  if (/doble\s*oportunidad|double chance|\bo empate\b|\bempate o\b|^(1x|x2|12)$/.test(lp)) s.add('DOBLE');
  if (/ambos|btts|both teams/.test(lp)) s.add('AMBOS');
  if (/goles|\bm[aá]s de\b|\bmenos de\b|\bover\b|\bunder\b|\btotal\b/.test(lp)) s.add('GOLES');
  if (!s.has('DOBLE') && /\b1x2\b|resultado|ganador|match result|tiempo reglamentario|\bempate\b|^(1|x|2)$/.test(lp)) s.add('1X2');
  return s;
}

/* ---------------- Detección de partidos ---------------- */

/** Quita de un posible nombre de equipo horas, fechas, cuotas y restos. */
function limpiarEquipo(t) {
  return t
    .replace(/\b\d{1,2}:\d{2}\b/g, ' ')
    .replace(/\b\d{1,2}[./]\d{1,2}([./]\d{2,4})?\b/g, ' ')
    .replace(/\b\d{1,3}[.,]\d{1,2}\b/g, ' ')
    .replace(/\b(en vivo|live|hoy|mañana|manana)\b/gi, ' ')
    .replace(/^[^\p{L}]+|[^\p{L}.)]+$/gu, '')
    .replace(/\s+/g, ' ')
    .trim();
}

const esNombreValido = (t) => (t.match(/\p{L}/gu) || []).length >= 3 && !RE_NO_EQUIPO.test(plano(t));

/** "Arsenal vs Chelsea" → { local, visita } o null */
function partidoEnLinea(linea) {
  // Primero separadores con espacios (no rompen "Paris Saint-Germain")
  let m = linea.match(/^(.+?)\s+(?:vs\.?|v\.?|x|-)\s+(.+)$/i);
  // Si no, un único guion sin espacios: "Arsenal-Chelsea"
  if (!m && (linea.match(/-/g) || []).length === 1) m = linea.match(/^(.+?)-(.+)$/);
  if (!m) return null;
  const local = limpiarEquipo(m[1]);
  const visita = limpiarEquipo(m[2]);
  return esNombreValido(local) && esNombreValido(visita) ? { local, visita } : null;
}

/**
 * Partidos escritos en dos líneas seguidas ("Arsenal" / "Chelsea"),
 * reconocidos gracias a la lista de partidos de la API.
 */
function partidosEnDosLineas(lineas, usadas, partidos) {
  const anclas = [];
  const UMBRAL = 0.8;
  // Pasada 1: en el orden de la API (local, visita). Pasada 2: invertidos.
  for (const invertido of [false, true]) {
    for (let i = 0; i < lineas.length; i++) {
      if (usadas.has(i)) continue;
      const a = limpiarEquipo(lineas[i]);
      if (!esNombreValido(a)) continue;
      // La segunda línea puede estar justo después o separada por una línea de cuota/hora
      for (const j of [i + 1, i + 2]) {
        if (j >= lineas.length || usadas.has(j)) continue;
        if (j === i + 2 && /\p{L}{3}/u.test(lineas[i + 1])) break;
        const b = limpiarEquipo(lineas[j]);
        if (!esNombreValido(b)) continue;
        const hallado = partidos.find((p) => {
          const [x, y] = invertido ? [p.visita, p.local] : [p.local, p.visita];
          return similitudEquipo(a, x) >= UMBRAL && similitudEquipo(b, y) >= UMBRAL;
        });
        if (hallado) {
          anclas.push({ indice: i, consumidas: [j], local: a, visita: b });
          usadas.add(i);
          usadas.add(j);
          break;
        }
      }
    }
  }
  return anclas;
}

/* ---------------- Lectura de un bloque (una selección) ---------------- */

const lineaSinCuotas = (l) => limpiarEquipo(l.replace(/@/g, ' '));

function leerBloque(lineas, ancla) {
  const resultado = {
    textoPartido: ancla ? ancla.texto : '',
    local: ancla?.local || '',
    visita: ancla?.visita || '',
    mercado: '',
    seleccion: '',
    linea: null,
    cuota: null,
  };
  const otras = lineas.filter((l) => !l.esAncla);
  const todas = lineas.map((l) => l.texto);

  // ¿Esta línea nombra al local o al visitante?
  const lado = (texto) => {
    if (!ancla) return null;
    const t = lineaSinCuotas(texto);
    if (!t) return null;
    const sl = similitud(t, ancla.local);
    const sv = similitud(t, ancla.visita);
    if (Math.max(sl, sv) < 0.75 || sl === sv) return null;
    return sl > sv ? '1' : '2';
  };

  // 1) Más/menos goles (línea explícita con número)
  for (const l of otras) {
    const lp = plano(l.texto);
    const m =
      lp.match(/\b(mas|over|menos|under)\s*(?:de)?\s*(\d{1,2})[.,]5\b/) || lp.match(/(?:goles?|total)[^\d+-]*([+-])\s*(\d{1,2})[.,]5\b/);
    if (m) {
      resultado.mercado = 'GOLES';
      resultado.seleccion = /mas|over|\+/.test(m[1]) ? 'mas' : 'menos';
      resultado.linea = Number(m[2]) + 0.5;
      break;
    }
  }

  // 2) Ambos marcan
  if (!resultado.mercado && otras.some((l) => senales(plano(l.texto)).has('AMBOS'))) {
    resultado.mercado = 'AMBOS';
    for (const l of otras) {
      const lp = plano(l.texto);
      if (/\b(si|yes)\b/.test(lp)) resultado.seleccion = 'si';
      else if (/\bno\b/.test(lp)) resultado.seleccion = 'no';
      if (resultado.seleccion) break;
    }
  }

  // 3) Doble oportunidad
  if (!resultado.mercado && otras.some((l) => senales(plano(l.texto)).has('DOBLE'))) {
    resultado.mercado = 'DOBLE';
    for (const l of otras) {
      const lp = plano(lineaSinCuotas(l.texto));
      const token = lp.match(/^(1x|x2|12)$/) || lp.match(/\b(1x|x2|12)\b/);
      if (token) {
        resultado.seleccion = token[1].toUpperCase();
        break;
      }
      if (/\bo\b/.test(lp) && !/doble|oportunidad/.test(lp)) {
        const partes = lp.split(/\s+o\s+/);
        if (partes.length === 2) {
          const ladoDe = (p) => (/empate|draw/.test(p) ? 'X' : /^local/.test(p) ? '1' : /^visita/.test(p) ? '2' : lado(p));
          const combo = [ladoDe(partes[0]), ladoDe(partes[1])].sort().join('');
          const mapa = { '1X': '1X', '2X': 'X2', 12: '12' };
          if (mapa[combo]) {
            resultado.seleccion = mapa[combo];
            break;
          }
        }
      }
    }
  }

  // 4) Resultado 1X2
  if (!resultado.mercado) {
    let sel = '';
    for (const l of otras) {
      // Texto sin la cuota final ("1 @ 2.05" → "1"); las etiquetas como "1X2" no son selecciones
      const crudo = plano(l.texto).replace(/@?\s*\d{1,3}[.,]\d{1,2}\s*$/, '').trim();
      if (/\b1x2\b|resultado|ganador/.test(crudo)) continue;
      const lp = plano(lineaSinCuotas(l.texto));
      if (/^(1|x|2)$/.test(crudo)) sel = crudo.toUpperCase();
      else if (/\b(empate|draw)\b/.test(lp) && !/doble/.test(lp)) sel = 'X';
      else if (/^local(es)?$/.test(lp)) sel = '1';
      else if (/^visita(nte)?$/.test(lp)) sel = '2';
      else sel = lado(l.texto) || '';
      if (sel) break;
    }
    if (sel || otras.some((l) => senales(plano(l.texto)).has('1X2'))) {
      resultado.mercado = '1X2';
      resultado.seleccion = sel;
    }
  }

  // Cuota: la primera del bloque (incluida la línea del partido)
  for (const t of todas) {
    const c = extraerCuotas(t);
    if (c.length) {
      resultado.cuota = c[0];
      break;
    }
  }
  return resultado;
}

/* ---------------- Análisis completo ---------------- */

/**
 * @param {string} texto  Texto reconocido por el OCR
 * @param {{partidos?: object[]}} opciones  Partidos de la API (mejoran la detección)
 * @returns {{selecciones: object[], cuotaTotal: number|null, importe: number|null, lineas: string[]}}
 */
export function analizarCupon(texto, { partidos = [] } = {}) {
  let lineas = String(texto ?? '')
    .split(/\r?\n/)
    .map(limpiarLinea)
    .filter((l) => l.length > 0);

  // 1) Totales e importe (y se quitan para que no se confundan con selecciones)
  let cuotaTotal = null;
  let importe = null;
  const quitar = new Set();
  lineas.forEach((l, i) => {
    const lp = plano(l);
    if (RE_IGNORAR.test(lp)) {
      quitar.add(i);
      return;
    }
    if (RE_TOTAL.test(lp)) {
      const c = extraerCuotas(l);
      const siguiente = c.length ? c : extraerCuotas(lineas[i + 1] || '');
      if (siguiente.length) {
        cuotaTotal = siguiente[siguiente.length - 1];
        quitar.add(i);
        if (!c.length) quitar.add(i + 1);
      }
      return;
    }
    if (RE_IMPORTE.test(lp) || (/apuesta/.test(lp) && /[$€]/.test(l))) {
      const v = leerImporte(l) ?? (/\d/.test(lineas[i + 1] || '') ? leerImporte(lineas[i + 1]) : null);
      if (v) {
        importe = v;
        quitar.add(i);
        if (!/\d/.test(l)) quitar.add(i + 1);
      }
    }
  });
  lineas = lineas.filter((_, i) => !quitar.has(i));

  // 2) Partidos (anclas)
  const usadas = new Set();
  const anclas = [];
  lineas.forEach((l, i) => {
    const p = partidoEnLinea(l);
    if (p) {
      anclas.push({ indice: i, consumidas: [], ...p });
      usadas.add(i);
    }
  });
  if (partidos.length) anclas.push(...partidosEnDosLineas(lineas, usadas, partidos));
  anclas.sort((a, b) => a.indice - b.indice);
  anclas.forEach((a) => {
    a.texto = [a.indice, ...a.consumidas].map((i) => lineas[i]).join(' · ');
  });

  const consumidas = new Set(anclas.flatMap((a) => a.consumidas));
  const item = (i) => ({ texto: lineas[i], esAncla: anclas.some((a) => a.indice === i) || consumidas.has(i) });

  // Sin partidos reconocidos: una sola selección con lo que se encuentre
  if (!anclas.length) {
    const bloque = lineas.map((_, i) => item(i));
    const unico = leerBloque(bloque, null);
    const util = unico.cuota || unico.mercado;
    return { selecciones: util ? [unico] : [], cuotaTotal, importe, lineas };
  }

  // 3) Elegir cuántas líneas antes de cada partido empieza su bloque (desfase)
  const posiciones = anclas.map((a) => a.indice);
  const hueco = Math.min(...posiciones.slice(1).map((p, k) => p - posiciones[k]), Infinity);
  const maxDesfase = anclas.length === 1 ? posiciones[0] : Math.min(hueco - 1, posiciones[0]);

  const bloquesCon = (desfase) =>
    anclas.map((a, k) => {
      const inicio = a.indice - desfase;
      const fin = k + 1 < anclas.length ? anclas[k + 1].indice - desfase : lineas.length;
      const indices = [];
      for (let i = inicio; i < fin; i++) indices.push(i);
      return indices;
    });

  const puntuar = (desfase) => {
    const bloques = bloquesCon(desfase);
    let puntos = 0;
    for (const [k, indices] of bloques.entries()) {
      const cuotas = indices.flatMap((i) => extraerCuotas(lineas[i]));
      const tipos = new Set();
      for (const i of indices) if (!consumidas.has(i) && i !== anclas[k].indice) senales(plano(lineas[i])).forEach((t) => tipos.add(t));
      // ¿Hay una línea que nombra a un equipo del partido (selección 1X2)?
      const nombraEquipo = indices.some(
        (i) => i !== anclas[k].indice && !consumidas.has(i) && Math.max(similitud(lineaSinCuotas(lineas[i]), anclas[k].local), similitud(lineaSinCuotas(lineas[i]), anclas[k].visita)) >= 0.75
      );
      if (cuotas.length === 1) puntos += 1;
      if (tipos.size || nombraEquipo) puntos += 1;
      if (tipos.size > 1) puntos -= 1; // dos mercados distintos en un bloque: corte equivocado
    }
    // Penaliza dejar datos útiles fuera, antes del primer bloque
    for (let i = 0; i < bloques[0][0]; i++) {
      const lp = plano(lineas[i]);
      const nombra = Math.max(similitud(lineaSinCuotas(lineas[i]), anclas[0].local), similitud(lineaSinCuotas(lineas[i]), anclas[0].visita)) >= 0.75;
      if (extraerCuotas(lineas[i]).length || senales(lp).size || nombra) puntos -= 1;
    }
    return puntos;
  };

  let mejor = anclas.length === 1 ? maxDesfase : 0;
  if (anclas.length > 1) {
    let mejorPuntos = -Infinity;
    for (let d = 0; d <= maxDesfase; d++) {
      const p = puntuar(d);
      if (p > mejorPuntos) {
        mejorPuntos = p;
        mejor = d;
      }
    }
  }

  const selecciones = bloquesCon(mejor).map((indices, k) =>
    leerBloque(
      indices.map((i) => item(i)),
      anclas[k]
    )
  );
  return { selecciones, cuotaTotal, importe, lineas };
}

/**
 * Cambia el lado de una selección cuando la casa escribió el partido al revés
 * que la API (visitante primero).
 */
export function invertirSeleccion(sel) {
  const mapa = { 1: '2', 2: '1', '1X': 'X2', X2: '1X' };
  return { ...sel, seleccion: mapa[sel.seleccion] ?? sel.seleccion };
}
