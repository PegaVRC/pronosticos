/**
 * Comparación tolerante de nombres de equipos.
 *
 * Las casas de apuestas, la API y el OCR escriben los nombres de forma distinta:
 * "Man Utd" / "Manchester United FC", "Atlético de Madrid" / "Atleti",
 * "Inter" / "FC Internazionale Milano", "Arsenai" (error de OCR)…
 * Aquí se normalizan (minúsculas, sin tildes ni siglas tipo FC) y se comparan
 * por palabras y por parecido de letras (coeficiente de Dice con bigramas).
 */

/** Palabras que no ayudan a distinguir equipos. */
const RUIDO = new Set([
  'fc', 'cf', 'afc', 'sc', 'ac', 'as', 'ss', 'ssc', 'cd', 'ud', 'sd', 'rc', 'rcd', 'club', 'de', 'del', 'la', 'el',
  'the', 'calcio', 'futbol', 'football', 'sad', 'bc', 'us', 'hotspur', 'balompie', 'and', 'cp', 'sv', 'fk', 'sk',
]);

/** Abreviaturas y apodos frecuentes → forma común. */
const ALIAS = {
  utd: 'united',
  man: 'manchester',
  spurs: 'tottenham',
  wolves: 'wolverhampton',
  nottm: 'nottingham',
  atleti: 'atletico madrid',
  atl: 'atletico',
  barca: 'barcelona',
  psg: 'paris saint germain',
  internazionale: 'inter',
  juve: 'juventus',
  munchen: 'munich',
  muenchen: 'munich',
  bayer: 'leverkusen',
  athletic: 'athletic bilbao',
  bilbao: 'athletic bilbao',
  hove: '',
  albion: '',
  milano: '',
};

/** Texto normalizado: "Club Atlético de Madrid" → "atletico madrid" */
export function normalizar(nombre) {
  const base = String(nombre ?? '')
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/ß/g, 'ss')
    .replace(/&/g, ' and ')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
  const tokens = [];
  for (const t of base.split(' ')) {
    if (!t || RUIDO.has(t) || /^\d+$/.test(t)) continue;
    const alias = ALIAS[t];
    if (alias === undefined) tokens.push(t);
    else if (alias) tokens.push(...alias.split(' '));
  }
  // Quita palabras repetidas que pueden aparecer por los alias ("athletic bilbao bilbao")
  return [...new Set(tokens)].join(' ');
}

/** Coeficiente de Dice sobre pares de letras (0 a 1). Tolera errores del OCR. */
function dice(a, b) {
  const pares = (s) => {
    const m = new Map();
    for (let i = 0; i < s.length - 1; i++) {
      const p = s.slice(i, i + 2);
      m.set(p, (m.get(p) || 0) + 1);
    }
    return m;
  };
  if (a.length < 2 || b.length < 2) return a === b ? 1 : 0;
  const pa = pares(a);
  const pb = pares(b);
  let comunes = 0;
  for (const [p, n] of pa) comunes += Math.min(n, pb.get(p) || 0);
  return (2 * comunes) / (a.length - 1 + (b.length - 1));
}

/**
 * Parecido entre dos nombres (0 a 1).
 *  1    → iguales tras normalizar
 *  0,9  → todas las palabras de uno están en el otro ("Napoli" ⊂ "SSC Napoli")
 *  resto → parecido de letras
 */
export function similitud(a, b) {
  const na = normalizar(a);
  const nb = normalizar(b);
  if (!na || !nb) return 0;
  if (na === nb) return 1;
  const ta = na.split(' ');
  const tb = nb.split(' ');
  const [corto, largo] = ta.length <= tb.length ? [ta, tb] : [tb, ta];
  if (corto.every((t) => largo.includes(t))) return 0.9;
  // Cada palabra del nombre corto parecida a alguna del largo (errores de OCR por palabra)
  const porPalabra =
    corto.reduce((s, t) => s + Math.max(...largo.map((u) => dice(t, u))), 0) / corto.length;
  return Math.max(dice(na.replace(/ /g, ''), nb.replace(/ /g, '')), porPalabra * 0.95);
}

/** Mejor parecido entre un texto y los nombres conocidos de un equipo. */
export function similitudEquipo(texto, equipo) {
  if (!texto || !equipo) return 0;
  const crudo = String(texto).trim();
  // Siglas de 3 letras (p. ej. "ARS")
  if (equipo.tla && /^[A-Z]{3}$/.test(crudo) && crudo === equipo.tla) return 0.95;
  return Math.max(...[equipo.nombre, equipo.nombreCompleto].filter(Boolean).map((n) => similitud(crudo, n)));
}

/** Umbrales para aceptar un emparejamiento. */
const MINIMO_EQUIPO = 0.55;
const MINIMO_PARTIDO = 0.7;

/**
 * Busca en la lista de partidos el que mejor coincide con dos nombres.
 * También prueba con local y visitante invertidos (algunas casas los ordenan distinto).
 * @returns {{partido:object, puntaje:number, invertido:boolean} | null}
 */
export function emparejarPartido(local, visita, partidos) {
  let mejor = null;
  for (const p of partidos) {
    if (p.local.id == null || p.visita.id == null) continue;
    const opciones = [
      { invertido: false, a: similitudEquipo(local, p.local), b: similitudEquipo(visita, p.visita) },
      { invertido: true, a: similitudEquipo(local, p.visita), b: similitudEquipo(visita, p.local) },
    ];
    for (const o of opciones) {
      if (o.a < MINIMO_EQUIPO || o.b < MINIMO_EQUIPO) continue;
      const puntaje = ((o.a + o.b) / 2) * (o.invertido ? 0.95 : 1);
      if (puntaje >= MINIMO_PARTIDO && (!mejor || puntaje > mejor.puntaje)) {
        mejor = { partido: p, puntaje, invertido: o.invertido };
      }
    }
  }
  return mejor;
}
