# ⚽ Pronósticos

App web para estimar resultados de partidos de fútbol con un **modelo de Poisson**.
Está hecha con HTML, CSS y JavaScript puro, sin backend, y pensada para usarse desde el celular.

> ⚠️ **Los pronósticos son estimaciones estadísticas, no garantías.** Si apuestas, hazlo con responsabilidad.

Ligas: **Premier League, LaLiga, Serie A y Champions League**. Los datos vienen de [football-data.org](https://www.football-data.org/).

## Qué hace

- **Próximos partidos** por liga, cada uno con su % de victoria local, empate y victoria visitante, el marcador más probable y la probabilidad de más de 2,5 goles.
- **Detalle del partido**: forma reciente (últimos 5 partidos), goles a favor y en contra, y una explicación sencilla de por qué el modelo da ese resultado.
- **Historial**: guarda tus pronósticos y, cuando el partido termina, marca si se acertó. También muestra el % de aciertos.
- **Cuotas** (ingreso manual): escribes las cuotas de tu casa de apuestas y la app las compara con el modelo. Muestra la probabilidad implícita, el valor esperado y la etiqueta **VALOR**.
- **Combinadas**: arma un boleto y ve la cuota total, la probabilidad estimada de acertarla y su valor esperado.
- **Modelo vs. casas**: con el tiempo, mide si el modelo acierta más que las cuotas.
- **Lectura de cupones por foto** (OCR en el navegador): sube o comparte una captura del cupón de cualquier casa de apuestas.
- **App instalable (PWA)**: funciona sin conexión y, en Android, aparece en el menú **Compartir** de la galería.
- **Caché** de 10 minutos y un limitador que nunca pasa de **10 llamadas por minuto** (el límite del plan gratuito).

## 1. Conseguir la API key (gratis)

1. Entra en <https://www.football-data.org/client/register> y crea una cuenta con el plan **Free**.
2. La API key te llega por correo (también la ves en tu panel de football-data.org).
3. Abre la app, ve a **Ajustes**, pega la key y toca **Guardar**. Con **Probar conexión** puedes comprobar que funciona.

La key se guarda **solo en el localStorage de tu navegador**. No aparece en el código ni se sube a GitHub. Si usas la app en otro dispositivo, tendrás que escribirla de nuevo allí.

## 2. Publicar en GitHub Pages

1. Sube este repositorio a GitHub (ya lo está si estás leyendo esto ahí).
2. En el repositorio entra en **Settings → Pages**.
3. En **Build and deployment → Source** elige **Deploy from a branch**.
4. En **Branch**, elige la rama (por ejemplo `main`) y la carpeta **`/ (root)`**, y luego **Save**.
5. Espera uno o dos minutos. La app quedará en `https://TU-USUARIO.github.io/pronosticos/`.
6. En el celular, abre esa dirección e **instala la app**:
   - **Android (Chrome)**: menú ⋮ → **Instalar app** (o "Añadir a pantalla de inicio").
   - **iPhone (Safari)**: botón Compartir → **Añadir a pantalla de inicio**.

> GitHub Pages usa HTTPS, que es obligatorio para instalar la app y para el service worker.

### Enviar capturas desde la galería (Android)

Con la app **instalada**, abre una captura de tu cupón en la galería y toca **Compartir → Pronósticos**. La app se abre directamente en "Leer cupón" con la imagen cargada.
Esto usa la función *Web Share Target*, que funciona en Android con Chrome. En iPhone no existe: allí usa **Leer cupón → Elegir imagen**.

Si cambias archivos de la app, sube el número de `VERSION` en `sw.js` para que los teléfonos que ya la instalaron descarguen la versión nueva.

El archivo `.nojekyll` hace que GitHub Pages sirva los archivos tal cual, sin procesarlos.

## 3. Probar en tu computadora

Los módulos de JavaScript no funcionan abriendo `index.html` con doble clic (`file://`). Hace falta un servidor local:

```bash
python3 -m http.server 8000
# luego abre http://localhost:8000
```

Pruebas (opcionales, necesitan Node.js 18 o superior):

```bash
npm test        # pruebas del modelo, cuotas, lector de cupones y PWA (sin dependencias)
npm run e2e     # prueba de la interfaz con una API simulada (requiere Playwright)
```

La prueba de interfaz también puede leer un cupón con OCR real si le indicas una carpeta con Tesseract.js descargado de npm (`TESS_LOCAL=carpeta npm run e2e`). Mira `tests/e2e.mjs` para ver qué estructura de carpetas espera.

## Cómo funciona el modelo

1. **Medias de la liga**: cuántos goles marca, de media, el equipo local y cuántos el visitante.
2. **Fuerzas** de cada equipo, con sus **últimos 10 partidos como local** y sus **últimos 10 como visitante**, por separado:
   - *Ataque* = goles que marca ÷ goles que marca un equipo medio.
   - *Defensa* = goles que recibe ÷ goles que recibe un equipo medio.
   - 1,0 es un equipo medio; 1,3 está un 30 % por encima.
   - Se suman 3 partidos "ficticios" con la media de la liga, para que un equipo con pocos partidos no dé valores extremos.
3. **Goles esperados**:
   - Local = ataque del local en casa × defensa del visitante fuera × media de goles locales.
   - Visitante = ataque del visitante fuera × defensa del local en casa × media de goles visitantes.
4. **Poisson**: con esos goles esperados se calcula la probabilidad de cada marcador (de 0-0 a 10-10). Sumando marcadores salen el 1X2, el marcador más probable y la probabilidad de más de 2,5 goles.

Solo se usan partidos **anteriores** a la fecha del encuentro y de la **misma competición**. Los partidos con prórroga cuentan con el resultado a los 90 minutos.

**Acierto en el historial**: el pronóstico acierta si el resultado a los 90' (1, X o 2) coincide con el que el modelo daba como más probable. Además se muestran los aciertos de marcador exacto y de más/menos de 2,5 goles. Solo se pueden guardar pronósticos de partidos que aún no empezaron.

**Limitaciones**: el modelo no tiene en cuenta lesiones, alineaciones, rotaciones ni la motivación de los equipos. Al principio de la temporada, y en la Champions, hay pocos partidos de referencia; la app lo indica con la etiqueta *"Pocos datos"*.

## Módulo de cuotas

En el detalle de un partido (antes de que empiece) puedes escribir las cuotas de **1, X y 2**. Si quieres, también las de **más/menos 2,5 goles** y **ambos marcan**. Se aceptan con coma o punto (1,85 o 1.85).

| Concepto | Cómo se calcula |
|---|---|
| Probabilidad implícita | 1 ÷ cuota (cuota 2,00 → 50 %) |
| Margen de la casa | suma de las implícitas del 1X2 − 100 % |
| **VALOR** | la probabilidad del modelo es mayor que la implícita |
| Valor esperado (VE) | probabilidad del modelo × cuota − 1 (ganancia media por unidad apostada) |

**Combinadas**: toca **＋** en las selecciones que quieras y ve a la pestaña **Apuestas**. Ahí verás:
- la cuota total (el producto de las cuotas);
- la probabilidad estimada por el modelo: se multiplican los partidos distintos. Si eliges dos selecciones del *mismo* partido (por ejemplo, "gana local" y "más de 2,5"), la probabilidad conjunta se calcula exacta sobre la matriz de Poisson;
- el valor esperado.

**Modelo vs. casas**: cuando terminan los partidos con cuotas guardadas, la app compara:
- el % de veces que acierta el favorito del modelo frente al de la casa (la cuota más baja);
- el **error de Brier**, que mide qué tan bien calibradas están las probabilidades (menor es mejor);
- cuánto habrías ganado o perdido apostando 1 unidad a cada selección con VALOR y a cada combinada.

Con pocos partidos estas cifras dependen mucho del azar: mira la tendencia después de 30 o más.

## Lectura de cupones (OCR)

En **Apuestas → 📷 Leer cupón** puedes elegir una captura, tomar una foto o compartirla desde la galería.

1. **Tesseract.js** (OCR en español) lee el texto en tu teléfono. La imagen **no se sube a ningún servidor**. La librería (~4 MB) se descarga la primera vez y después queda guardada.
2. Antes de leer, la imagen se agranda, se pasa a escala de grises y se le sube el contraste. Si la captura está en **modo oscuro**, se invierte.
3. El texto se analiza con **patrones generales**, no con el diseño de una casa concreta (Betano, Coolbet, Jugabet, Betsson…):
   - partidos escritos como `A vs B`, `A - B`, `A v B`, `A x B`, o en dos líneas seguidas si coinciden con un partido de la API;
   - cuotas decimales (`1.85` o `1,85`). No se confunden con horas, fechas ni líneas de goles;
   - mercados: 1X2 o resultado final, doble oportunidad, más/menos goles y ambos marcan;
   - cuota total e importe.
4. Los equipos se **emparejan con los partidos de la API** aunque los nombres no coincidan exactamente ("Man Utd" ↔ "Manchester United FC", "Atleti" ↔ "Atlético de Madrid", pequeños errores del OCR…).
5. Todo aparece en un **formulario editable**. Lo que no se reconoce queda vacío y marcado en amarillo. Si el partido no está en la API (otra liga), elige **"Otro partido"**: entra en la combinada sin estimación del modelo, y su resultado lo marcas tú (✓ / ✗).

**Consejos**: usa capturas de pantalla en lugar de fotos de la pantalla, recorta lo que no sea el cupón y revisa siempre las cuotas antes de guardar.

## Estructura del código

```
index.html            Esqueleto de la página, aviso fijo y navegación inferior
manifest.json         PWA: íconos, modo app y destino de "Compartir" (share_target)
sw.js                 Service worker: caché sin conexión y recepción de imágenes compartidas
icons/                Íconos de la app (SVG y PNG)
css/styles.css        Estilos mobile-first, con modo claro y oscuro automático
js/config.js          Constantes: ligas, URL de la API, caché y parámetros del modelo
js/storage.js         Acceso seguro a localStorage (API key y ajustes)
js/cache.js           Caché con caducidad de las respuestas de la API
js/limitador.js       Máximo de 10 llamadas por minuto
js/api.js             Cliente de football-data.org (una llamada por liga)
js/modelo.js          Fuerzas de ataque y defensa, y Poisson
js/analisis.js        Forma reciente, resumen de goles y explicación en texto
js/historial.js       Pronósticos guardados y % de aciertos
js/mercados.js        Mercados (1X2, doble oportunidad, goles, ambos marcan) y su probabilidad
js/cuotas.js          Probabilidad implícita, valor, combinadas y comparación modelo vs. casas
js/apuestas.js        Cuotas guardadas, boleto y combinadas
js/resultados.js      Búsqueda de resultados de partidos terminados
js/emparejar.js       Comparación tolerante de nombres de equipos
js/cupon.js           Lectura del texto de un cupón (patrones generales)
js/ocr.js             Tesseract.js y preparación de la imagen
js/formato.js         Números y fechas en español
js/ui.js              Utilidades de interfaz
js/app.js             Router (#/partidos, #/partido/…, #/historial, #/config)
js/vistas/*.js        Una pantalla por archivo
tests/                Pruebas del modelo y de la interfaz
```

**Consumo de la API**: cada liga se descarga en una sola llamada (`/v4/competitions/{código}/matches`), con la temporada entera. De ahí salen los próximos partidos, las fuerzas, la forma y los resultados del historial. Así, recorrer las 4 ligas cuesta 4 llamadas cada 10 minutos como mucho.

## Problemas frecuentes

- **"La API rechazó la petición"**: la key está mal copiada o tu plan no incluye esa competición. Las 4 ligas de la app están en el plan gratuito.
- **"No se pudo conectar con la API"**: puede ser un fallo de conexión o un bloqueo **CORS** del navegador. Si te pasa siempre, en **Ajustes → Opciones avanzadas** puedes poner un **proxy propio**. La app le añade al final la URL de la API, codificada. Por ejemplo, un Cloudflare Worker gratuito:

  ```js
  // Cloudflare Worker: reenvía la petición a football-data.org y añade CORS
  export default {
    async fetch(request) {
      const cors = {
        'Access-Control-Allow-Origin': '*',
        'Access-Control-Allow-Headers': 'X-Auth-Token',
      };
      if (request.method === 'OPTIONS') return new Response(null, { headers: cors });
      const destino = new URL(request.url).searchParams.get('url') || '';
      if (!destino.startsWith('https://api.football-data.org/')) {
        return new Response('URL no permitida', { status: 400 });
      }
      const r = await fetch(destino, {
        headers: { 'X-Auth-Token': request.headers.get('X-Auth-Token') || '' },
      });
      return new Response(r.body, {
        status: r.status,
        headers: { ...cors, 'Content-Type': 'application/json' },
      });
    },
  };
  ```

  Después, en Ajustes escribe como proxy `https://TU-WORKER.workers.dev/?url=`. No uses proxies públicos de terceros: verían tu API key.
- **El OCR lee mal el cupón**: prueba con una captura de pantalla nítida y recortada. Siempre puedes corregir los campos a mano antes de guardar.
- **No aparece "Pronósticos" al compartir**: la app tiene que estar **instalada** desde Chrome en Android. Después de instalarla, puede tardar un poco en aparecer en el menú.
- **Datos viejos**: toca **↻ Actualizar** en la lista de partidos, o **Vaciar caché** en Ajustes.

---

Datos proporcionados por [football-data.org](https://www.football-data.org/).
