/**
 * Pruebas de mercados y cuotas: node --test tests/
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { probSeleccion, probConjunta, cumple, seleccionValida, textoSeleccion } from '../js/mercados.js';
import {
  leerCuota,
  analizar1X2,
  hayValor,
  valorEsperado,
  resumenCombinada,
  estadoCombinada,
  compararModeloYCasas,
} from '../js/cuotas.js';
import { pronosticar } from '../js/modelo.js';

const cerca = (a, b, tol = 1e-9) => assert.ok(Math.abs(a - b) < tol, `${a} ≈ ${b}`);
const L = { local: 1.6, visita: 1.1 };

test('leerCuota acepta coma y punto, rechaza basura', () => {
  assert.equal(leerCuota('1,85'), 1.85);
  assert.equal(leerCuota(' 2.10 '), 2.1);
  assert.equal(leerCuota('1'), null);
  assert.equal(leerCuota('abc'), null);
  assert.equal(leerCuota(''), null);
});

test('1X2 del módulo de mercados coincide con el pronóstico', () => {
  const p = pronosticar({ id: 1, fecha: '2026-01-01', local: { id: 1 }, visita: { id: 2 } }, []);
  cerca(probSeleccion({ mercado: '1X2', seleccion: '1' }, p.lambdaLocal, p.lambdaVisita), p.pLocal);
  cerca(probSeleccion({ mercado: 'GOLES', seleccion: 'mas', linea: 2.5 }, p.lambdaLocal, p.lambdaVisita), p.pMas25);
});

test('Probabilidades complementarias suman 1', () => {
  const s = (sel) => probSeleccion(sel, L.local, L.visita);
  cerca(s({ mercado: 'AMBOS', seleccion: 'si' }) + s({ mercado: 'AMBOS', seleccion: 'no' }), 1);
  cerca(s({ mercado: 'DOBLE', seleccion: '1X' }) + s({ mercado: '1X2', seleccion: '2' }), 1);
  cerca(s({ mercado: 'GOLES', seleccion: 'mas', linea: 1.5 }) + s({ mercado: 'GOLES', seleccion: 'menos', linea: 1.5 }), 1);
});

test('Ambos marcan = (1 − P(local 0)) × (1 − P(visita 0)) con Poisson independientes', () => {
  const esperado = (1 - Math.exp(-L.local)) * (1 - Math.exp(-L.visita));
  cerca(probSeleccion({ mercado: 'AMBOS', seleccion: 'si' }, L.local, L.visita), esperado, 1e-6);
});

test('Validación de selecciones', () => {
  assert.ok(seleccionValida({ mercado: 'GOLES', seleccion: 'mas', linea: 2.5 }));
  assert.ok(!seleccionValida({ mercado: 'GOLES', seleccion: 'mas', linea: 2 }));
  assert.ok(!seleccionValida({ mercado: '1X2', seleccion: '' }));
  assert.equal(textoSeleccion({ mercado: '1X2', seleccion: '2' }, 'A', 'B'), 'Gana B');
  assert.ok(cumple({ mercado: 'DOBLE', seleccion: '12' }, 2, 1));
  assert.ok(!cumple({ mercado: 'DOBLE', seleccion: '12' }, 1, 1));
});

test('Implícitas, margen y valor', () => {
  const a = analizar1X2({ 1: 2.0, X: 3.4, 2: 3.8 });
  cerca(a.implicitas['1'], 0.5);
  assert.ok(a.margen > 0.05 && a.margen < 0.06);
  cerca(a.normalizadas['1'] + a.normalizadas.X + a.normalizadas['2'], 1);
  assert.ok(hayValor(0.55, 2.0));
  assert.ok(!hayValor(0.45, 2.0));
  cerca(valorEsperado(0.55, 2.0), 0.1);
});

test('Combinada de partidos distintos multiplica; del mismo partido usa la conjunta', () => {
  const a = { partidoId: 1, lambdas: L, mercado: '1X2', seleccion: '1', cuota: 2 };
  const b = { partidoId: 2, lambdas: L, mercado: 'AMBOS', seleccion: 'si', cuota: 1.8 };
  const r = resumenCombinada([a, b]);
  cerca(r.cuotaTotal, 3.6);
  cerca(r.probModelo, probSeleccion(a, L.local, L.visita) * probSeleccion(b, L.local, L.visita));
  cerca(r.ve, r.probModelo * 3.6 - 1);

  // Mismo partido: "gana local" + "menos de 0,5 goles" es imposible
  const imposible = resumenCombinada([a, { ...a, mercado: 'GOLES', seleccion: 'menos', linea: 0.5 }]);
  assert.equal(imposible.probModelo, 0);
  assert.ok(imposible.mismosPartidos);

  // Conjunta ≥ producto cuando están correlacionadas positivamente (gana local + más de 1,5)
  const m = { ...a, mercado: 'GOLES', seleccion: 'mas', linea: 1.5 };
  const conj = probConjunta([a, m], L.local, L.visita);
  assert.ok(conj > probSeleccion(a, L.local, L.visita) * probSeleccion(m, L.local, L.visita));

  // Sin datos del modelo: no hay probabilidad
  const sin = resumenCombinada([a, { partidoId: null, lambdas: null, mercado: '1X2', seleccion: '1', cuota: 1.5 }]);
  assert.equal(sin.probModelo, null);
  assert.equal(sin.sinModelo, 1);
});

test('Estado de combinada', () => {
  assert.equal(estadoCombinada([{ estado: 'ganada' }, { estado: 'perdida' }]), 'perdida');
  assert.equal(estadoCombinada([{ estado: 'ganada' }, { estado: 'anulada' }]), 'ganada');
  assert.equal(estadoCombinada([{ estado: 'ganada' }, { estado: 'pendiente' }]), 'pendiente');
});

test('Comparación modelo vs casas', () => {
  const reg = {
    estado: 'resuelto',
    goles: { local: 2, visita: 0 },
    prob1X2: { 1: 0.6, X: 0.25, 2: 0.15 },
    mercados: [
      { mercado: '1X2', seleccion: '1', cuota: 2.5, pModelo: 0.6 }, // valor y gana
      { mercado: '1X2', seleccion: 'X', cuota: 3.2, pModelo: 0.25 },
      { mercado: '1X2', seleccion: '2', cuota: 2.4, pModelo: 0.15 }, // la casa da favorito al 2
    ],
  };
  const r = compararModeloYCasas([reg], [
    { estado: 'ganada', importe: 1000, selecciones: [{ cuota: 2, estado: 'ganada' }, { cuota: 1.5, estado: 'ganada' }] },
  ]);
  assert.equal(r.partidos, 1);
  assert.equal(r.aciertosModelo, 1);
  assert.equal(r.aciertosCasa, 0);
  assert.ok(r.brierModelo < r.brierCasa);
  assert.equal(r.valor.apuestas, 1);
  cerca(r.valor.unidades, 1.5);
  cerca(r.combinadas.unidades, 2);
  cerca(r.combinadas.retorno, 3000);
});
