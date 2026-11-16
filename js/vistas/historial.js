/**
 * Vista "Historial": pronósticos guardados, su resultado y el % de aciertos.
 * Ruta: #/historial
 * Al entrar, si hay partidos que ya deberían haber terminado, busca sus
 * resultados automáticamente (usando la caché siempre que se pueda).
 */

import { LIGAS } from '../config.js';
import {
  obtenerHistorial,
  estadisticas,
  evaluar,
  eliminarPronostico,
  actualizarResultados,
  hayPendientesPorComprobar,
} from '../historial.js';
import { porcentaje, fechaHora } from '../formato.js';
import { escaparHtml, notificar } from '../ui.js';

const nombreLiga = (codigo) => LIGAS.find((l) => l.codigo === codigo)?.corto || codigo;
const textoSigno = { 1: 'Gana local', X: 'Empate', 2: 'Gana visita' };

/** Tarjeta de un pronóstico guardado. */
function htmlEntrada(e) {
  const p = e.pronostico;
  const ev = evaluar(e);
  const probFavorito = { 1: p.pLocal, X: p.pEmpate, 2: p.pVisita }[p.favorito];

  let estado;
  if (e.estado === 'anulado') estado = '<span class="etiqueta">Anulado</span>';
  else if (!ev) estado = '<span class="etiqueta etiqueta--pendiente">Pendiente</span>';
  else if (ev.acierto1X2) estado = '<span class="etiqueta etiqueta--ok">✓ Acertó</span>';
  else estado = '<span class="etiqueta etiqueta--fallo">✗ Falló</span>';

  const extra = ev
    ? `<div class="etiquetas">
        <span class="etiqueta ${ev.aciertoMarcador ? 'etiqueta--ok' : ''}">Marcador exacto ${ev.aciertoMarcador ? '✓' : '✗'}</span>
        <span class="etiqueta ${ev.aciertoGoles ? 'etiqueta--ok' : ''}">${p.pMas25 >= 0.5 ? 'Más' : 'Menos'} de 2,5 ${ev.aciertoGoles ? '✓' : '✗'}</span>
      </div>`
    : '';

  return `
    <article class="tarjeta historial-item">
      <div class="historial-item__fila suave">
        <span>${escaparHtml(nombreLiga(e.liga))} · ${escaparHtml(fechaHora(e.fecha))}</span>
        ${estado}
      </div>
      <div class="historial-item__fila">
        <strong>${escaparHtml(e.local.nombre)} vs ${escaparHtml(e.visita.nombre)}</strong>
        ${e.resultado ? `<span class="marcador-probable">${e.resultado.local} - ${e.resultado.visita}</span>` : ''}
      </div>
      <div class="suave">
        Pronóstico: <strong>${textoSigno[p.favorito]}</strong> (${porcentaje(probFavorito)}) ·
        marcador ${p.marcador.local}-${p.marcador.visita} · +2,5 goles ${porcentaje(p.pMas25)}
      </div>
      ${extra}
      <div class="historial-item__fila">
        <a href="#/partido/${encodeURIComponent(e.liga)}/${e.id}" class="suave">Ver detalle</a>
        <button class="boton boton--secundario boton--chico" data-eliminar="${e.id}">Eliminar</button>
      </div>
    </article>`;
}

export async function vistaHistorial(contenedor, _params, sigueActiva) {
  /** Dibuja resumen y lista con lo que haya en localStorage. */
  function pintar(comprobando = false) {
    const lista = obtenerHistorial().sort((a, b) => new Date(b.fecha) - new Date(a.fecha));
    const est = estadisticas(lista);

    if (lista.length === 0) {
      contenedor.innerHTML = `
        <h2>Mi historial</h2>
        <div class="tarjeta vacio">
          <p>Aún no guardaste pronósticos.</p>
          <p>Abre un partido y toca <strong>☆ Guardar pronóstico</strong>.</p>
          <a class="boton" href="#/partidos">Ver partidos</a>
        </div>`;
      return;
    }

    contenedor.innerHTML = `
      <h2>Mi historial</h2>
      <section class="tarjeta">
        <div class="resumen">
          <div class="cifra"><span class="cifra__valor">${est.porcentaje === null ? '–' : porcentaje(est.porcentaje)}</span><span class="cifra__nombre">Aciertos 1X2</span></div>
          <div class="cifra"><span class="cifra__valor">${est.aciertos}/${est.resueltos}</span><span class="cifra__nombre">Acertados</span></div>
          <div class="cifra"><span class="cifra__valor">${est.pendientes}</span><span class="cifra__nombre">Pendientes</span></div>
        </div>
        <p class="suave" style="margin:.75rem 0 0">
          Se cuenta como acierto si gana (o empata) quien el modelo daba como más probable, a los 90 minutos.
          ${est.resueltos ? `Marcador exacto: ${est.aciertosMarcador}/${est.resueltos} · Más/menos de 2,5: ${est.aciertosGoles}/${est.resueltos}.` : ''}
        </p>
        <p style="margin:.75rem 0 0">
          <button class="boton boton--secundario boton--chico" id="comprobar" ${comprobando ? 'disabled' : ''}>
            ${comprobando ? 'Comprobando resultados…' : '↻ Comprobar resultados'}
          </button>
        </p>
      </section>
      ${lista.map(htmlEntrada).join('')}`;

    contenedor.querySelector('#comprobar').addEventListener('click', () => comprobar(true));
    contenedor.querySelectorAll('[data-eliminar]').forEach((b) =>
      b.addEventListener('click', () => {
        if (!confirm('¿Eliminar este pronóstico del historial?')) return;
        eliminarPronostico(Number(b.dataset.eliminar));
        pintar();
      })
    );
  }

  /** Busca resultados de partidos terminados y vuelve a dibujar. */
  async function comprobar(manual) {
    if (!hayPendientesPorComprobar()) {
      if (manual) notificar('No hay partidos terminados pendientes de comprobar.');
      return;
    }
    pintar(true);
    const { actualizados, errores } = await actualizarResultados();
    if (!sigueActiva()) return;
    pintar();
    if (errores.length) notificar(errores[0], 5000);
    else if (manual || actualizados) {
      notificar(actualizados ? `${actualizados} pronóstico(s) actualizado(s).` : 'Aún no hay resultados nuevos.');
    }
  }

  pintar();
  await comprobar(false);
}
