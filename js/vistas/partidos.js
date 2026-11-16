/**
 * Vista "Partidos": pestañas por liga, selector de fecha y una tarjeta por
 * partido con su pronóstico (1X2, marcador más probable y más de 2,5 goles).
 * Los partidos ya jugados muestran el resultado y si el modelo acertó.
 *
 * Rutas:
 *   #/partidos/{liga}               → próximos (incluye los de hoy ya jugados)
 *   #/partidos/{liga}/{AAAA-MM-DD}  → todos los partidos de ese día
 */

import { LIGAS, DIAS_PROXIMOS } from '../config.js';
import { obtenerPartidosLiga } from '../api.js';
import { obtenerApiKey, obtenerLigaActual, guardarLigaActual } from '../storage.js';
import { pronosticar, signo } from '../modelo.js';
import { estaGuardado } from '../historial.js';
import { porcentaje, hora, dia, claveDia, claveHoy, etiquetaDia, fechaDeClave } from '../formato.js';
import {
  escaparHtml,
  htmlCargando,
  htmlError,
  htmlEscudo,
  htmlBarraProbabilidades,
  haceCuanto,
  textoConfianza,
} from '../ui.js';

const ESTADOS_PROXIMOS = ['SCHEDULED', 'TIMED', 'IN_PLAY', 'PAUSED'];
const EN_JUEGO = ['IN_PLAY', 'PAUSED'];
const TEXTO_ESTADO = { POSTPONED: 'Aplazado', SUSPENDED: 'Suspendido', CANCELLED: 'Cancelado', AWARDED: 'Adjudicado' };

/** Días hacia atrás y hacia adelante que aparecen en la tira de fechas */
const DIAS_ATRAS = 7;
const DIAS_ADELANTE = 21;

const RE_FECHA = /^\d{4}-\d{2}-\d{2}$/;
const conEquipos = (p) => p.local.id != null && p.visita.id != null;
const porFecha = (a, b) => new Date(a.fecha) - new Date(b.fecha);

/**
 * "Próximos": los partidos de hoy (también los ya jugados) y los que vienen
 * en los próximos días. Si no hay ninguno, los 10 siguientes.
 */
function seleccionarProximos(partidos) {
  const hoy = claveHoy();
  const limite = Date.now() + DIAS_PROXIMOS * 24 * 60 * 60 * 1000;
  const deHoy = partidos.filter((p) => conEquipos(p) && claveDia(p.fecha) === hoy);
  const futuros = partidos
    .filter((p) => conEquipos(p) && ESTADOS_PROXIMOS.includes(p.estado) && claveDia(p.fecha) > hoy)
    .sort(porFecha);
  const cercanos = futuros.filter((p) => new Date(p.fecha).getTime() <= limite);
  return [...deHoy.sort(porFecha), ...(cercanos.length || deHoy.length ? cercanos : futuros.slice(0, 10))];
}

/** Todos los partidos de un día concreto (hora local). */
const partidosDelDia = (partidos, clave) =>
  partidos.filter((p) => conEquipos(p) && claveDia(p.fecha) === clave).sort(porFecha);

/** Días con partidos alrededor de hoy, para la tira de fechas (hoy siempre aparece). */
function diasConPartidos(partidos, seleccionado) {
  const desde = claveHoy(-DIAS_ATRAS);
  const hasta = claveHoy(DIAS_ADELANTE);
  const dias = new Set([claveHoy()]);
  for (const p of partidos) {
    const c = claveDia(p.fecha);
    if (c >= desde && c <= hasta && conEquipos(p)) dias.add(c);
  }
  if (seleccionado) dias.add(seleccionado);
  return [...dias].sort();
}

/** Día con partidos más cercano a una fecha (para sugerirlo cuando no hay ninguno). */
function diaMasCercano(partidos, clave) {
  const objetivo = fechaDeClave(clave).getTime();
  let mejor = null;
  for (const p of partidos) {
    if (!conEquipos(p)) continue;
    const c = claveDia(p.fecha);
    const distancia = Math.abs(fechaDeClave(c).getTime() - objetivo);
    if (c !== clave && (!mejor || distancia < mejor.distancia)) mejor = { clave: c, distancia };
  }
  return mejor?.clave || null;
}

