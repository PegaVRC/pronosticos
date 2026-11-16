/**
 * Pruebas del lector de cupones con textos de distintos formatos
 * (como los devolvería el OCR) y del emparejador de nombres.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { analizarCupon, extraerCuotas, leerImporte, invertirSeleccion } from '../js/cupon.js';
import { similitud, emparejarPartido, normalizar } from '../js/emparejar.js';

const equipo = (id, nombre, nombreCompleto, tla) => ({ id, nombre, nombreCompleto, tla });
const PARTIDOS = [
  { id: 1, local: equipo(1, 'Tottenham', 'Tottenham Hotspur FC', 'TOT'), visita: equipo(2, 'Brighton Hove', 'Brighton & Hove Albion FC', 'BHA') },
  { id: 2, local: equipo(3, 'Arsenal', 'Arsenal FC', 'ARS'), visita: equipo(4, 'Chelsea', 'Chelsea FC', 'CHE') },
  { id: 3, local: equipo(5, 'Man United', 'Manchester United FC', 'MUN'), visita: equipo(6, 'Man City', 'Manchester City FC', 'MCI') },
  { id: 4, local: equipo(7, 'Atleti', 'Club Atlético de Madrid', 'ATM'), visita: equipo(8, 'Sevilla FC', 'Sevilla FC', 'SEV') },
  { id: 5, local: equipo(9, 'Real Madrid', 'Real Madrid CF', 'RMA'), visita: equipo(10, 'Real Sociedad', 'Real Sociedad de Fútbol', 'RSO') },
  { id: 6, local: equipo(11, 'Inter', 'FC Internazionale Milano', 'INT'), visita: equipo(12, 'Juventus', 'Juventus FC', 'JUV') },
  { id: 7, local: equipo(13, 'PSG', 'Paris Saint-Germain FC', 'PSG'), visita: equipo(14, 'Bayern', 'FC Bayern München', 'FCB') },
];

test('Cuotas: coma, punto, y no confunde horas, fechas ni líneas de goles', () => {
  assert.deepEqual(extraerCuotas('Arsenal 1,85'), [1.85]);
  assert.deepEqual(extraerCuotas('@ 2.10'), [2.1]);
  assert.deepEqual(extraerCuotas('18:45 16.11.2026'), []);
  assert.deepEqual(extraerCuotas('Más de 2.5'), []);
  assert.deepEqual(extraerCuotas('Más de 2.5 1.95'), [1.95]);
  assert.deepEqual(extraerCuotas('Over 2,5'), []);
});

test('Importe con separadores de miles', () => {
  assert.equal(leerImporte('Importe $5.000'), 5000);
  assert.equal(leerImporte('Monto: 2500'), 2500);
  assert.equal(leerImporte('Apuesta 10.000,50'), 10000.5);
  assert.equal(leerImporte('Stake 12.5'), 12.5);
});

test('Emparejador: apodos, siglas y errores de OCR', () => {
  assert.equal(normalizar('Club Atlético de Madrid'), 'atletico madrid');
  assert.ok(similitud('Man Utd', 'Manchester United FC') >= 0.9);
  assert.ok(similitud('Atlético de Madrid', 'Atleti') >= 0.9);
  assert.ok(similitud('Inter', 'FC Internazionale Milano') >= 0.9);
  assert.ok(similitud('Bayern München', 'FC Bayern München') >= 0.9);
  assert.ok(similitud('Spurs', 'Tottenham Hotspur FC') >= 0.9);
  assert.ok(similitud('Arsenai', 'Arsenal FC') >= 0.7, 'tolera errores de OCR');
  assert.ok(similitud('Real Madrid', 'Real Sociedad') < 0.7);

  assert.equal(emparejarPartido('Man Utd', 'Man City', PARTIDOS).partido.id, 3);
  assert.equal(emparejarPartido('Manchester City', 'Manchester United', PARTIDOS).invertido, true);
  assert.equal(emparejarPartido('Paris Saint-Germain', 'Bayern Munich', PARTIDOS).partido.id, 7);
  assert.equal(emparejarPartido('Liverpool', 'Everton', PARTIDOS), null);
  assert.equal(invertirSeleccion({ seleccion: '1X' }).seleccion, 'X2');
});

test('Formato A: selección primero, cuota debajo del partido, separador " - "', () => {
  const texto = `Mis apuestas
Combinada
Arsenal
Resultado Final
Arsenal - Chelsea
1.85
Más de 2.5
Total de goles
Real Madrid - Real Sociedad
1.72
Sí
Ambos equipos marcan
Inter - Juventus
1,95
Cuota total 6.20
Importe $5.000
Ganancia potencial $31.000`;
  const r = analizarCupon(texto);
  assert.equal(r.cuotaTotal, 6.2);
  assert.equal(r.importe, 5000);
  assert.equal(r.selecciones.length, 3);
  const [a, b, c] = r.selecciones;
  assert.deepEqual([a.local, a.visita, a.mercado, a.seleccion, a.cuota], ['Arsenal', 'Chelsea', '1X2', '1', 1.85]);
  assert.deepEqual([b.mercado, b.seleccion, b.linea, b.cuota], ['GOLES', 'mas', 2.5, 1.72]);
  assert.deepEqual([c.mercado, c.seleccion, c.cuota], ['AMBOS', 'si', 1.95]);
});

test('Formato B: partido primero con "vs", doble oportunidad y menos goles', () => {
  const texto = `Combinada (3)
Man Utd vs Man City
Resultado del partido
Man City
2,40
Atlético de Madrid vs Sevilla
Doble oportunidad
Atlético de Madrid o empate
1,22
Inter vs Juventus
Total de goles
Menos de 2,5
1.90
Cuota total: 5,57
Apuesta: $10.000`;
  const r = analizarCupon(texto);
  assert.equal(r.cuotaTotal, 5.57);
  assert.equal(r.importe, 10000);
  assert.equal(r.selecciones.length, 3);
  const [a, b, c] = r.selecciones;
  assert.deepEqual([a.local, a.visita, a.mercado, a.seleccion, a.cuota], ['Man Utd', 'Man City', '1X2', '2', 2.4]);
  assert.deepEqual([b.mercado, b.seleccion, b.cuota], ['DOBLE', '1X', 1.22]);
  assert.deepEqual([c.mercado, c.seleccion, c.linea, c.cuota], ['GOLES', 'menos', 2.5, 1.9]);
});

test('Formato C: apuesta simple con guion largo y cuota en la misma línea', () => {
  const texto = `Apuesta simple
PSG – Bayern München
Ambos equipos anotan
Sí @ 1.65
Monto apostado 2500`;
  const r = analizarCupon(texto);
  assert.equal(r.importe, 2500);
  assert.equal(r.selecciones.length, 1);
  const [a] = r.selecciones;
  assert.deepEqual([a.local, a.visita, a.mercado, a.seleccion, a.cuota], ['PSG', 'Bayern München', 'AMBOS', 'si', 1.65]);
});

test('Formato D: equipos en dos líneas sin separador (se reconocen con la API)', () => {
  const texto = `Tottenham
Brighton
1X2
1
2.05
Arsenal
Chelsea
Over 2.5
1.80`;
  const r = analizarCupon(texto, { partidos: PARTIDOS });
  assert.equal(r.selecciones.length, 2);
  const [a, b] = r.selecciones;
  assert.deepEqual([a.local, a.visita, a.mercado, a.seleccion, a.cuota], ['Tottenham', 'Brighton', '1X2', '1', 2.05]);
  assert.deepEqual([b.local, b.visita, b.mercado, b.seleccion, b.linea, b.cuota], ['Arsenal', 'Chelsea', 'GOLES', 'mas', 2.5, 1.8]);
});

test('Formato E: ruido de OCR y mercado no soportado queda vacío', () => {
  const texto = `Real Madrid vs. Real Sociedad 18:45
Empate
3.6O
Arsenal v Chelsea
Hándicap asiático -1
2.15`;
  const r = analizarCupon(texto);
  assert.equal(r.selecciones.length, 2);
  const [a, b] = r.selecciones;
  assert.deepEqual([a.local, a.visita, a.mercado, a.seleccion, a.cuota], ['Real Madrid', 'Real Sociedad', '1X2', 'X', 3.6]);
  assert.deepEqual([b.local, b.visita, b.mercado, b.seleccion, b.cuota], ['Arsenal', 'Chelsea', '', '', 2.15]);
});

test('Texto sin nada reconocible', () => {
  const r = analizarCupon('Hola\nnada por aquí');
  assert.equal(r.selecciones.length, 0);
  assert.equal(r.cuotaTotal, null);
});
