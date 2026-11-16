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
  // La Premier usa nombres reales (completo y corto, como la API) para probar el emparejador
  const NOMBRES_PL = [
    ['Arsenal FC', 'Arsenal', 'ARS'],
    ['Manchester City FC', 'Man City', 'MCI'],
    ['Liverpool FC', 'Liverpool', 'LIV'],
    ['Chelsea FC', 'Chelsea', 'CHE'],
    ['Tottenham Hotspur FC', 'Tottenham', 'TOT'],
    ['Manchester United FC', 'Man United', 'MUN'],
    ['Newcastle United FC', 'Newcastle', 'NEW'],
    ['Aston Villa FC', 'Aston Villa', 'AVL'],
  ];
  const equipos = Array.from({ length: 8 }, (_, i) => ({
    id: base + i,
    name: codigo === 'PL' ? NOMBRES_PL[i][0] : `${codigo} Club ${i + 1}`,
    shortName: codigo === 'PL' ? NOMBRES_PL[i][1] : `${codigo} Club ${i + 1}`,
    tla: codigo === 'PL' ? NOMBRES_PL[i][2] : '',
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
// El service worker se bloquea en el flujo principal para que Playwright intercepte la API;
// se prueba aparte al final.
const contexto = await navegador.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, serviceWorkers: 'block' });
const pagina = await contexto.newPage();
const erroresConsola = [];
pagina.on('pageerror', (e) => erroresConsola.push(e.message));

/* ---------- Tesseract.js local (los CDN no siempre son accesibles en pruebas) ---------- */
const TESS_LOCAL = process.env.TESS_LOCAL || '';
if (TESS_LOCAL) {
  const RUTAS_TESS = [
    ['https://cdn.jsdelivr.net/npm/tesseract.js@5.1.1/dist/', 'x-tesseract.js-5.1.1/package/dist/'],
    ['https://cdn.jsdelivr.net/npm/tesseract.js-core@5.1.1/', 'x-tesseract.js-core-5.1.1/package/'],
    ['https://cdn.jsdelivr.net/npm/@tesseract.js-data/spa@1.0.0/', 'x-tesseract.js-data-spa-1.0.0/package/'],
  ];
  await contexto.route('https://cdn.jsdelivr.net/**', (route) => {
    const url = route.request().url();
    const par = RUTAS_TESS.find(([prefijo]) => url.startsWith(prefijo));
    if (!par) return route.fulfill({ status: 404 });
    const archivo = path.join(TESS_LOCAL, par[1], url.slice(par[0].length));
    if (!fs.existsSync(archivo)) return route.fulfill({ status: 404 });
    const tipo = archivo.endsWith('.wasm') ? 'application/wasm' : archivo.endsWith('.js') ? 'text/javascript' : 'application/octet-stream';
    route.fulfill({ status: 200, body: fs.readFileSync(archivo), headers: { 'Content-Type': tipo, 'Access-Control-Allow-Origin': '*' } });
  });
}

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

  // 7) Cuotas en el detalle: comparación con el modelo y boleto
  await pagina.goto(URL_APP + '#/partidos/PL');
  await pagina.locator('.partido').first().click();
  await pagina.waitForSelector('#c-1');
  await pagina.fill('#c-1', '1,90');
  await pagina.fill('#c-X', '3,40');
  await pagina.fill('#c-2', '4,20');
  await pagina.fill('#c-mas', '1.95');
  await pagina.waitForSelector('.lista-cuotas .seleccion:nth-child(4)');
  assert.match(await pagina.textContent('#tarjeta-cuotas'), /Margen de la casa/);
  await pagina.click('#guardar-cuotas');
  await pagina.click('[data-fila="0"]');
  await pagina.click('[data-fila="3"]');
  await captura('5-cuotas');

  // Segunda selección de otro partido
  await pagina.goto(URL_APP + '#/partidos/PL');
  await pagina.locator('.partido').nth(1).click();
  await pagina.waitForSelector('#c-1');
  await pagina.fill('#c-2', '2,60');
  await pagina.click('[data-fila="0"]');

  // 8) Boleto → combinada
  await pagina.click('[data-ruta=apuestas]');
  await pagina.waitForSelector('#guardar-combinada');
  const textoBoleto = await pagina.textContent('.tarjeta');
  assert.match(textoBoleto, /Boleto \(3\)/);
  assert.match(textoBoleto, /mismo partido/);
  await pagina.fill('#importe', '5000');
  await captura('6-boleto');
  await pagina.click('#guardar-combinada');
  await pagina.waitForSelector('text=Mis combinadas');

  // 9) Simular que los partidos ya se jugaron: se apuntan a partidos terminados
  await pagina.evaluate(() => {
    const pasado = new Date(Date.now() - 30 * 86400000).toISOString();
    const ids = [100004, 100005];
    const regs = JSON.parse(localStorage.getItem('pronosticos:cuotas'));
    regs.forEach((r, i) => Object.assign(r, { partidoId: ids[i % 2], fecha: pasado }));
    localStorage.setItem('pronosticos:cuotas', JSON.stringify(regs));
    const combs = JSON.parse(localStorage.getItem('pronosticos:combinadas'));
    combs[0].selecciones.forEach((s, i) => Object.assign(s, { partidoId: i < 2 ? 100004 : 100005, fecha: pasado }));
    localStorage.setItem('pronosticos:combinadas', JSON.stringify(combs));
  });
  await pagina.reload();
  await pagina.waitForSelector('text=Modelo vs. casas');
  await pagina.waitForSelector('text=Acierta el favorito');
  assert.match(await pagina.textContent('#app'), /Combinadas/);
  await captura('7-apuestas');

  // 10) Leer cupón con OCR REAL (Tesseract.js servido desde una copia local)
  if (TESS_LOCAL) {
    await probarCupon();
  } else {
    console.log('ℹ️  Prueba de OCR omitida (define TESS_LOCAL con la carpeta de Tesseract.js).');
  }
}

