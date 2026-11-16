/**
 * Vista "Próximos partidos": pestañas por liga y una tarjeta por partido
 * con su pronóstico (1X2, marcador más probable y más de 2,5 goles).
 * Ruta: #/partidos/{código de liga}
 */

import { LIGAS, DIAS_PROXIMOS } from '../config.js';
import { obtenerPartidosLiga } from '../api.js';
import { obtenerApiKey, obtenerLigaActual, guardarLigaActual } from '../storage.js';
import { pronosticar } from '../modelo.js';
import { estaGuardado } from '../historial.js';
import { porcentaje, hora, dia, claveDia } from '../formato.js';
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

/** Elige los partidos a mostrar: los de los próximos días (o, si no hay, los 10 siguientes). */
function seleccionarProximos(partidos) {
  const ahora = Date.now();
  const limite = ahora + DIAS_PROXIMOS * 24 * 60 * 60 * 1000;
  const futuros = partidos
    .filter((p) => ESTADOS_PROXIMOS.includes(p.estado) && p.local.id != null && p.visita.id != null)
    .sort((a, b) => new Date(a.fecha) - new Date(b.fecha));
  const cercanos = futuros.filter((p) => new Date(p.fecha).getTime() <= limite);
  return cercanos.length ? cercanos : futuros.slice(0, 10);
}

/** Tarjeta de un partido. */
function htmlTarjeta(liga, partido, pron) {
  const enJuego = EN_JUEGO.includes(partido.estado);
  const guardado = estaGuardado(partido.id);
  const etiquetas = [
    `<span class="etiqueta">+2,5 goles: ${porcentaje(pron.pMas25)}</span>`,
    pron.confianza === 'baja' ? `<span class="etiqueta etiqueta--pendiente">${textoConfianza('baja')}</span>` : '',
    guardado ? '<span class="etiqueta etiqueta--ok">★ Guardado</span>' : '',
    enJuego ? '<span class="etiqueta etiqueta--fallo">● En juego</span>' : '',
  ].join('');

  return `
    <a class="tarjeta partido" href="#/partido/${liga}/${partido.id}">
      <div class="partido__cabecera">
        <span>${hora(partido.fecha)}</span>
        <span>${partido.jornada ? `Jornada ${partido.jornada}` : ''}</span>
      </div>
      <div class="equipos">
        <span class="equipo">
          ${htmlEscudo(partido.local.escudo, partido.local.nombre)}
          <span class="equipo__nombre">${escaparHtml(partido.local.nombre)}</span>
        </span>
        <span class="marcador-probable" title="Marcador más probable">${pron.marcador.local} - ${pron.marcador.visita}</span>
        <span class="equipo equipo--visita">
          ${htmlEscudo(partido.visita.escudo, partido.visita.nombre)}
          <span class="equipo__nombre">${escaparHtml(partido.visita.nombre)}</span>
        </span>
      </div>
      ${htmlBarraProbabilidades(pron)}
      <div class="etiquetas">${etiquetas}</div>
    </a>`;
}

/**
 * Dibuja la vista.
 * @param {HTMLElement} contenedor
 * @param {string[]} params  params[0] = código de liga
 * @param {() => boolean} sigueActiva  false si el usuario ya cambió de pantalla
 */
export async function vistaPartidos(contenedor, params, sigueActiva) {
  const codigo = LIGAS.some((l) => l.codigo === params[0]) ? params[0] : obtenerLigaActual();
  guardarLigaActual(codigo);
  const liga = LIGAS.find((l) => l.codigo === codigo) || LIGAS[0];

  const pestanas = LIGAS.map(
    (l) =>
      `<button class="pestana" role="tab" aria-selected="${l.codigo === liga.codigo}" data-liga="${l.codigo}">${escaparHtml(
        l.corto
      )}</button>`
  ).join('');

  contenedor.innerHTML = `
    <div class="pestanas" role="tablist" aria-label="Ligas">${pestanas}</div>
    <div id="lista-partidos"></div>`;

  contenedor.querySelectorAll('.pestana').forEach((b) =>
    b.addEventListener('click', () => {
      location.hash = `#/partidos/${b.dataset.liga}`;
    })
  );

  const lista = contenedor.querySelector('#lista-partidos');

  if (!obtenerApiKey()) {
    lista.innerHTML = `
      <div class="tarjeta centrado">
        <p>Para ver partidos necesitas una API key gratuita de football-data.org.</p>
        <a class="boton" href="#/config">Configurar API key</a>
      </div>`;
    return;
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

    const proximos = seleccionarProximos(datos.partidos);
    let html = `
      <div class="estado-datos">
        <span class="suave">Datos ${haceCuanto(datos.guardado)}</span>
        <button class="boton boton--secundario boton--chico" id="actualizar">↻ Actualizar</button>
      </div>`;
    if (datos.aviso) html += `<div class="error"><p>${escaparHtml(datos.aviso)}</p></div>`;

    if (proximos.length === 0) {
      html += `<p class="vacio">No hay partidos programados en ${escaparHtml(liga.nombre)} por ahora.</p>`;
    } else {
      let diaActual = '';
      for (const partido of proximos) {
        const clave = claveDia(partido.fecha);
        if (clave !== diaActual) {
          diaActual = clave;
          html += `<h2 class="dia">${escaparHtml(dia(partido.fecha))}</h2>`;
        }
        html += htmlTarjeta(liga.codigo, partido, pronosticar(partido, datos.partidos));
      }
    }
    lista.innerHTML = html;
    lista.querySelector('#actualizar').addEventListener('click', () => cargar(true));
  }

  await cargar(false);
}
