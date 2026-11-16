/**
 * Vista "Apuestas": boleto (combinada en armado), combinadas guardadas,
 * cuotas registradas y rendimiento del modelo frente a las casas.
 * Ruta: #/apuestas
 */

import { LIGAS } from '../config.js';
import { textoSeleccion } from '../mercados.js';
import { resumenCombinada, compararModeloYCasas, hayValor, cuotaEfectiva } from '../cuotas.js';
import {
  obtenerBoleto,
  quitarDelBoleto,
  vaciarBoleto,
  guardarCombinada,
  obtenerCombinadas,
  eliminarCombinada,
  marcarSeleccion,
  obtenerRegistros,
  anadirCuotasPartido,
  actualizarApuestas,
  hayApuestasPorComprobar,
} from '../apuestas.js';
import { porcentaje, cuota as fCuota, fechaHora, fechaCorta, decimal } from '../formato.js';
import { escaparHtml, notificar } from '../ui.js';
import { textoVE } from './cuotasPartido.js';

const nombreLiga = (c) => LIGAS.find((l) => l.codigo === c)?.corto || '';
const ICONO = { pendiente: '⏳', ganada: '✅', perdida: '❌', anulada: '➖' };
const ETIQUETA = {
  pendiente: '<span class="etiqueta etiqueta--pendiente">Pendiente</span>',
  ganada: '<span class="etiqueta etiqueta--ok">Ganada</span>',
  perdida: '<span class="etiqueta etiqueta--fallo">Perdida</span>',
};
const dinero = (n) => n.toLocaleString('es-ES', { maximumFractionDigits: 2 });
const unidades = (u) => `${u >= 0 ? '+' : '−'}${decimal(Math.abs(u))} u`;

/** Fila de una selección (en el boleto o en una combinada). */
function htmlSeleccion(s, acciones = '') {
  const partido = `${escaparHtml(s.local)} vs ${escaparHtml(s.visita)}`;
  const enlace = s.partidoId ? `<a href="#/partido/${s.liga}/${s.partidoId}">${partido}</a>` : partido;
  const valor = s.pModelo != null && hayValor(s.pModelo, s.cuota) ? '<span class="etiqueta etiqueta--valor">VALOR</span>' : '';
  const modelo = s.pModelo != null ? `Modelo ${porcentaje(s.pModelo)}` : 'Sin datos del modelo';
  return `
    <div class="seleccion">
      <div class="seleccion__texto">
        <div><strong>${escaparHtml(textoSeleccion(s, s.local, s.visita))}</strong> ${valor}</div>
        <div class="seleccion__partido">${enlace}${s.fecha ? ` · ${fechaCorta(s.fecha)}` : ''} · ${modelo}</div>
      </div>
      <div class="seleccion__lado"><strong>${fCuota(s.cuota)}</strong>${acciones}</div>
    </div>`;
}

/** Cifras de resumen de una combinada. */
function htmlResumen(r) {
  return `
    <div class="resumen-boleto">
      <div class="cifra"><span class="cifra__valor">${fCuota(r.cuotaTotal)}</span><span class="cifra__nombre">Cuota total</span></div>
      <div class="cifra"><span class="cifra__valor">${porcentaje(r.probImplicita)}</span><span class="cifra__nombre">Prob. según la cuota</span></div>
      <div class="cifra"><span class="cifra__valor">${r.probModelo == null ? '–' : porcentaje(r.probModelo)}</span><span class="cifra__nombre">Prob. estimada (modelo)</span></div>
      <div class="cifra"><span class="cifra__valor ${r.ve == null ? '' : r.ve >= 0 ? 'positivo' : 'negativo'}">${r.ve == null ? '–' : textoVE(r.ve)}</span><span class="cifra__nombre">Valor esperado</span></div>
    </div>
    ${r.mismosPartidos ? '<p class="aviso-chico">Incluye varias selecciones del mismo partido: su probabilidad se calcula en conjunto (no se multiplican). No todas las casas permiten combinarlas.</p>' : ''}
    ${r.sinModelo ? `<p class="aviso-chico">${r.sinModelo} selección(es) sin datos del modelo: no se puede estimar la probabilidad total.</p>` : ''}`;
}

function htmlBoleto() {
  const boleto = obtenerBoleto();
  if (!boleto.length) {
    return `<section class="tarjeta">
      <h2>Boleto</h2>
      <p class="suave">Vacío. Abre un partido, escribe sus cuotas y toca ＋ en las selecciones que quieras combinar. También puedes leer un cupón con una foto.</p>
    </section>`;
  }
  const r = resumenCombinada(boleto);
  const filas = boleto
    .map((s, i) => htmlSeleccion(s, `<button class="boton boton--secundario boton--mini" data-quitar="${i}" aria-label="Quitar">✕</button>`))
    .join('');
  return `<section class="tarjeta">
    <h2>Boleto (${boleto.length})</h2>
    ${filas}
    ${htmlResumen(r)}
    <div class="campo">
      <label for="importe">Importe (opcional)</label>
      <input id="importe" class="chico" type="text" inputmode="decimal" placeholder="Ej.: 5000">
      <span class="suave" id="ganancia"></span>
    </div>
    <div class="fila-botones">
      <button class="boton" id="guardar-combinada">Guardar combinada</button>
      <button class="boton boton--secundario" id="vaciar-boleto">Vaciar</button>
    </div>
  </section>`;
}

