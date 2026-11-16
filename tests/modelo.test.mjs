/**
 * Pruebas del modelo (sin dependencias): npm test  (o: node --test tests/modelo.test.mjs)
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  probPoisson,
  matrizResultados,
  resumirMatriz,
  mediasLiga,
  indiceSuavizado,
  pronosticar,
  signo,
} from '../js/modelo.js';
import { formaReciente, resumenGoles, explicar } from '../js/analisis.js';

const cerca = (a, b, tol = 1e-6) => assert.ok(Math.abs(a - b) < tol, `${a} ≈ ${b}`);

/** Crea un partido terminado de prueba */
let id = 1;
function jugado(dia, local, visita, gl, gv) {
  return {
    id: id++,
    fecha: `2026-09-${String(dia).padStart(2, '0')}T15:00:00Z`,
    estado: 'FINISHED',
    local: { id: local, nombre: `Equipo ${local}` },
    visita: { id: visita, nombre: `Equipo ${visita}` },
    goles: { local: gl, visita: gv },
  };
}

test('Poisson: valores conocidos y suma 1', () => {
  cerca(probPoisson(0, 1.5), Math.exp(-1.5));
  cerca(probPoisson(2, 1.5), (Math.exp(-1.5) * 1.5 ** 2) / 2);
  let s = 0;
  for (let k = 0; k < 30; k++) s += probPoisson(k, 2.3);
  cerca(s, 1);
});

test('La matriz suma 1 y 1X2 suma 1', () => {
  const m = matrizResultados(1.6, 1.1);
  cerca(m.flat().reduce((a, b) => a + b, 0), 1);
  const r = resumirMatriz(m);
  cerca(r.pLocal + r.pEmpate + r.pVisita, 1);
  assert.ok(r.pLocal > r.pVisita);
});

test('Más de 2,5 goles = 1 − P(0, 1 o 2 goles en total)', () => {
  const lL = 1.4;
  const lV = 1.0;
  const r = resumirMatriz(matrizResultados(lL, lV, 15));
  // la suma de dos Poisson independientes es Poisson(lL + lV)
  const t = lL + lV;
  const esperado = 1 - (probPoisson(0, t) + probPoisson(1, t) + probPoisson(2, t));
  cerca(r.pMas25, esperado, 1e-6);
});

test('Marcador más probable con λ iguales y bajos es 1-1 o 0-0', () => {
  const r = resumirMatriz(matrizResultados(1.0, 1.0));
  const m = r.marcadores[0];
  assert.ok((m.local === 1 && m.visita === 1) || (m.local === 0 && m.visita === 0) || m.local + m.visita === 1);
});

test('Índice suavizado: sin partidos vale 1, con muchos se acerca al dato real', () => {
  cerca(indiceSuavizado(0, 0, 1.5), 1);
  const muchos = indiceSuavizado(300, 100, 1.5); // 3 goles/partido = el doble de la media
  assert.ok(muchos > 1.9 && muchos < 2);
});

test('Medias de liga y valores por defecto', () => {
  assert.equal(mediasLiga([]).partidos, 0);
  const m = mediasLiga([jugado(1, 1, 2, 2, 0), jugado(2, 3, 4, 1, 1)]);
  cerca(m.local, 1.5);
  cerca(m.visita, 0.5);
});

test('Un equipo goleador es favorito ante uno débil', () => {
  const partidos = [];
  // Equipo 1 golea en casa; equipo 2 recibe mucho fuera; el resto, parejo
  for (let d = 1; d <= 8; d++) {
    partidos.push(jugado(d, 1, 3 + (d % 3), 3, 0));
    partidos.push(jugado(d, 3 + (d % 3), 2, 2, 0));
    partidos.push(jugado(d, 6, 7, 1, 1));
  }
  const futuro = {
    id: 999,
    fecha: '2026-10-01T15:00:00Z',
    estado: 'TIMED',
    local: { id: 1, nombre: 'Equipo 1' },
    visita: { id: 2, nombre: 'Equipo 2' },
    goles: null,
  };
  const p = pronosticar(futuro, partidos);
  assert.equal(p.favorito, '1');
  assert.ok(p.pLocal > 0.6, `pLocal=${p.pLocal}`);
  assert.ok(p.lambdaLocal > p.lambdaVisita);
  assert.equal(p.confianza, 'alta');

  const exp = explicar(p, futuro, {
    local: formaReciente(partidos, 1, futuro.fecha),
    visita: formaReciente(partidos, 2, futuro.fecha),
  });
  assert.ok(exp.some((f) => f.includes('favorito')));
});

test('Solo usa partidos anteriores a la fecha del partido', () => {
  const partidos = [jugado(1, 1, 2, 1, 0), jugado(20, 1, 2, 9, 0)];
  const p = pronosticar({ ...partidos[1], estado: 'TIMED', goles: null }, partidos);
  assert.equal(p.fuerzasLocal.casa.pj, 1);
  assert.equal(p.fuerzasLocal.casa.gf, 1);
});

test('Sin datos: confianza baja y probabilidades válidas', () => {
  const p = pronosticar(
    { id: 1, fecha: '2026-08-01T00:00:00Z', local: { id: 1 }, visita: { id: 2 } },
    []
  );
  assert.equal(p.confianza, 'baja');
  cerca(p.pLocal + p.pEmpate + p.pVisita, 1);
});

test('Forma reciente, resumen de goles y signo', () => {
  const partidos = [jugado(1, 1, 2, 2, 0), jugado(2, 3, 1, 1, 1), jugado(3, 1, 4, 0, 1)];
  const f = formaReciente(partidos, 1, '2026-12-01T00:00:00Z');
  assert.deepEqual(f.map((x) => x.resultado), ['P', 'E', 'G']);
  const r = resumenGoles(partidos, 1, '2026-12-01T00:00:00Z');
  assert.deepEqual(r.total, { pj: 3, gf: 3, gc: 2 });
  assert.deepEqual(r.local, { pj: 2, gf: 2, gc: 1 });
  assert.equal(signo(2, 1), '1');
  assert.equal(signo(1, 1), 'X');
  assert.equal(signo(0, 3), '2');
});

test('El proxy se completa con "/?url=" si falta', async () => {
  // storage.js usa localStorage solo al leer o escribir; normalizarProxy es pura
  const { normalizarProxy } = await import('../js/storage.js');
  assert.equal(normalizarProxy('https://x.workers.dev'), 'https://x.workers.dev/?url=');
  assert.equal(normalizarProxy('https://x.workers.dev/'), 'https://x.workers.dev/?url=');
  assert.equal(normalizarProxy('https://x.workers.dev/?url='), 'https://x.workers.dev/?url=');
  assert.equal(normalizarProxy(''), '');
});