/** Tarjeta de un partido (próximo, en juego o terminado). */
function htmlTarjeta(liga, partido, pron) {
  const enJuego = EN_JUEGO.includes(partido.estado);
  const terminado = partido.estado === 'FINISHED' && partido.goles;
  const guardado = estaGuardado(partido.id);

  let centro = `<span class="marcador-probable" title="Marcador más probable">${pron.marcador.local} - ${pron.marcador.visita}</span>`;
  const etiquetas = [];

  if (terminado) {
    const acierto = signo(partido.goles.local, partido.goles.visita) === pron.favorito;
    centro = `<span class="marcador-probable marcador-real" title="Resultado final">${partido.goles.local} - ${partido.goles.visita}</span>`;
    etiquetas.push('<span class="etiqueta">Final</span>');
    etiquetas.push(
      `<span class="etiqueta ${acierto ? 'etiqueta--ok' : 'etiqueta--fallo'}">Modelo ${acierto ? '✓ acertó' : '✗ falló'}</span>`
    );
    etiquetas.push(`<span class="etiqueta">Pronóstico ${pron.marcador.local}-${pron.marcador.visita}</span>`);
  } else {
    etiquetas.push(`<span class="etiqueta">+2,5 goles: ${porcentaje(pron.pMas25)}</span>`);
    if (pron.confianza === 'baja') etiquetas.push(`<span class="etiqueta etiqueta--pendiente">${textoConfianza('baja')}</span>`);
    if (enJuego) etiquetas.push('<span class="etiqueta etiqueta--fallo">● En juego</span>');
    if (TEXTO_ESTADO[partido.estado]) etiquetas.push(`<span class="etiqueta etiqueta--pendiente">${TEXTO_ESTADO[partido.estado]}</span>`);
  }
  if (guardado) etiquetas.push('<span class="etiqueta etiqueta--ok">★ Guardado</span>');

  return `
    <a class="tarjeta partido ${terminado ? 'partido--terminado' : ''}" href="#/partido/${liga}/${partido.id}">
      <div class="partido__cabecera">
        <span>${hora(partido.fecha)}</span>
        <span>${partido.jornada ? `Jornada ${partido.jornada}` : ''}</span>
      </div>
      <div class="equipos">
        <span class="equipo">
          ${htmlEscudo(partido.local.escudo, partido.local.nombre)}
          <span class="equipo__nombre">${escaparHtml(partido.local.nombre)}</span>
        </span>
        ${centro}
        <span class="equipo equipo--visita">
          ${htmlEscudo(partido.visita.escudo, partido.visita.nombre)}
          <span class="equipo__nombre">${escaparHtml(partido.visita.nombre)}</span>
        </span>
      </div>
      ${htmlBarraProbabilidades(pron)}
      <div class="etiquetas">${etiquetas.join('')}</div>
    </a>`;
}

/** Lista de tarjetas agrupadas por día. */
function htmlLista(liga, lista, todos) {
  let html = '';
  let diaActual = '';
  for (const partido of lista) {
    const clave = claveDia(partido.fecha);
    if (clave !== diaActual) {
      diaActual = clave;
      html += `<h2 class="dia">${escaparHtml(dia(partido.fecha))}</h2>`;
    }
    html += htmlTarjeta(liga, partido, pronosticar(partido, todos));
  }
  return html;
}

/**
 * Dibuja la vista.
 * @param {HTMLElement} contenedor
 * @param {string[]} params  params[0] = código de liga, params[1] = fecha AAAA-MM-DD (opcional)
 * @param {() => boolean} sigueActiva  false si el usuario ya cambió de pantalla
 */