function htmlRendimiento() {
  const r = compararModeloYCasas(obtenerRegistros(), obtenerCombinadas());
  if (!r.partidos && !r.valor.apuestas && !r.combinadas.resueltas) {
    return `<section class="tarjeta">
      <h2>Modelo vs. casas</h2>
      <p class="suave">Aún no hay resultados. Guarda las cuotas de algunos partidos antes de que empiecen y vuelve cuando terminen.</p>
    </section>`;
  }

  let html = '<section class="tarjeta"><h2>Modelo vs. casas</h2>';
  if (r.partidos) {
    const ganaModelo = r.brierModelo < r.brierCasa;
    html += `
      <table class="tabla">
        <thead><tr><th>${r.partidos} partido(s) con 1X2</th><th>Modelo</th><th>Casas</th></tr></thead>
        <tbody>
          <tr><td>Acierta el favorito</td><td>${porcentaje(r.aciertosModelo / r.partidos)}<br><span class="suave">${r.aciertosModelo}/${r.partidos}</span></td><td>${porcentaje(r.aciertosCasa / r.partidos)}<br><span class="suave">${r.aciertosCasa}/${r.partidos}</span></td></tr>
          <tr><td>Error de probabilidad (Brier)</td><td>${r.brierModelo.toFixed(3).replace('.', ',')}</td><td>${r.brierCasa.toFixed(3).replace('.', ',')}</td></tr>
        </tbody>
      </table>
      <p class="suave">El error de Brier mide qué tan bien calibradas están las probabilidades (menor es mejor). Por ahora es mejor: <strong>${ganaModelo ? 'el modelo' : 'las casas'}</strong>.
      ${r.partidos < 30 ? 'Con menos de 30 partidos estas cifras dependen mucho del azar.' : ''}</p>`;
  }
  if (r.valor.apuestas) {
    html += `<h3 style="margin-top:1rem">Si hubieras apostado 1 unidad a cada selección con VALOR</h3>
      <p>${r.valor.apuestas} apuestas · ${r.valor.ganadas} ganadas · <strong class="${r.valor.unidades >= 0 ? 'positivo' : 'negativo'}">${unidades(r.valor.unidades)}</strong>
      (rentabilidad ${porcentaje(r.valor.unidades / r.valor.apuestas)})</p>`;
  }
  if (r.combinadas.resueltas) {
    const c = r.combinadas;
    html += `<h3 style="margin-top:1rem">Combinadas</h3>
      <p>${c.resueltas} resueltas · ${c.ganadas} ganadas · <strong class="${c.unidades >= 0 ? 'positivo' : 'negativo'}">${unidades(c.unidades)}</strong> (1 unidad cada una)
      ${c.importe ? `<br>Apostado ${dinero(c.importe)} · Cobrado ${dinero(c.retorno)} · Balance <strong class="${c.retorno - c.importe >= 0 ? 'positivo' : 'negativo'}">${dinero(c.retorno - c.importe)}</strong>` : ''}</p>`;
  }
  return html + '</section>';
}

function htmlCombinadas() {
  const combinadas = obtenerCombinadas().sort((a, b) => b.id - a.id);
  if (!combinadas.length) return '';
  const items = combinadas
    .map((c) => {
      const r = resumenCombinada(c.selecciones);
      const filas = c.selecciones
        .map((s, i) => {
          const manual =
            s.partidoId == null && s.estado === 'pendiente'
              ? `<button class="boton boton--secundario boton--mini" data-marcar="${c.id}:${i}:ganada" aria-label="Ganó">✓</button>
                 <button class="boton boton--secundario boton--mini" data-marcar="${c.id}:${i}:perdida" aria-label="Perdió">✗</button>`
              : `<span aria-label="${s.estado}">${ICONO[s.estado] || ''}</span>`;
          return htmlSeleccion(s, manual);
        })
        .join('');
      const importe = c.importe
        ? `<p class="suave">Importe ${dinero(c.importe)} · ${c.estado === 'ganada' ? `cobro ${dinero(c.importe * cuotaEfectiva(c.selecciones))}` : `cobro posible ${dinero(c.importe * r.cuotaTotal)}`}</p>`
        : '';
      return `<article class="tarjeta">
        <div class="historial-item__fila suave">
          <span>${escaparHtml(fechaHora(c.creadaEn))}${c.origen === 'cupon' ? ' · 📷 cupón' : ''}</span>
          ${ETIQUETA[c.estado] || ''}
        </div>
        ${filas}
        <p class="suave" style="margin:.5rem 0 0">Cuota ${fCuota(r.cuotaTotal)} · modelo ${r.probModelo == null ? '–' : porcentaje(r.probModelo)} · VE ${r.ve == null ? '–' : textoVE(r.ve)}${
          c.cuotaCupon && Math.abs(c.cuotaCupon - r.cuotaTotal) > 0.05 ? ` · cuota del cupón ${fCuota(c.cuotaCupon)}` : ''
        }</p>
        ${importe}
        ${c.selecciones.some((s) => s.partidoId == null && s.estado === 'pendiente') ? '<p class="aviso-chico">Marca a mano el resultado de los partidos sin datos de la API (✓ / ✗).</p>' : ''}
        <p style="margin:.5rem 0 0;text-align:right"><button class="boton boton--secundario boton--chico" data-eliminar="${c.id}">Eliminar</button></p>
      </article>`;
    })
    .join('');
  return `<h2 style="margin-top:1.25rem">Mis combinadas</h2>${items}`;
}

