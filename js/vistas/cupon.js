/**
 * Vista "Leer cupón": subir o tomar una foto del cupón, leerlo con OCR y
 * corregir lo detectado en un formulario editable antes de guardarlo.
 * Ruta: #/cupon  (también llega aquí una imagen compartida desde la galería)
 */

import { LIGAS } from '../config.js';
import { obtenerPartidosLiga } from '../api.js';
import { obtenerApiKey } from '../storage.js';
import { pronosticar } from '../modelo.js';
import { MERCADOS, probSeleccion, seleccionValida, textoSeleccion } from '../mercados.js';
import { leerCuota, resumenCombinada, hayValor, valorEsperado, probImplicita } from '../cuotas.js';
import { guardarCombinada, anadirCuotasPartido } from '../apuestas.js';
import { analizarCupon, invertirSeleccion } from '../cupon.js';
import { emparejarPartido } from '../emparejar.js';
import { leerTexto } from '../ocr.js';
import { porcentaje, cuota as fCuota, fechaHora, decimal } from '../formato.js';
import { escaparHtml, notificar, htmlError } from '../ui.js';
import { textoVE } from './cuotasPartido.js';

const ESTADOS_DISPONIBLES = ['SCHEDULED', 'TIMED', 'IN_PLAY', 'PAUSED'];
const DIAS_CANDIDATOS = 30;

/** Partidos próximos de todas las ligas (para emparejar y para el selector). */
async function cargarCandidatos() {
  const candidatos = [];
  const porLiga = {};
  const errores = [];
  if (!obtenerApiKey()) return { candidatos, porLiga, errores: ['Sin API key: solo podrás usar "Otro partido".'] };
  const limite = Date.now() + DIAS_CANDIDATOS * 86400000;
  for (const liga of LIGAS) {
    try {
      const datos = await obtenerPartidosLiga(liga.codigo);
      porLiga[liga.codigo] = datos.partidos;
      for (const p of datos.partidos) {
        if (ESTADOS_DISPONIBLES.includes(p.estado) && p.local.id != null && new Date(p.fecha).getTime() < limite) {
          candidatos.push({ ...p, liga: liga.codigo });
        }
      }
    } catch (e) {
      errores.push(`${liga.nombre}: ${e.message}`);
    }
  }
  candidatos.sort((a, b) => new Date(a.fecha) - new Date(b.fecha));
  return { candidatos, porLiga, errores: [...new Set(errores)] };
}

/** Imagen recibida por "Compartir" (la dejó el service worker en una caché). */
async function tomarImagenCompartida() {
  if (!('caches' in window)) return null;
  try {
    const cache = await caches.open('pronosticos-compartido');
    const r = await cache.match('compartido/imagen');
    if (!r) return null;
    const blob = await r.blob();
    await cache.delete('compartido/imagen');
    return blob;
  } catch {
    return null;
  }
}

