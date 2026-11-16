/**
 * Comprueba que el service worker guarda todos los archivos de la app
 * y que el manifest está listo para instalar y para "Compartir".
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

const RAIZ = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..');

function archivos(dir) {
  return fs.readdirSync(path.join(RAIZ, dir), { withFileTypes: true }).flatMap((e) =>
    e.isDirectory() ? archivos(path.join(dir, e.name)) : [path.join(dir, e.name)]
  );
}

test('sw.js incluye todos los archivos de js/, css/ e icons/', () => {
  const sw = fs.readFileSync(path.join(RAIZ, 'sw.js'), 'utf8');
  const faltan = [...archivos('js'), ...archivos('css'), ...archivos('icons')].filter((f) => !sw.includes(`'${f}'`));
  assert.deepEqual(faltan, [], `Faltan en ARCHIVOS de sw.js: ${faltan.join(', ')}`);
});

test('manifest instalable y con share_target de imágenes', () => {
  const m = JSON.parse(fs.readFileSync(path.join(RAIZ, 'manifest.json'), 'utf8'));
  const tamanos = m.icons.map((i) => i.sizes);
  assert.ok(tamanos.includes('192x192') && tamanos.includes('512x512'));
  for (const i of m.icons) assert.ok(fs.existsSync(path.join(RAIZ, i.src)), i.src);
  assert.equal(m.display, 'standalone');
  assert.equal(m.share_target.method, 'POST');
  assert.equal(m.share_target.enctype, 'multipart/form-data');
  assert.equal(m.share_target.params.files[0].name, 'imagen');
});
