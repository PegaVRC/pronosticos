/**
 * Modelo de pronóstico basado en la distribución de Poisson.
 *
 * Idea general:
 *  1. Medias de la liga: goles por partido del equipo local y del visitante.
 *  2. Fuerzas de cada equipo, por separado jugando de local y de visita
 *     (últimos PARTIDOS_FUERZA partidos en cada condición):
 *       - Ataque  = goles que marca   / goles que marca un equipo medio
 *       - Defensa = goles que recibe  / goles que recibe un equipo medio
 *     Un valor de 1 es "como la media"; 1,3 es un 30 % por encima.
 *  3. Goles esperados (λ):
 *       λ local  = ataque local (en casa)    × defensa visitante (fuera) × media de goles locales
 *       λ visita = ataque visitante (fuera)  × defensa local (en casa)   × media de goles visitantes
 *  4. Se supone que los goles de cada equipo siguen una Poisson independiente,
 *     y se arma la matriz de probabilidades de cada marcador (0-0, 1-0, …).
 *  5. De esa matriz salen 1X2, el marcador más probable y más/menos 2,5 goles.
 */

import {
  PARTIDOS_FUERZA,
  PESO_PREVIO,
  MAX_GOLES,
  MEDIA_LOCAL_DEFECTO,
  MEDIA_VISITA_DEFECTO,
} from './config.js';

/**
 * P(X = k) para una Poisson de media λ: e^(-λ) · λ^k / k!
 * Se calcula de forma iterativa para no manejar factoriales enormes.
 */
export function probPoisson(k, lambda) {
  let p = Math.exp(-lambda);
  for (let i = 1; i <= k; i++) p *= lambda / i;
  return p;
}

/**
 * Partidos terminados (con goles y equipos definidos) jugados antes de `fecha`,
 * ordenados del más reciente al más antiguo.
 */
export function partidosJugadosAntes(partidos, fecha) {
  const limite = new Date(fecha).getTime();
  return partidos
    .filter(
      (p) =>
        p.estado === 'FINISHED' &&
        p.goles &&
        p.local.id != null &&
        p.visita.id != null &&
        new Date(p.fecha).getTime() < limite
    )
    .sort((a, b) => new Date(b.fecha) - new Date(a.fecha));
}

/** Goles medios por partido de los locales y de los visitantes en la liga. */
export function mediasLiga(jugados) {
  if (jugados.length === 0) {
    return { local: MEDIA_LOCAL_DEFECTO, visita: MEDIA_VISITA_DEFECTO, partidos: 0 };
  }
  let golesLocal = 0;
  let golesVisita = 0;
  for (const p of jugados) {
    golesLocal += p.goles.local;
    golesVisita += p.goles.visita;
  }
  return {
    // Evita una media 0 (p. ej. una sola jornada sin goles) que anularía el modelo
    local: Math.max(golesLocal / jugados.length, 0.3),
    visita: Math.max(golesVisita / jugados.length, 0.3),
    partidos: jugados.length,
  };
}

/**
 * Goles a favor y en contra de un equipo en sus últimos `n` partidos
 * como local ('local') o como visitante ('visita').
 * `jugados` debe venir ordenado del más reciente al más antiguo.
 */
export function rendimiento(jugados, equipoId, condicion, n = PARTIDOS_FUERZA) {
  const lista = jugados.filter((p) => p[condicion].id === equipoId).slice(0, n);
  let gf = 0;
  let gc = 0;
  for (const p of lista) {
    if (condicion === 'local') {
      gf += p.goles.local;
      gc += p.goles.visita;
    } else {
      gf += p.goles.visita;
      gc += p.goles.local;
    }
  }
  return { pj: lista.length, gf, gc };
}

/**
 * Convierte goles en un índice de fuerza relativo a la media de la liga.
 * Se suman PESO_PREVIO partidos "ficticios" con la media de la liga:
 * con pocos datos el índice se acerca a 1 (equipo medio); con muchos,
 * pesan los datos reales.
 */
export function indiceSuavizado(goles, pj, media) {
  if (media <= 0) return 1;
  return (goles + PESO_PREVIO * media) / ((pj + PESO_PREVIO) * media);
}

