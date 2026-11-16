/**
 * Tarjeta "Cuotas" dentro del detalle del partido.
 * Ingresas las cuotas (1X2 y, si quieres, más/menos 2,5 y ambos marcan) y se
 * comparan al momento con el modelo: probabilidad implícita, del modelo,
 * valor esperado y etiqueta VALOR. Cada fila se puede añadir al boleto.
 */

import { probSeleccion, textoSeleccion, claveSeleccion } from '../mercados.js';
import { leerCuota, analizar1X2, hayValor, valorEsperado, probImplicita } from '../cuotas.js';
import { obtenerRegistro, guardarCuotasPartido, anadirAlBoleto, obtenerBoleto } from '../apuestas.js';
import { porcentaje, cuota as formatoCuota } from '../formato.js';
import { escaparHtml, notificar } from '../ui.js';

/** VE con signo: "+12 %" / "−5 %" */
export const textoVE = (ve) => `${ve >= 0 ? '+' : '−'}${Math.round(Math.abs(ve) * 100)}\u00a0%`;

/** Campos del formulario. */
function campos(local, visita) {
  return [
    { id: 'c-1', grupo: '1X2', etiqueta: `1 · ${local}`, sel: { mercado: '1X2', seleccion: '1' } },
    { id: 'c-X', grupo: '1X2', etiqueta: 'X · Empate', sel: { mercado: '1X2', seleccion: 'X' } },
    { id: 'c-2', grupo: '1X2', etiqueta: `2 · ${visita}`, sel: { mercado: '1X2', seleccion: '2' } },
    { id: 'c-mas', grupo: 'Goles', etiqueta: 'Más de 2,5', sel: { mercado: 'GOLES', seleccion: 'mas', linea: 2.5 } },
    { id: 'c-menos', grupo: 'Goles', etiqueta: 'Menos de 2,5', sel: { mercado: 'GOLES', seleccion: 'menos', linea: 2.5 } },
    { id: 'c-si', grupo: 'Ambos', etiqueta: 'Ambos marcan: Sí', sel: { mercado: 'AMBOS', seleccion: 'si' } },
    { id: 'c-no', grupo: 'Ambos', etiqueta: 'Ambos marcan: No', sel: { mercado: 'AMBOS', seleccion: 'no' } },
  ];
}

/**
 * @param {HTMLElement} tarjeta  Contenedor <section>
 * @param {{liga:string, partido:object, pron:object, editable:boolean}} ctx
 */
