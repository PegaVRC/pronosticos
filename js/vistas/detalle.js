/**
 * Vista "Detalle del partido".
 * Ruta: #/partido/{liga}/{id}
 * Muestra pronóstico, forma reciente (últimos 5), goles a favor y en contra,
 * la explicación del modelo y el botón para guardar el pronóstico.
 */

import { LIGAS } from '../config.js';
import { obtenerPartidosLiga } from '../api.js';
import { pronosticar, signo } from '../modelo.js';
import { formaReciente, resumenGoles, explicar } from '../analisis.js';
import { estaGuardado, guardarPronostico, eliminarPronostico } from '../historial.js';
import { probSeleccion } from '../mercados.js';
import { obtenerRegistro } from '../apuestas.js';
import { montarCuotas } from './cuotasPartido.js';
import { decimal, porcentaje, fechaHora, fechaCorta } from '../formato.js';
import {
  escaparHtml,
  htmlCargando,
  htmlError,
  htmlEscudo,
  htmlBarraProbabilidades,
  notificar,
  textoConfianza,
} from '../ui.js';

/** Fichas G/E/P de la forma reciente + lista de partidos. */
function htmlForma(nombre, forma) {
  if (!forma.length) {
    return `<h3>${escaparHtml(nombre)}</h3><p class="suave">Sin partidos jugados en esta competición.</p>`;
  }
  const fichas = forma
    .map(
      (f) =>
        `<span class="forma__item forma__item--${f.resultado}" title="${f.resultado === 'G' ? 'Ganó' : f.resultado === 'E' ? 'Empató' : 'Perdió'}">${f.resultado}</span>`
    )
    .join('');
  const filas = forma
    .map(
      (f) => `<li>
        <span>${fechaCorta(f.fecha)} · ${f.condicion === 'local' ? 'vs' : 'en'} ${escaparHtml(f.rival)}</span>
        <strong>${f.gf}-${f.gc}</strong>
      </li>`
    )
    .join('');
  return `
    <h3>${escaparHtml(nombre)}</h3>
    <div class="forma" aria-label="Últimos resultados, del más reciente al más antiguo">${fichas}</div>
    <ul class="lista-forma">${filas}</ul>`;
}

/** Fila de la tabla de goles. */
function filaGoles(etiqueta, d) {
  const prom = (x) => (d.pj ? decimal(x / d.pj) : '–');
  return `<tr><td>${escaparHtml(etiqueta)}</td><td>${d.pj}</td><td>${d.gf}</td><td>${d.gc}</td><td>${prom(
    d.gf
  )}</td><td>${prom(d.gc)}</td></tr>`;
}