function htmlRegistros() {
  const proximos = obtenerRegistros()
    .filter((r) => r.estado === 'pendiente')
    .sort((a, b) => new Date(a.fecha) - new Date(b.fecha));
  if (!proximos.length) return '';
  const items = proximos
    .map((r) => {
      const conValor = r.mercados.filter((m) => m.pModelo != null && hayValor(m.pModelo, m.cuota)).length;
      return `<a class="tarjeta partido" href="#/partido/${r.liga}/${r.partidoId}">
        <div class="historial-item__fila">
          <strong>${escaparHtml(r.local)} vs ${escaparHtml(r.visita)}</strong>
          ${conValor ? `<span class="etiqueta etiqueta--valor">${conValor} con VALOR</span>` : ''}
        </div>
        <div class="suave">${nombreLiga(r.liga)} · ${escaparHtml(fechaHora(r.fecha))} · ${r.mercados.length} cuota(s)</div>
      </a>`;
    })
    .join('');
  return `<h2 style="margin-top:1.25rem">Cuotas registradas pendientes</h2>${items}`;
}

export async function vistaApuestas(contenedor, _params, sigueActiva) {
  function pintar() {
    contenedor.innerHTML = `
      <div class="estado-datos">
        <h2 style="margin:0">Apuestas</h2>
        <a class="boton boton--chico" href="#/cupon">📷 Leer cupón</a>
      </div>
      ${htmlBoleto()}
      ${htmlRendimiento()}
      ${htmlCombinadas()}
      ${htmlRegistros()}
      <p class="suave centrado">Los pronósticos son estimaciones estadísticas, no garantías. Apuesta con responsabilidad.</p>`;

    // Boleto
    contenedor.querySelectorAll('[data-quitar]').forEach((b) =>
      b.addEventListener('click', () => {
        quitarDelBoleto(Number(b.dataset.quitar));
        pintar();
      })
    );
    const importe = contenedor.querySelector('#importe');
    const leerImporte = () => Number(String(importe?.value || '').replace(/\./g, '').replace(',', '.')) || 0;
    importe?.addEventListener('input', () => {
      const r = resumenCombinada(obtenerBoleto());
      const imp = leerImporte();
      contenedor.querySelector('#ganancia').textContent = imp
        ? `Cobro si acierta: ${dinero(imp * r.cuotaTotal)}${r.ve != null ? ` · ganancia esperada según el modelo: ${dinero(imp * r.ve)}` : ''}`
        : '';
    });
    contenedor.querySelector('#guardar-combinada')?.addEventListener('click', () => {
      const boleto = obtenerBoleto();
      guardarCombinada(boleto, { importe: leerImporte(), origen: 'manual' });
      boleto.forEach(anadirCuotasPartido); // también cuentan para comparar modelo vs casas
      vaciarBoleto();
      notificar('Combinada guardada ✓');
      pintar();
    });
    contenedor.querySelector('#vaciar-boleto')?.addEventListener('click', () => {
      vaciarBoleto();
      pintar();
    });

    // Combinadas
    contenedor.querySelectorAll('[data-marcar]').forEach((b) =>
      b.addEventListener('click', () => {
        const [id, i, estado] = b.dataset.marcar.split(':');
        marcarSeleccion(Number(id), Number(i), estado);
        pintar();
      })
    );
    contenedor.querySelectorAll('[data-eliminar]').forEach((b) =>
      b.addEventListener('click', () => {
        if (!confirm('¿Eliminar esta combinada?')) return;
        eliminarCombinada(Number(b.dataset.eliminar));
        pintar();
      })
    );
  }

  pintar();

  // Busca resultados de partidos ya terminados (usa la caché siempre que puede)
  if (hayApuestasPorComprobar()) {
    const { actualizados, errores } = await actualizarApuestas();
    if (!sigueActiva()) return;
    if (actualizados) {
      pintar();
      notificar(`${actualizados} apuesta(s) actualizada(s).`);
    } else if (errores.length) {
      notificar(errores[0], 5000);
    }
  }
}