/** Fuerzas de ataque y defensa de un equipo, en casa y fuera. */
export function fuerzasEquipo(jugados, equipoId, medias) {
  const casa = rendimiento(jugados, equipoId, 'local');
  const fuera = rendimiento(jugados, equipoId, 'visita');
  return {
    casa,
    fuera,
    // En casa marca contra la media de goles locales y recibe contra la de visitantes
    ataqueLocal: indiceSuavizado(casa.gf, casa.pj, medias.local),
    defensaLocal: indiceSuavizado(casa.gc, casa.pj, medias.visita),
    // Fuera marca contra la media de goles visitantes y recibe contra la de locales
    ataqueVisita: indiceSuavizado(fuera.gf, fuera.pj, medias.visita),
    defensaVisita: indiceSuavizado(fuera.gc, fuera.pj, medias.local),
  };
}

/**
 * Matriz de probabilidades: matriz[i][j] = P(local marca i y visitante marca j).
 * Se normaliza para que sume 1 (corrige la parte que queda fuera de 0..MAX_GOLES).
 */
export function matrizResultados(lambdaLocal, lambdaVisita, maxGoles = MAX_GOLES) {
  const pl = [];
  const pv = [];
  for (let k = 0; k <= maxGoles; k++) {
    pl.push(probPoisson(k, lambdaLocal));
    pv.push(probPoisson(k, lambdaVisita));
  }
  const matriz = pl.map((a) => pv.map((b) => a * b));
  const total = matriz.flat().reduce((s, x) => s + x, 0);
  return matriz.map((fila) => fila.map((x) => x / total));
}

/** Resume la matriz en las probabilidades que muestra la app. */
export function resumirMatriz(matriz) {
  let pLocal = 0;
  let pEmpate = 0;
  let pVisita = 0;
  let pMas25 = 0;
  const marcadores = [];

  matriz.forEach((fila, i) =>
    fila.forEach((p, j) => {
      if (i > j) pLocal += p;
      else if (i === j) pEmpate += p;
      else pVisita += p;
      if (i + j > 2.5) pMas25 += p;
      marcadores.push({ local: i, visita: j, prob: p });
    })
  );

  marcadores.sort((a, b) => b.prob - a.prob);
  return { pLocal, pEmpate, pVisita, pMas25, marcadores: marcadores.slice(0, 6) };
}

/** '1' (local), 'X' (empate) o '2' (visita) según el marcador. */
export function signo(golesLocal, golesVisita) {
  if (golesLocal > golesVisita) return '1';
  if (golesLocal < golesVisita) return '2';
  return 'X';
}

/**
 * Pronóstico completo de un partido.
 * @param {object} partido   Partido compactado (ver api.js)
 * @param {object[]} todos   Todos los partidos de la temporada de esa liga
 */
export function pronosticar(partido, todos) {
  // Solo se usa información anterior al partido (importante para el historial)
  const jugados = partidosJugadosAntes(todos, partido.fecha);
  const medias = mediasLiga(jugados);
  const fuerzasLocal = fuerzasEquipo(jugados, partido.local.id, medias);
  const fuerzasVisita = fuerzasEquipo(jugados, partido.visita.id, medias);

  const lambdaLocal = fuerzasLocal.ataqueLocal * fuerzasVisita.defensaVisita * medias.local;
  const lambdaVisita = fuerzasVisita.ataqueVisita * fuerzasLocal.defensaLocal * medias.visita;

  const resumen = resumirMatriz(matrizResultados(lambdaLocal, lambdaVisita));
  const masProbable = resumen.marcadores[0];

  // Resultado favorito (en caso de igualdad: 1, luego X, luego 2)
  const opciones = [
    ['1', resumen.pLocal],
    ['X', resumen.pEmpate],
    ['2', resumen.pVisita],
  ];
  const favorito = opciones.reduce((mejor, o) => (o[1] > mejor[1] ? o : mejor))[0];

  // Confianza según cuántos partidos de referencia hay en cada condición
  const muestras = Math.min(fuerzasLocal.casa.pj, fuerzasVisita.fuera.pj);
  const confianza = medias.partidos === 0 || muestras < 3 ? 'baja' : muestras < 6 ? 'media' : 'alta';

  return {
    lambdaLocal,
    lambdaVisita,
    ...resumen,
    marcador: { local: masProbable.local, visita: masProbable.visita, prob: masProbable.prob },
    favorito,
    medias,
    fuerzasLocal,
    fuerzasVisita,
    muestras,
    confianza,
  };
}