export async function vistaDetalle(contenedor, params, sigueActiva) {
  const [codigoLiga, idTexto] = params;
  const liga = LIGAS.find((l) => l.codigo === codigoLiga);
  const id = Number(idTexto);
  if (!liga || !id) {
    contenedor.innerHTML = htmlError(new Error('Partido no encontrado.'));
    return;
  }

  contenedor.innerHTML = htmlCargando('Calculando pronóstico…');

  let datos;
  try {
    datos = await obtenerPartidosLiga(liga.codigo);
  } catch (error) {
    if (sigueActiva()) contenedor.innerHTML = htmlError(error);
    return;
  }
  if (!sigueActiva()) return;

  const partido = datos.partidos.find((p) => p.id === id);
  if (!partido || partido.local.id == null || partido.visita.id == null) {
    contenedor.innerHTML = htmlError(new Error('Partido no encontrado o con equipos por definir.'));
    return;
  }

  const { local, visita } = partido;
  const pron = pronosticar(partido, datos.partidos);
  const forma = {
    local: formaReciente(datos.partidos, local.id, partido.fecha),
    visita: formaReciente(datos.partidos, visita.id, partido.fecha),
  };
  const golesL = resumenGoles(datos.partidos, local.id, partido.fecha);
  const golesV = resumenGoles(datos.partidos, visita.id, partido.fecha);
  const frases = explicar(pron, partido, forma);

  const terminado = partido.estado === 'FINISHED' && partido.goles;
  const sePuedeGuardar = ['SCHEDULED', 'TIMED'].includes(partido.estado) && new Date(partido.fecha) > new Date();

  // Centro de la cabecera: resultado real si ya terminó; si no, "vs"
  const centro = terminado ? `${partido.goles.local} - ${partido.goles.visita}` : 'vs';
  let notaResultado = '';
  if (terminado) {
    const acierto = signo(partido.goles.local, partido.goles.visita) === pron.favorito;
    notaResultado = `<p class="centrado"><span class="etiqueta ${acierto ? 'etiqueta--ok' : 'etiqueta--fallo'}">
      Partido terminado · el modelo ${acierto ? 'acertó' : 'falló'} el 1X2</span></p>`;
  }

  const pAmbos = probSeleccion({ mercado: 'AMBOS', seleccion: 'si' }, pron.lambdaLocal, pron.lambdaVisita);
  const mostrarCuotas = sePuedeGuardar || obtenerRegistro(partido.id);

  const otrosMarcadores = pron.marcadores
    .map((m) => `<span>${m.local}-${m.visita} · ${porcentaje(m.prob)}</span>`)
    .join('');

  contenedor.innerHTML = `
    <p><a href="#/partidos/${liga.codigo}">← ${escaparHtml(liga.nombre)}</a></p>

    <section class="tarjeta">
      <div class="partido__cabecera">
        <span>${escaparHtml(fechaHora(partido.fecha))}</span>
        <span>${partido.jornada ? `Jornada ${partido.jornada}` : ''}</span>
      </div>
      <div class="detalle__equipos">
        <div class="detalle__equipo">${htmlEscudo(local.escudo, local.nombre, true)}<span>${escaparHtml(local.nombre)}</span></div>
        <div class="detalle__vs">${centro}</div>
        <div class="detalle__equipo">${htmlEscudo(visita.escudo, visita.nombre, true)}<span>${escaparHtml(visita.nombre)}</span></div>
      </div>
      ${notaResultado}
      ${htmlBarraProbabilidades(pron)}
      <div class="etiquetas">
        <span class="etiqueta ${pron.confianza === 'baja' ? 'etiqueta--pendiente' : ''}">${textoConfianza(pron.confianza)}</span>
        <span class="etiqueta">Basado en ${pron.medias.partidos} partidos de la competición</span>
      </div>
    </section>

    <section class="tarjeta">
      <h2>Pronóstico</h2>
      <div class="cifras">
        <div class="cifra"><span class="cifra__valor">${pron.marcador.local}-${pron.marcador.visita}</span><span class="cifra__nombre">Marcador más probable (${porcentaje(pron.marcador.prob)})</span></div>
        <div class="cifra"><span class="cifra__valor">${porcentaje(pron.pMas25)}</span><span class="cifra__nombre">Más de 2,5 goles</span></div>
        <div class="cifra"><span class="cifra__valor">${porcentaje(pAmbos)}</span><span class="cifra__nombre">Ambos marcan</span></div>
        <div class="cifra"><span class="cifra__valor">${decimal(pron.lambdaLocal + pron.lambdaVisita)}</span><span class="cifra__nombre">Goles esperados en total</span></div>
        <div class="cifra"><span class="cifra__valor">${decimal(pron.lambdaLocal)}</span><span class="cifra__nombre">Goles esperados ${escaparHtml(local.nombre)}</span></div>
        <div class="cifra"><span class="cifra__valor">${decimal(pron.lambdaVisita)}</span><span class="cifra__nombre">Goles esperados ${escaparHtml(visita.nombre)}</span></div>
      </div>
      <h3 style="margin-top:1rem">Marcadores más probables</h3>
      <div class="marcadores">${otrosMarcadores}</div>
      ${
        sePuedeGuardar
          ? `<p style="margin-top:1rem"><button class="boton boton--ancho" id="guardar"></button></p>`
          : ''
      }
    </section>

    ${mostrarCuotas ? '<section class="tarjeta" id="tarjeta-cuotas"></section>' : ''}

    <section class="tarjeta">
      <h2>¿Por qué este pronóstico?</h2>
      <ul class="explicacion">${frases.map((f) => `<li>${escaparHtml(f)}</li>`).join('')}</ul>
    </section>

    <section class="tarjeta">
      <h2>Forma reciente (últimos 5)</h2>
      ${htmlForma(local.nombre, forma.local)}
      <div style="height:1rem"></div>
      ${htmlForma(visita.nombre, forma.visita)}
    </section>

    <section class="tarjeta">
      <h2>Goles a favor y en contra</h2>
      <table class="tabla">
        <thead><tr><th></th><th>PJ</th><th>GF</th><th>GC</th><th>GF/PJ</th><th>GC/PJ</th></tr></thead>
        <tbody>
          ${filaGoles(`${local.nombre} (total)`, golesL.total)}
          ${filaGoles(`${local.nombre} (en casa)`, golesL.local)}
          ${filaGoles(`${visita.nombre} (total)`, golesV.total)}
          ${filaGoles(`${visita.nombre} (fuera)`, golesV.visita)}
        </tbody>
      </table>
      <p class="suave">Temporada actual en ${escaparHtml(liga.nombre)}. Media de la liga: ${decimal(
        pron.medias.local
      )} goles del local y ${decimal(pron.medias.visita)} del visitante por partido.</p>
    </section>

    <p class="suave centrado">Los pronósticos son estimaciones estadísticas, no garantías.</p>`;

  // Tarjeta de cuotas (módulo de apuestas)
  const tarjetaCuotas = contenedor.querySelector('#tarjeta-cuotas');
  if (tarjetaCuotas) montarCuotas(tarjetaCuotas, { liga: liga.codigo, partido, pron, editable: sePuedeGuardar });

  // Botón guardar / quitar del historial
  const boton = contenedor.querySelector('#guardar');
  if (boton) {
    const pintar = () => {
      const guardado = estaGuardado(partido.id);
      boton.textContent = guardado ? '★ Guardado en el historial · Quitar' : '☆ Guardar pronóstico';
      boton.classList.toggle('boton--secundario', guardado);
    };
    boton.addEventListener('click', () => {
      if (estaGuardado(partido.id)) {
        eliminarPronostico(partido.id);
        notificar('Pronóstico quitado del historial.');
      } else if (guardarPronostico(liga.codigo, partido, pron)) {
        notificar('Pronóstico guardado ✓');
      } else {
        notificar('No se pudo guardar (almacenamiento lleno o bloqueado).');
      }
      pintar();
    });
    pintar();
  }
}