export async function vistaPartidos(contenedor, params, sigueActiva) {
  const codigo = LIGAS.some((l) => l.codigo === params[0]) ? params[0] : obtenerLigaActual();
  guardarLigaActual(codigo);
  const liga = LIGAS.find((l) => l.codigo === codigo) || LIGAS[0];
  const fecha = RE_FECHA.test(params[1] || '') ? params[1] : null; // null = "Próximos"

  const ruta = (ligaCodigo, f) => `#/partidos/${ligaCodigo}${f ? `/${f}` : ''}`;

  const pestanas = LIGAS.map(
    (l) =>
      `<button class="pestana" role="tab" aria-selected="${l.codigo === liga.codigo}" data-liga="${l.codigo}">${escaparHtml(
        l.corto
      )}</button>`
  ).join('');

  contenedor.innerHTML = `
    <div class="pestanas" role="tablist" aria-label="Ligas">${pestanas}</div>
    <div id="fechas"></div>
    <div id="lista-partidos"></div>`;

  // Al cambiar de liga se mantiene la fecha elegida
  contenedor.querySelectorAll('.pestana').forEach((b) =>
    b.addEventListener('click', () => {
      location.hash = ruta(b.dataset.liga, fecha);
    })
  );

  const zonaFechas = contenedor.querySelector('#fechas');
  const lista = contenedor.querySelector('#lista-partidos');

  if (!obtenerApiKey()) {
    lista.innerHTML = `
      <div class="tarjeta centrado">
        <p>Para ver partidos necesitas una API key gratuita de football-data.org.</p>
        <a class="boton" href="#/config">Configurar API key</a>
      </div>`;
    return;
  }

  /** Tira de días + botón de calendario. */
  function pintarFechas(partidos) {
    const dias = diasConPartidos(partidos, fecha);
    const hoy = claveHoy();
    const chip = (f, texto) =>
      `<a class="chip-dia ${f === hoy ? 'chip-dia--hoy' : ''}" href="${ruta(liga.codigo, f)}" ${
        f === fecha ? 'aria-current="date"' : ''
      }>${escaparHtml(texto)}</a>`;
    // "Próximos" y el calendario quedan fijos; los días se desplazan en el medio
    zonaFechas.innerHTML = `
      <div class="selector-fechas">
        ${chip(null, 'Próximos')}
        <div class="tira-fechas" aria-label="Días con partidos">${dias.map((d) => chip(d, etiquetaDia(d))).join('')}</div>
        <label class="chip-dia chip-dia--calendario" title="Elegir otra fecha">📅
          <input type="date" id="elegir-fecha" value="${fecha || hoy}" aria-label="Elegir otra fecha">
        </label>
      </div>`;
    zonaFechas.querySelector('#elegir-fecha').addEventListener('change', (e) => {
      if (RE_FECHA.test(e.target.value)) location.hash = ruta(liga.codigo, e.target.value);
    });
    // Centra el día elegido (o "Hoy") en la tira, sin mover la página
    const tira = zonaFechas.querySelector('.tira-fechas');
    const activo = tira.querySelector('[aria-current]') || tira.querySelector('.chip-dia--hoy');
    if (activo) tira.scrollLeft = activo.offsetLeft - tira.offsetLeft - (tira.clientWidth - activo.clientWidth) / 2;
  }

  /** Carga (o recarga) los datos y dibuja la lista. */
  async function cargar(forzar) {
    lista.innerHTML = htmlCargando(`Cargando ${liga.nombre}…`);
    let datos;
    try {
      datos = await obtenerPartidosLiga(liga.codigo, { forzar });
    } catch (error) {
      if (sigueActiva()) lista.innerHTML = htmlError(error);
      return;
    }
    if (!sigueActiva()) return;

    pintarFechas(datos.partidos);

    const seleccion = fecha ? partidosDelDia(datos.partidos, fecha) : seleccionarProximos(datos.partidos);
    let html = `
      <div class="estado-datos">
        <span class="suave">Datos ${haceCuanto(datos.guardado)}</span>
        <button class="boton boton--secundario boton--chico" id="actualizar">↻ Actualizar</button>
      </div>`;
    if (datos.aviso) html += `<div class="error"><p>${escaparHtml(datos.aviso)}</p></div>`;

    if (seleccion.length) {
      html += htmlLista(liga.codigo, seleccion, datos.partidos);
    } else if (fecha) {
      const cercano = diaMasCercano(datos.partidos, fecha);
      html += `<div class="vacio">
        <p>No hay partidos de ${escaparHtml(liga.nombre)} el ${escaparHtml(etiquetaDia(fecha).toLowerCase() === 'hoy' ? 'día de hoy' : fechaDeClave(fecha).toLocaleDateString('es-ES', { weekday: 'long', day: 'numeric', month: 'long' }))}.</p>
        ${cercano ? `<a class="boton boton--secundario" href="${ruta(liga.codigo, cercano)}">Ir al ${escaparHtml(fechaDeClave(cercano).toLocaleDateString('es-ES', { weekday: 'long', day: 'numeric', month: 'long' }))}</a>` : ''}
      </div>`;
    } else {
      html += `<p class="vacio">No hay partidos programados en ${escaparHtml(liga.nombre)} por ahora.</p>`;
    }
    lista.innerHTML = html;
    lista.querySelector('#actualizar').addEventListener('click', () => cargar(true));
  }

  await cargar(false);
}