/**
 * Crea una imagen de cupón en "modo oscuro" con dos selecciones de partidos
 * próximos (escritos con nombres distintos a los de la API) y la lee.
 */
async function probarCupon() {
  const proximos = temporadaFalsa('PL').matches.filter((m) => m.status === 'TIMED');
  const [m1, m2] = [proximos[0], proximos[1]];
  // Nombres como los escribiría una casa de apuestas (completos, sin "FC")
  const nombre = (e) => e.name.replace(/ FC$/, '');
  const html = `<html><body style="margin:0;background:#1b1d24;color:#e8e8ea;font:28px Arial;width:720px;padding:28px">
    <div style="color:#9aa">Mis apuestas · Combinada</div><br>
    <div style="font-weight:bold">${nombre(m1.homeTeam)}</div>
    <div style="color:#9aa">Resultado final</div>
    <div style="display:flex;justify-content:space-between"><span>${nombre(m1.homeTeam)} - ${nombre(m1.awayTeam)}</span><b>1.85</b></div><br>
    <div style="font-weight:bold">Más de 2.5</div>
    <div style="color:#9aa">Total de goles</div>
    <div style="display:flex;justify-content:space-between"><span>${nombre(m2.homeTeam)} - ${nombre(m2.awayTeam)}</span><b>2,10</b></div><br>
    <div>Cuota total 3.89</div>
    <div>Importe $5.000</div>
  </body></html>`;
  const lienzo = await contexto.newPage();
  await lienzo.setViewportSize({ width: 776, height: 560 });
  await lienzo.setContent(html);
  const imagen = await lienzo.screenshot();
  await lienzo.close();

  await pagina.goto(URL_APP + '#/cupon');
  await pagina.waitForSelector('#archivo', { state: 'attached' });
  await pagina.setInputFiles('#archivo', { name: 'cupon.png', mimeType: 'image/png', buffer: imagen });
  await pagina.waitForSelector('#guardar-cupon', { timeout: 180000 });

  const filas = await pagina.$$eval('[data-fila]', (els) =>
    els.map((el) => ({
      clave: el.querySelector('[data-campo=clave]').value,
      mercado: el.querySelector('[data-campo=mercado]').value,
      seleccion: el.querySelector('[data-campo=seleccion]').value,
      cuota: el.querySelector('[data-campo=cuota]').value,
    }))
  );
  console.log('   Cupón leído:', JSON.stringify(filas));
  assert.equal(filas.length, 2);
  assert.deepEqual(filas[0], { clave: `PL:${m1.id}`, mercado: '1X2', seleccion: '1', cuota: '1,85' });
  assert.deepEqual(filas[1], { clave: `PL:${m2.id}`, mercado: 'GOLES', seleccion: 'mas', cuota: '2,10' });
  assert.equal(await pagina.inputValue('#importe-cupon'), '5000');
  await captura('8-cupon');

  await pagina.click('#guardar-cupon');
  await pagina.waitForSelector('text=📷 cupón');
}

/* ---------- PWA: service worker y "Compartir" (Web Share Target) ---------- */
{
  const ctxPwa = await navegador.newContext();
  const p = await ctxPwa.newPage();
  await p.goto(URL_APP + '#/config');
  await p.evaluate(() => navigator.serviceWorker.ready);
  await p.reload(); // ahora la página está controlada por el service worker
  // Simula lo que hace Android al compartir una imagen: POST multipart a ./compartir
  const destino = await p.evaluate(async () => {
    const fd = new FormData();
    fd.append('imagen', new Blob([new Uint8Array([137, 80, 78, 71])], { type: 'image/png' }), 'cupon.png');
    const r = await fetch('./compartir', { method: 'POST', body: fd, redirect: 'manual' });
    const guardada = await caches.open('pronosticos-compartido').then((c) => c.match('compartido/imagen'));
    return { tipo: r.type, guardada: !!guardada };
  });
  assert.equal(destino.tipo, 'opaqueredirect', 'el POST debe redirigir a la pantalla del cupón');
  assert.ok(destino.guardada, 'la imagen compartida debe quedar guardada');
  await ctxPwa.close();
}

assert.deepEqual(erroresConsola, [], `errores de JavaScript: ${erroresConsola.join(' | ')}`);
console.log(`✅ Prueba de interfaz correcta (${llamadasApi} llamadas a la API simulada).`);

await navegador.close();
servidor.close();