export async function vistaCupon(contenedor, _params, sigueActiva) {
  /* ---------- Estado de la pantalla ---------- */
  let filas = []; // selecciones editables
  let cuotaCupon = null;
  let importe = null;
  let textoOcr = '';
  let datosApi = null; // { candidatos, porLiga, errores }
  let urlVista = null;

  // Quita "?compartido=1" de la dirección tras recibir una imagen
  if (location.search.includes('compartido')) {
    history.replaceState(null, '', location.pathname + location.hash);
  }

  contenedor.innerHTML = `
    <p><a href="#/apuestas">← Apuestas</a></p>
    <h2>Leer cupón</h2>
    <section class="tarjeta">
      <p class="suave" style="margin-top:0">Sube una captura del cupón o tómale una foto. Funciona con cualquier casa de apuestas: se buscan partidos, mercados y cuotas. <strong>Revisa lo detectado</strong> antes de guardarlo.</p>
      <div class="fila-botones">
        <label class="boton">🖼️ Elegir imagen<input type="file" accept="image/*" id="archivo" class="oculto"></label>
        <label class="boton boton--secundario">📷 Tomar foto<input type="file" accept="image/*" capture="environment" id="camara" class="oculto"></label>
        <button class="boton boton--secundario" id="a-mano">✍️ A mano</button>
      </div>
      <img id="vista-previa" class="vista-previa" alt="Cupón elegido" hidden>
      <div id="progreso"></div>
    </section>
    <div id="formulario"></div>`;

  const progreso = contenedor.querySelector('#progreso');
  const formulario = contenedor.querySelector('#formulario');

  const mostrarProgreso = (p, mensaje) => {
    progreso.innerHTML = `<p class="suave" style="margin:.75rem 0 .35rem">${escaparHtml(mensaje)}</p>
      <progress ${p == null ? '' : `value="${p}" max="1"`} class="barra-progreso"></progress>`;
  };

  /** Carga los partidos de la API una sola vez. */
  async function asegurarDatosApi() {
    if (!datosApi) datosApi = await cargarCandidatos();
    return datosApi;
  }

  /* ---------- Paso 1: imagen → texto → filas ---------- */
  async function procesar(archivo) {
    if (!archivo) return;
    if (urlVista) URL.revokeObjectURL(urlVista);
    urlVista = URL.createObjectURL(archivo);
    const vista = contenedor.querySelector('#vista-previa');
    vista.src = urlVista;
    vista.hidden = false;
    formulario.innerHTML = '';

    try {
      mostrarProgreso(null, 'Preparando…');
      const [texto, api] = await Promise.all([leerTexto(archivo, mostrarProgreso), asegurarDatosApi()]);
      if (!sigueActiva()) return;
      textoOcr = texto;
      const analisis = analizarCupon(texto, { partidos: api.candidatos });
      cuotaCupon = analisis.cuotaTotal;
      importe = analisis.importe;
      filas = analisis.selecciones.map((s) => crearFila(s, api.candidatos));
      if (!filas.length) filas = [filaVacia()];
      progreso.innerHTML = `<p class="suave" style="margin:.75rem 0 0">✅ Lectura terminada: ${analisis.selecciones.length} selección(es) detectada(s).</p>`;
      pintarFormulario();
    } catch (e) {
      if (sigueActiva()) progreso.innerHTML = htmlError(e);
    }
  }

  /** Fila del formulario a partir de lo detectado. */
  function crearFila(s, candidatos) {
    const fila = {
      textoPartido: s.textoPartido,
      clave: '',
      local: s.local,
      visita: s.visita,
      mercado: s.mercado,
      seleccion: s.seleccion,
      linea: s.linea,
      cuota: s.cuota ? fCuota(s.cuota) : '',
      emparejado: false,
    };
    if (s.local && s.visita) {
      const e = emparejarPartido(s.local, s.visita, candidatos);
      if (e) {
        fila.clave = `${e.partido.liga}:${e.partido.id}`;
        fila.emparejado = true;
        if (e.invertido) fila.seleccion = invertirSeleccion(s).seleccion;
      } else {
        fila.clave = 'otro';
      }
    }
    return fila;
  }

  const filaVacia = () => ({ textoPartido: '', clave: '', local: '', visita: '', mercado: '', seleccion: '', linea: null, cuota: '', emparejado: false });

  /* ---------- Paso 2: formulario editable ---------- */

  /** Partido de la API elegido en una fila (o null). */
  function partidoDeFila(f) {
    if (!f.clave || f.clave === 'otro') return null;
    const [liga, id] = f.clave.split(':');
    const p = datosApi?.candidatos.find((c) => c.liga === liga && c.id === Number(id));
    return p || null;
  }

  /** Convierte una fila en selección lista para guardar (o null si está incompleta). */
  function seleccionDeFila(f) {
    const cuota = leerCuota(f.cuota);
    const base = { mercado: f.mercado, seleccion: f.seleccion, linea: f.mercado === 'GOLES' ? f.linea : undefined };
    if (!cuota || !seleccionValida(base)) return null;
    const p = partidoDeFila(f);
    if (p) {
      const pron = pronosticar(p, datosApi.porLiga[p.liga] || []);
      return {
        ...base,
        cuota,
        partidoId: p.id,
        liga: p.liga,
        fecha: p.fecha,
        local: p.local.nombre,
        visita: p.visita.nombre,
        lambdas: { local: pron.lambdaLocal, visita: pron.lambdaVisita },
        prob1X2: { 1: pron.pLocal, X: pron.pEmpate, 2: pron.pVisita },
        pModelo: probSeleccion(base, pron.lambdaLocal, pron.lambdaVisita),
      };
    }
    if (f.clave === 'otro' && f.local.trim() && f.visita.trim()) {
      return { ...base, cuota, partidoId: null, liga: '', fecha: null, local: f.local.trim(), visita: f.visita.trim(), lambdas: null, pModelo: null };
    }
    return null;
  }

  function opcionesPartido(f) {
    const grupos = LIGAS.map((l) => {
      const ops = (datosApi?.candidatos || [])
        .filter((c) => c.liga === l.codigo)
        .map((c) => {
          const v = `${c.liga}:${c.id}`;
          return `<option value="${v}" ${v === f.clave ? 'selected' : ''}>${escaparHtml(`${c.local.nombre} vs ${c.visita.nombre} · ${fechaHora(c.fecha)}`)}</option>`;
        })
        .join('');
      return ops ? `<optgroup label="${escaparHtml(l.nombre)}">${ops}</optgroup>` : '';
    }).join('');
    return `<option value="" ${!f.clave ? 'selected' : ''}>— Elige el partido —</option>${grupos}
      <option value="otro" ${f.clave === 'otro' ? 'selected' : ''}>Otro partido (no está en la lista)</option>`;
  }

  function opcionesSeleccion(f) {
    const m = MERCADOS[f.mercado];
    if (!m) return '<option value="">— Primero el mercado —</option>';
    const p = partidoDeFila(f);
    const local = p?.local.nombre || f.local || 'Local';
    const visita = p?.visita.nombre || f.visita || 'Visita';
    const etiqueta = (v, texto) => {
      if (f.mercado === 'GOLES') return texto;
      return textoSeleccion({ mercado: f.mercado, seleccion: v }, local, visita);
    };
    return `<option value="" ${!f.seleccion ? 'selected' : ''}>— Elige —</option>${m.opciones
      .map(([v, t]) => `<option value="${v}" ${v === f.seleccion ? 'selected' : ''}>${escaparHtml(etiqueta(v, t))}</option>`)
      .join('')}`;
  }

  const vacio = (cond) => (cond ? 'campo--vacio' : '');

  /** Línea con la comparación modelo vs cuota de una fila. */
  function infoFila(f) {
    const s = seleccionDeFila(f);
    if (!s) return '<span class="aviso-chico">Completa los campos marcados.</span>';
    if (s.pModelo == null) return '<span class="suave">Sin datos del modelo (partido fuera de la API).</span>';
    const valor = hayValor(s.pModelo, s.cuota);
    const ve = valorEsperado(s.pModelo, s.cuota);
    return `<span class="suave">Casa ${porcentaje(probImplicita(s.cuota))} · Modelo <strong>${porcentaje(s.pModelo)}</strong> · VE <span class="${ve >= 0 ? 'positivo' : 'negativo'}">${textoVE(ve)}</span></span>
      ${valor ? '<span class="etiqueta etiqueta--valor">VALOR</span>' : ''}`;
  }

  function htmlFila(f, i) {
    const conLinea = f.mercado === 'GOLES';
    const estadoPartido = f.emparejado
      ? '<span class="etiqueta etiqueta--ok">Emparejado automáticamente</span>'
      : f.textoPartido
        ? '<span class="etiqueta etiqueta--pendiente">Revisa el partido</span>'
        : '';
    return `
      <article class="tarjeta" data-fila="${i}">
        <div class="historial-item__fila">
          <h3 style="margin:0">Selección ${i + 1}</h3>
          <button class="boton boton--secundario boton--mini" data-quitar="${i}" aria-label="Quitar selección">✕</button>
        </div>
        ${f.textoPartido ? `<p class="suave" style="margin:.25rem 0">Leído: «${escaparHtml(f.textoPartido)}» ${estadoPartido}</p>` : ''}
        <div class="campo-cupon">
          <label>Partido</label>
          <select data-campo="clave" class="${vacio(!f.clave)}">${opcionesPartido(f)}</select>
        </div>
        ${
          f.clave === 'otro'
            ? `<div class="grid-cuotas">
                <div class="campo-cupon"><label>Local</label><input data-campo="local" value="${escaparHtml(f.local)}" class="${vacio(!f.local.trim())}"></div>
                <div class="campo-cupon"><label>Visita</label><input data-campo="visita" value="${escaparHtml(f.visita)}" class="${vacio(!f.visita.trim())}"></div>
              </div>`
            : ''
        }
        <div class="grid-cuotas">
          <div class="campo-cupon">
            <label>Mercado</label>
            <select data-campo="mercado" class="${vacio(!MERCADOS[f.mercado])}">
              <option value="" ${!f.mercado ? 'selected' : ''}>— Elige —</option>
              ${Object.entries(MERCADOS)
                .map(([k, m]) => `<option value="${k}" ${k === f.mercado ? 'selected' : ''}>${escaparHtml(m.nombre)}</option>`)
                .join('')}
            </select>
          </div>
          <div class="campo-cupon">
            <label>Selección</label>
            <select data-campo="seleccion" class="${vacio(!f.seleccion)}">${opcionesSeleccion(f)}</select>
          </div>
          ${
            conLinea
              ? `<div class="campo-cupon"><label>Línea de goles</label>
                   <input data-campo="linea" inputmode="decimal" placeholder="2,5" value="${f.linea ? decimal(f.linea) : ''}" class="${vacio(!f.linea)}"></div>`
              : ''
          }
          <div class="campo-cupon">
            <label>Cuota</label>
            <input data-campo="cuota" inputmode="decimal" placeholder="1,85" value="${escaparHtml(f.cuota)}" class="${vacio(!leerCuota(f.cuota))}">
          </div>
        </div>
        <p class="info-fila" style="margin:.5rem 0 0">${infoFila(f)}</p>
      </article>`;
  }

  function htmlResumen() {
    const sels = filas.map(seleccionDeFila);
    const completas = sels.filter(Boolean);
    const incompletas = sels.length - completas.length;
    let html = '<section class="tarjeta" id="resumen-cupon"><h2>Resumen</h2>';
    if (completas.length) {
      const r = resumenCombinada(completas);
      html += `<div class="resumen-boleto">
          <div class="cifra"><span class="cifra__valor">${fCuota(r.cuotaTotal)}</span><span class="cifra__nombre">Cuota total</span></div>
          <div class="cifra"><span class="cifra__valor">${porcentaje(r.probImplicita)}</span><span class="cifra__nombre">Prob. según la cuota</span></div>
          <div class="cifra"><span class="cifra__valor">${r.probModelo == null ? '–' : porcentaje(r.probModelo)}</span><span class="cifra__nombre">Prob. estimada (modelo)</span></div>
          <div class="cifra"><span class="cifra__valor ${r.ve == null ? '' : r.ve >= 0 ? 'positivo' : 'negativo'}">${r.ve == null ? '–' : textoVE(r.ve)}</span><span class="cifra__nombre">Valor esperado</span></div>
        </div>`;
      if (cuotaCupon && Math.abs(cuotaCupon - r.cuotaTotal) / cuotaCupon > 0.02 && !incompletas) {
        html += `<p class="aviso-chico">La cuota total leída del cupón (${fCuota(cuotaCupon)}) no coincide con la calculada (${fCuota(r.cuotaTotal)}). Revisa las cuotas.</p>`;
      }
      if (r.sinModelo) html += `<p class="aviso-chico">${r.sinModelo} selección(es) sin datos del modelo: no se puede estimar la probabilidad total.</p>`;
    }
    if (incompletas) html += `<p class="aviso-chico">${incompletas} selección(es) incompleta(s): completa los campos marcados en amarillo.</p>`;
    html += `
      <div class="campo" style="margin-top:.75rem">
        <label for="importe-cupon">Importe (opcional)</label>
        <input id="importe-cupon" class="chico" inputmode="decimal" value="${importe ? String(importe).replace('.', ',') : ''}" placeholder="Ej.: 5000">
      </div>
      <div class="fila-botones">
        <button class="boton" id="guardar-cupon">Guardar combinada</button>
        <button class="boton boton--secundario" id="agregar-fila">＋ Agregar selección</button>
      </div>
      ${textoOcr ? `<details style="margin-top:.75rem"><summary class="suave">Ver texto leído (OCR)</summary><pre class="texto-ocr">${escaparHtml(textoOcr)}</pre></details>` : ''}
    </section>`;
    return html;
  }

  function pintarFormulario() {
    formulario.innerHTML = `
      ${datosApi?.errores.length ? `<div class="error"><p>${datosApi.errores.map(escaparHtml).join('<br>')}</p></div>` : ''}
      ${filas.map(htmlFila).join('')}
      <div id="zona-resumen">${htmlResumen()}</div>`;
    conectarResumen();

    formulario.querySelectorAll('[data-fila]').forEach((tarjeta) => {
      const i = Number(tarjeta.dataset.fila);
      tarjeta.querySelector('[data-quitar]').addEventListener('click', () => {
        filas.splice(i, 1);
        pintarFormulario();
      });
      tarjeta.querySelectorAll('[data-campo]').forEach((control) => {
        const campo = control.dataset.campo;
        const estructural = control.tagName === 'SELECT'; // cambia qué campos se muestran
        control.addEventListener(estructural ? 'change' : 'input', () => {
          const f = filas[i];
          if (campo === 'linea') {
            const v = Number(control.value.replace(',', '.'));
            f.linea = Number.isFinite(v) && v > 0 ? v : null;
          } else {
            f[campo] = control.value;
          }
          if (campo === 'mercado') f.seleccion = '';
          if (campo === 'clave') f.emparejado = false;
          if (estructural) {
            pintarFormulario();
          } else {
            // Solo se actualiza lo necesario para no perder el foco del teclado
            control.classList.toggle(
              'campo--vacio',
              campo === 'cuota' ? !leerCuota(control.value) : campo === 'linea' ? !f.linea : !control.value.trim()
            );
            tarjeta.querySelector('.info-fila').innerHTML = infoFila(f);
            formulario.querySelector('#zona-resumen').innerHTML = htmlResumen();
            conectarResumen();
          }
        });
      });
    });
  }

  function conectarResumen() {
    const campoImporte = formulario.querySelector('#importe-cupon');
    campoImporte.addEventListener('change', () => {
      importe = Number(campoImporte.value.replace(/\./g, '').replace(',', '.')) || null;
    });
    formulario.querySelector('#agregar-fila').addEventListener('click', () => {
      filas.push(filaVacia());
      pintarFormulario();
      formulario.querySelector(`[data-fila="${filas.length - 1}"]`)?.scrollIntoView({ behavior: 'smooth' });
    });
    formulario.querySelector('#guardar-cupon').addEventListener('click', () => {
      importe = Number(campoImporte.value.replace(/\./g, '').replace(',', '.')) || null;
      const sels = filas.map(seleccionDeFila);
      const primeraMala = sels.findIndex((s) => !s);
      if (!filas.length) {
        notificar('Agrega al menos una selección.');
        return;
      }
      if (primeraMala >= 0) {
        notificar(`Completa la selección ${primeraMala + 1} antes de guardar.`, 4000);
        formulario.querySelector(`[data-fila="${primeraMala}"]`)?.scrollIntoView({ behavior: 'smooth' });
        return;
      }
      guardarCombinada(sels, { importe: importe || 0, origen: 'cupon', cuotaCupon });
      // Las cuotas de partidos que aún no empiezan sirven para comparar modelo vs casas
      sels.filter((s) => s.partidoId && new Date(s.fecha) > new Date()).forEach(anadirCuotasPartido);
      notificar('Cupón guardado ✓');
      location.hash = '#/apuestas';
    });
  }

  /* ---------- Eventos de la pantalla ---------- */
  for (const id of ['#archivo', '#camara']) {
    contenedor.querySelector(id).addEventListener('change', (e) => procesar(e.target.files?.[0]));
  }
  contenedor.querySelector('#a-mano').addEventListener('click', async () => {
    mostrarProgreso(null, 'Cargando partidos…');
    await asegurarDatosApi();
    if (!sigueActiva()) return;
    progreso.innerHTML = '';
    filas = [filaVacia()];
    textoOcr = '';
    cuotaCupon = null;
    pintarFormulario();
  });

  // ¿Llegó una imagen por "Compartir"?
  const compartida = await tomarImagenCompartida();
  if (compartida && sigueActiva()) procesar(compartida);
}
