/**
 * Prueba de humo de la interfaz con Playwright y una API SIMULADA
 * (no gasta llamadas reales ni necesita API key).
 *
 *   npm run e2e            (requiere tener Playwright instalado)
 *   CAPTURAS=carpeta npm run e2e   → guarda capturas de pantalla
 */
import { createRequire } from 'node:module';
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import assert from 'node:assert/strict';

// require() encuentra Playwright aunque esté instalado de forma global
const { chromium } = createRequire(import.meta.url)('playwright');

const RAIZ = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..');
const CAPTURAS = process.env.CAPTURAS || '';
const TIPOS = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.svg': 'image/svg+xml' };

/* ---------- Servidor estático mínimo ---------- */
const servidor = http.createServer((req, res) => {
  const ruta = decodeURIComponent(new URL(req.url, 'http://x').pathname);
  const archivo = path.join(RAIZ, ruta === '/' ? 'index.html' : ruta);
  if (!archivo.startsWith(RAIZ) || !fs.existsSync(archivo) || fs.statSync(archivo).isDirectory()) {
    res.writeHead(404).end();
    return;
  }
  res.writeHead(200, { 'Content-Type': TIPOS[path.extname(archivo)] || 'application/octet-stream' });
  fs.createReadStream(archivo).pipe(res);
});
await new Promise((r) => servidor.listen(0, r));
const URL_APP = `http://localhost:${servidor.address().port}/`;

/* ---------- Datos simulados de una temporada ---------- */
const DIA = 86400000;
function temporadaFalsa(codigo) {
  const base = { PL: 100, PD: 200, SA: 300, CL: 400 }[codigo];
  const equipos = Array.from({ length: 8 }, (_, i) => ({
    id: base + i,
    name: `${codigo} Club ${i + 1}`,
    shortName: `${codigo} Club ${i + 1}`,
    crest: '',
  }));
  const matches = [];
  let id = base * 1000;
  const ahora = Date.now();
  // 10 jornadas jugadas y 3 por jugar (una cada 4 días)
  for (let j = -10; j < 3; j++) {
    for (let k = 0; k < 4; k++) {
      const local = equipos[(k * 2 + j + 20) % 8];
      const visita = equipos[(k * 2 + 1 + j * 3 + 40) % 8];
      if (local.id === visita.id) continue;
      const fecha = new Date(ahora + j * 4 * DIA + 3 * 3600000 + k * 7200000).toISOString();
      const jugado = j < 0;
      // El club 1 es fuerte, el club 8 es débil
      const fuerza = (e) => 8 - (e.id - base);
      const gl = jugado ? Math.max(0, Math.round((fuerza(local) - fuerza(visita)) / 3 + 1.4 + ((id % 3) - 1))) : null;
      const gv = jugado ? Math.max(0, Math.round((fuerza(visita) - fuerza(local)) / 3 + 1 + ((id % 2) - 0.5))) : null;
      matches.push({
        id: id++,
        utcDate: fecha,
        status: jugado ? 'FINISHED' : 'TIMED',
        matchday: j + 11,
        stage: 'REGULAR_SEASON',
        homeTeam: local,
        awayTeam: visita,
        score: { fullTime: { home: gl, away: gv } },
      });
    }
  }
  return { competition: { code: codigo, name: codigo }, filters: { season: '2026' }, matches };
}

/* ---------- Prueba ---------- */
const navegador = await chromium.launch();
const pagina = await navegador.newPage({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2 });
const erroresConsola = [];
pagina.on('pageerror', (e) => erroresConsola.push(e.message));

let llamadasApi = 0;
let ultimaKey = '';
await pagina.route('https://api.football-data.org/**', (route) => {
  llamadasApi++;
  ultimaKey = route.request().headers()['x-auth-token'];
  const codigo = new URL(route.request().url()).pathname.split('/')[3];
  route.fulfill({
    status: 200,
    contentType: 'application/json',
    headers: { 'Access-Control-Allow-Origin': '*' },
    body: JSON.stringify(temporadaFalsa(codigo)),
  });
});

const captura = async (nombre) => {
  if (CAPTURAS) await pagina.screenshot({ path: path.join(CAPTURAS, `${nombre}.png`), fullPage: true });
};

// 1) Sin key → pantalla de ajustes
await pagina.goto(URL_APP);
await pagina.waitForSelector('#api-key');
assert.match(await pagina.textContent('.aviso'), /estimaciones estadísticas, no garantías/);
await captura('1-ajustes');

// 2) Guardar key → próximos partidos
await pagina.fill('#api-key', 'clave-de-prueba');
await pagina.click('button[type=submit]');
await pagina.waitForSelector('.partido');
assert.equal(ultimaKey, 'clave-de-prueba');
const tarjetas = await pagina.locator('.partido').count();
assert.ok(tarjetas > 0, 'debe haber tarjetas de partidos');
await captura('2-partidos');

// 3) Caché: volver a la misma liga no llama a la API
const antes = llamadasApi;
await pagina.click('[data-liga=PD]');
await pagina.waitForSelector('.partido');
await pagina.click('[data-liga=PL]');
await pagina.waitForSelector('.partido');
assert.equal(llamadasApi, antes + 1, 'PL debe salir de la caché; solo PD llama a la API');

// Rutas que se prueban si existen las vistas
if (process.env.SOLO_PARTIDOS !== '1') {
  // 4) Detalle
  await pagina.locator('.partido').first().click();
  await pagina.waitForSelector('#guardar');
  assert.ok((await pagina.locator('.explicacion li').count()) >= 5, 'debe haber explicación');
  assert.ok((await pagina.locator('.forma__item').count()) > 0, 'debe haber forma reciente');
  await captura('3-detalle');
  await pagina.click('#guardar');
  await pagina.waitForSelector('#guardar:has-text("Quitar")');

  // 5) Historial con un pronóstico pendiente
  await pagina.click('[data-ruta=historial]');
  await pagina.waitForSelector('.historial-item');
  assert.match(await pagina.textContent('.historial-item'), /Pendiente/);

  // 6) Simular que el partido ya terminó: se mueve su fecha al pasado
  await pagina.evaluate(() => {
    const k = 'pronosticos:historial';
    const h = JSON.parse(localStorage.getItem(k));
    h.push({ ...h[0], id: 100005, fecha: new Date(Date.now() - 30 * 86400000).toISOString() });
    localStorage.setItem(k, JSON.stringify(h));
  });
  await pagina.reload();
  await pagina.waitForSelector('.historial-item .etiqueta--ok, .historial-item .etiqueta--fallo');
  assert.match(await pagina.textContent('.resumen'), /%/);
  await captura('4-historial');
}

assert.deepEqual(erroresConsola, [], `errores de JavaScript: ${erroresConsola.join(' | ')}`);
console.log(`✅ Prueba de interfaz correcta (${llamadasApi} llamadas a la API simulada).`);

await navegador.close();
servidor.close();