export function montarCuotas(tarjeta, { liga, partido, pron, editable }) {
  const { local, visita } = partido;
  const lista = campos(local.nombre, visita.nombre);
  const registro = obtenerRegistro(partido.id);
  const previas = new Map((registro?.mercados || []).map((m) => [claveSeleccion(m), m]));

  // Cuotas registradas (p. ej. desde un cupón) que no tienen campo propio
  const extras = (registro?.mercados || []).filter((m) => !lista.some((c) => claveSeleccion(c.sel) === claveSeleccion(m)));

  const input = (c) => {
    const previa = previas.get(claveSeleccion(c.sel));
    return `<label class="campo-cuota">
      <span>${escaparHtml(c.etiqueta)}</span>
      <input id="${c.id}" type="text" inputmode="decimal" placeholder="—" autocomplete="off"
             value="${previa ? String(previa.cuota).replace('.', ',') : ''}" ${editable ? '' : 'disabled'}>
    </label>`;
  };

  tarjeta.innerHTML = `
    <h2>Cuotas</h2>
    ${
      editable
        ? '<p class="suave">Escribe las cuotas de tu casa de apuestas (formato decimal, p. ej. 1,85). Se comparan con el modelo al momento.</p>'
        : '<p class="suave">El partido ya empezó: las cuotas no se pueden cambiar.</p>'
    }
    <div class="grid-cuotas grid-cuotas--3">${lista.filter((c) => c.grupo === '1X2').map(input).join('')}</div>
    <div class="grid-cuotas">${lista.filter((c) => c.grupo !== '1X2').map(input).join('')}</div>
    <div id="tabla-cuotas"></div>
    ${
      editable
        ? `<div class="fila-botones" style="margin-top:.75rem">
             <button class="boton" id="guardar-cuotas">Guardar cuotas</button>
             <a class="boton boton--secundario" href="#/apuestas">Ver boleto (<span id="n-boleto">${obtenerBoleto().length}</span>)</a>
           </div>`
        : ''
    }`;

  /** Selecciones con cuota válida según lo escrito ahora mismo. */
  function leerFormulario() {
    const filas = [];
    for (const c of lista) {
      const cuota = leerCuota(tarjeta.querySelector(`#${c.id}`).value);
      if (cuota) filas.push({ ...c.sel, cuota });
    }
    return filas;
  }

  /** Selección completa para el boleto. */
  const paraBoleto = (fila) => ({
    partidoId: partido.id,
    liga,
    fecha: partido.fecha,
    local: local.nombre,
    visita: visita.nombre,
    mercado: fila.mercado,
    seleccion: fila.seleccion,
    linea: fila.linea,
    cuota: fila.cuota,
    lambdas: { local: pron.lambdaLocal, visita: pron.lambdaVisita },
    prob1X2: { 1: pron.pLocal, X: pron.pEmpate, 2: pron.pVisita },
    pModelo: probSeleccion(fila, pron.lambdaLocal, pron.lambdaVisita),
  });

  function pintarTabla() {
    const filas = [...leerFormulario(), ...extras];
    const destino = tarjeta.querySelector('#tabla-cuotas');
    if (!filas.length) {
      destino.innerHTML = '';
      return;
    }

    const c1x2 = {};
    for (const f of filas) if (f.mercado === '1X2') c1x2[f.seleccion] = f.cuota;
    const margen =
      c1x2['1'] && c1x2.X && c1x2['2']
        ? `<p class="suave">Margen de la casa en el 1X2: <strong>${porcentaje(analizar1X2(c1x2).margen)}</strong> (lo que cobra la casa; cuanto menor, mejor para ti).</p>`
        : '';

    const html = filas
      .map((f, i) => {
        const p = probSeleccion(f, pron.lambdaLocal, pron.lambdaVisita);
        const valor = hayValor(p, f.cuota);
        const ve = valorEsperado(p, f.cuota);
        return `<div class="seleccion">
          <div class="seleccion__texto">
            <div><strong>${escaparHtml(textoSeleccion(f, local.nombre, visita.nombre))}</strong>
              ${valor ? '<span class="etiqueta etiqueta--valor">VALOR</span>' : ''}</div>
            <div class="seleccion__partido">
              Casa ${porcentaje(probImplicita(f.cuota))} · Modelo <strong>${porcentaje(p)}</strong> ·
              VE <span class="${ve >= 0 ? 'positivo' : 'negativo'}">${textoVE(ve)}</span>
            </div>
          </div>
          <div class="seleccion__lado">
            <strong>${formatoCuota(f.cuota)}</strong>
            ${editable ? `<button class="boton boton--secundario boton--mini" data-fila="${i}" aria-label="Añadir al boleto">＋</button>` : ''}
          </div>
        </div>`;
      })
      .join('');

    destino.innerHTML = `
      <div class="lista-cuotas">${html}</div>
      <p class="suave"><strong>Casa</strong> = probabilidad implícita (1 ÷ cuota). <strong>VALOR</strong> = el modelo ve más probable la selección que la casa. <strong>VE</strong> = ganancia media esperada por cada unidad apostada, según el modelo.</p>
      ${margen}`;

    destino.querySelectorAll('[data-fila]').forEach((b) =>
      b.addEventListener('click', () => {
        const r = anadirAlBoleto(paraBoleto(filas[Number(b.dataset.fila)]));
        notificar(r === 'añadida' ? 'Añadida al boleto ✓' : 'Cuota actualizada en el boleto ✓');
        const n = tarjeta.querySelector('#n-boleto');
        if (n) n.textContent = obtenerBoleto().length;
      })
    );
  }

  tarjeta.querySelectorAll('input').forEach((i) => i.addEventListener('input', pintarTabla));

  tarjeta.querySelector('#guardar-cuotas')?.addEventListener('click', () => {
    // Mal escritas: avisar en vez de ignorarlas en silencio
    const malas = lista.filter((c) => {
      const v = tarjeta.querySelector(`#${c.id}`).value.trim();
      return v && !leerCuota(v);
    });
    if (malas.length) {
      notificar(`Cuota no válida en "${malas[0].etiqueta}". Usa números como 1,85.`, 4000);
      return;
    }
    const filas = [...leerFormulario(), ...extras.map(({ pModelo, ...m }) => m)];
    if (!filas.length) {
      notificar('Escribe al menos una cuota.');
      return;
    }
    guardarCuotasPartido(liga, partido, pron, filas);
    notificar('Cuotas guardadas ✓ Se usarán para comparar el modelo con las casas.');
  });

  pintarTabla();
}
