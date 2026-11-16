/**
 * OCR en el navegador con Tesseract.js (idioma español).
 *
 * - Tesseract.js (~4 MB con el idioma) se descarga SOLO al leer el primer cupón,
 *   y el service worker lo guarda para las siguientes veces.
 * - Antes de leer, la imagen se prepara: se escala, se pasa a grises, se
 *   invierte si es una captura en modo oscuro (texto claro sobre fondo oscuro,
 *   algo muy común en apps de apuestas) y se aumenta el contraste.
 */

/** Versiones fijas para que una actualización de la librería no rompa la app. */
export const OCR = {
  script: 'https://cdn.jsdelivr.net/npm/tesseract.js@5.1.1/dist/tesseract.min.js',
  workerPath: 'https://cdn.jsdelivr.net/npm/tesseract.js@5.1.1/dist/worker.min.js',
  corePath: 'https://cdn.jsdelivr.net/npm/tesseract.js-core@5.1.1',
  langPath: 'https://cdn.jsdelivr.net/npm/@tesseract.js-data/spa@1.0.0/4.0.0_best_int',
  idioma: 'spa',
};

let cargaScript = null;

/** Inserta el <script> de Tesseract.js una sola vez. */
function cargarTesseract() {
  if (window.Tesseract) return Promise.resolve(window.Tesseract);
  if (!cargaScript) {
    cargaScript = new Promise((resolver, rechazar) => {
      const s = document.createElement('script');
      s.src = OCR.script;
      s.async = true;
      s.crossOrigin = 'anonymous';
      s.onload = () => resolver(window.Tesseract);
      s.onerror = () => {
        cargaScript = null;
        rechazar(new Error('No se pudo descargar el lector de texto (Tesseract.js). Revisa tu conexión.'));
      };
      document.head.appendChild(s);
    });
  }
  return cargaScript;
}

/** Decodifica la imagen (File/Blob) en algo que se pueda dibujar. */
async function decodificar(archivo) {
  if ('createImageBitmap' in window) {
    try {
      return await createImageBitmap(archivo);
    } catch {
      /* algunos formatos fallan aquí; se prueba con <img> */
    }
  }
  const url = URL.createObjectURL(archivo);
  try {
    const img = new Image();
    img.src = url;
    await img.decode();
    return img;
  } finally {
    URL.revokeObjectURL(url);
  }
}

/**
 * Prepara la imagen para el OCR y devuelve un <canvas>.
 * Tesseract lee mejor texto oscuro sobre fondo claro, con letras de 20-40 px.
 */
export async function prepararImagen(archivo) {
  const img = await decodificar(archivo);
  const ancho = img.width;
  const alto = img.height;
  if (!ancho || !alto) throw new Error('La imagen está vacía o no se pudo abrir.');

  // Capturas de celular: ~1080 px de ancho está bien; las pequeñas se agrandan
  let escala = 1;
  if (ancho < 1000) escala = Math.min(3, 1400 / ancho);
  else if (ancho > 2200) escala = 2200 / ancho;

  const canvas = document.createElement('canvas');
  canvas.width = Math.round(ancho * escala);
  canvas.height = Math.round(alto * escala);
  const ctx = canvas.getContext('2d', { willReadFrequently: true });
  ctx.imageSmoothingQuality = 'high';
  ctx.drawImage(img, 0, 0, canvas.width, canvas.height);

  const datos = ctx.getImageData(0, 0, canvas.width, canvas.height);
  const px = datos.data;
  const n = px.length / 4;

  // 1) Escala de grises e histograma
  const grises = new Uint8ClampedArray(n);
  const histograma = new Uint32Array(256);
  let suma = 0;
  for (let i = 0; i < n; i++) {
    const g = Math.round(0.299 * px[i * 4] + 0.587 * px[i * 4 + 1] + 0.114 * px[i * 4 + 2]);
    grises[i] = g;
    histograma[g]++;
    suma += g;
  }

  // 2) Modo oscuro: si el fondo (la mayoría de los píxeles) es oscuro, se invierte
  const invertir = suma / n < 110;

  // 3) Contraste: estira el rango entre el percentil 1 y el 99
  const percentil = (p) => {
    let acumulado = 0;
    for (let v = 0; v < 256; v++) {
      acumulado += histograma[v];
      if (acumulado >= n * p) return v;
    }
    return 255;
  };
  const bajo = percentil(0.01);
  const alto99 = Math.max(percentil(0.99), bajo + 1);

  for (let i = 0; i < n; i++) {
    let g = ((grises[i] - bajo) * 255) / (alto99 - bajo);
    if (invertir) g = 255 - g;
    px[i * 4] = px[i * 4 + 1] = px[i * 4 + 2] = g;
  }
  ctx.putImageData(datos, 0, 0);
  return canvas;
}

const ESTADOS = {
  'loading tesseract core': 'Cargando el lector de texto…',
  'initializing tesseract': 'Iniciando el lector…',
  'loading language traineddata': 'Descargando el idioma español (solo la primera vez)…',
  'loading language traineddata (from cache)': 'Cargando el idioma español…',
  'initializing api': 'Preparando…',
  'recognizing text': 'Leyendo el cupón…',
};

/**
 * Lee el texto de una imagen.
 * @param {Blob} archivo
 * @param {(progreso:number|null, mensaje:string) => void} [alProgreso]
 * @returns {Promise<string>}
 */
export async function leerTexto(archivo, alProgreso) {
  alProgreso?.(null, 'Preparando la imagen…');
  const [Tesseract, canvas] = await Promise.all([cargarTesseract(), prepararImagen(archivo)]);

  const worker = await Tesseract.createWorker(OCR.idioma, 1, {
    workerPath: OCR.workerPath,
    corePath: OCR.corePath,
    langPath: OCR.langPath,
    logger: (m) => {
      const mensaje = ESTADOS[m.status] || 'Procesando…';
      alProgreso?.(m.status === 'recognizing text' ? m.progress : null, mensaje);
    },
  });
  try {
    // Conserva los espacios entre columnas (equipo … cuota)
    await worker.setParameters({ preserve_interword_spaces: '1' });
    const { data } = await worker.recognize(canvas);
    return data.text || '';
  } finally {
    await worker.terminate();
  }
}
