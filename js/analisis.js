/**
 * Análisis para la pantalla de detalle:
 * forma reciente, resumen de goles y explicación en lenguaje sencillo.
 * Todo se calcula con los partidos de la temporada de la competición elegida.
 */

import { PARTIDOS_FORMA } from './config.js';
import { partidosJugadosAntes } from './modelo.js';
import { decimal, porcentaje } from './formato.js';

/**
 * Últimos `n` partidos de un equipo (local o visita), del más reciente al más antiguo.
 * @returns {{resultado:'G'|'E'|'P', rival:string, condicion:'local'|'visita', gf:number, gc:number, fecha:string}[]}
 */
export function formaReciente(todos, equipoId, antesDe, n = PARTIDOS_FORMA) {
  return partidosJugadosAntes(todos, antesDe)
    .filter((p) => p.local.id === equipoId || p.visita.id === equipoId)
    .slice(0, n)
    .map((p) => {
      const esLocal = p.local.id === equipoId;
      const gf = esLocal ? p.goles.local : p.goles.visita;
      const gc = esLocal ? p.goles.visita : p.goles.local;
      return {
        resultado: gf > gc ? 'G' : gf < gc ? 'P' : 'E',
        rival: esLocal ? p.visita.nombre : p.local.nombre,
        condicion: esLocal ? 'local' : 'visita',
        gf,
        gc,
        fecha: p.fecha,
      };
    });
}

/** Puntos obtenidos en una lista de forma (G=3, E=1, P=0). */
export const puntosForma = (forma) =>
  forma.reduce((s, f) => s + (f.resultado === 'G' ? 3 : f.resultado === 'E' ? 1 : 0), 0);

/** Goles a favor y en contra en la temporada: total, como local y como visitante. */
export function resumenGoles(todos, equipoId, antesDe) {
  const vacio = () => ({ pj: 0, gf: 0, gc: 0 });
  const r = { total: vacio(), local: vacio(), visita: vacio() };
  for (const p of partidosJugadosAntes(todos, antesDe)) {
    let condicion = null;
    if (p.local.id === equipoId) condicion = 'local';
    else if (p.visita.id === equipoId) condicion = 'visita';
    if (!condicion) continue;
    const gf = condicion === 'local' ? p.goles.local : p.goles.visita;
    const gc = condicion === 'local' ? p.goles.visita : p.goles.local;
    for (const k of ['total', condicion]) {
      r[k].pj += 1;
      r[k].gf += gf;
      r[k].gc += gc;
    }
  }
  return r;
}

/** "un 25 % más que" / "un 10 % menos que" / "similar a" */
function comparar(valor, media) {
  const dif = (valor / media - 1) * 100;
  if (Math.abs(dif) < 5) return 'similar a';
  return `un ${Math.round(Math.abs(dif))} % ${dif > 0 ? 'más' : 'menos'} que`;
}

/** Frase sobre goles marcados o recibidos en una condición (casa o fuera). */
function frase(nombre, datos, tipo, donde, media) {
  const verbo = tipo === 'gf' ? 'marca' : 'recibe';
  const lugar = donde === 'local' ? 'en casa' : 'fuera de casa';
  if (datos.pj === 0) {
    return `${nombre} aún no ha jugado ${lugar} en esta competición; para lo que ${verbo} se usa la media de la liga.`;
  }
  const promedio = datos[tipo] / datos.pj;
  return `${nombre} ${verbo} ${decimal(promedio)} goles por partido ${lugar} (últimos ${datos.pj}), ${comparar(
    promedio,
    media
  )} la media de la liga (${decimal(media)}).`;
}

/**
 * Explicación en frases simples de por qué el modelo da ese pronóstico.
 * @param {object} pron     Resultado de pronosticar()
 * @param {object} partido
 * @param {{local: object[], visita: object[]}} [forma] Forma reciente de cada equipo
 * @returns {string[]}
 */
export function explicar(pron, partido, forma) {
  const L = partido.local.nombre;
  const V = partido.visita.nombre;
  const { medias, fuerzasLocal: fL, fuerzasVisita: fV } = pron;
  const frases = [];

  // 1) Ataque de cada uno contra la defensa del otro
  frases.push(frase(L, fL.casa, 'gf', 'local', medias.local));
  frases.push(frase(V, fV.fuera, 'gc', 'visita', medias.local));
  frases.push(frase(V, fV.fuera, 'gf', 'visita', medias.visita));
  frases.push(frase(L, fL.casa, 'gc', 'local', medias.visita));

  // 2) Goles esperados
  frases.push(
    `Combinando ataque y defensa, el modelo espera ${decimal(pron.lambdaLocal)} goles de ${L} y ${decimal(
      pron.lambdaVisita
    )} de ${V}.`
  );

  // 3) Resultado
  const max = Math.max(pron.pLocal, pron.pEmpate, pron.pVisita);
  if (max < 0.45 && Math.abs(pron.pLocal - pron.pVisita) < 0.1) {
    frases.push(
      `Partido parejo: ningún resultado supera el 45 %, por eso el empate (${porcentaje(pron.pEmpate)}) tiene bastante peso.`
    );
  } else if (pron.favorito === '1') {
    frases.push(`${L} parte como favorito con un ${porcentaje(pron.pLocal)} de probabilidad de ganar.`);
  } else if (pron.favorito === '2') {
    frases.push(`${V} parte como favorito con un ${porcentaje(pron.pVisita)} de probabilidad de ganar fuera.`);
  } else {
    frases.push(`El empate es el resultado más probable (${porcentaje(pron.pEmpate)}).`);
  }

  // 4) Goles totales
  const total = pron.lambdaLocal + pron.lambdaVisita;
  frases.push(
    `Se esperan ${decimal(total)} goles en total; por eso la probabilidad de más de 2,5 goles es del ${porcentaje(
      pron.pMas25
    )}.`
  );

  // 5) Forma (informativa: el modelo usa goles, no resultados)
  if (forma && forma.local.length && forma.visita.length) {
    frases.push(
      `Forma reciente: ${L} sumó ${puntosForma(forma.local)} de ${forma.local.length * 3} puntos y ${V} ${puntosForma(
        forma.visita
      )} de ${forma.visita.length * 3}. El modelo no usa estos puntos directamente, solo los goles.`
    );
  }

  // 6) Advertencia de pocos datos
  if (pron.confianza === 'baja') {
    frases.push(
      `Ojo: hay pocos partidos de referencia (menos de 3 en la condición de local o visita), así que el pronóstico se apoya mucho en la media de la liga.`
    );
  }

  return frases;
}
