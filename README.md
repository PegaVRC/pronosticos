# ⚽ Pronósticos

App web para estimar resultados de partidos de fútbol con un **modelo de Poisson**.
Está hecha con HTML, CSS y JavaScript puro, sin backend, y pensada para usarse desde el celular.

> ⚠️ **Los pronósticos son estimaciones estadísticas, no garantías.**

Ligas: **Premier League, LaLiga, Serie A y Champions League**. Los datos vienen de [football-data.org](https://www.football-data.org/).

## Qué hace

- **Próximos partidos** por liga, cada uno con su % de victoria local, empate y victoria visitante, el marcador más probable y la probabilidad de más de 2,5 goles.
- **Detalle del partido**: forma reciente (últimos 5 partidos), goles a favor y en contra, y una explicación sencilla de por qué el modelo da ese resultado.
- **Historial**: guarda tus pronósticos y, cuando el partido termina, marca si se acertó. También muestra el % de aciertos.
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
6. En el celular, abre esa dirección y usa **"Añadir a pantalla de inicio"** para tenerla como una app.

El archivo `.nojekyll` hace que GitHub Pages sirva los archivos tal cual, sin procesarlos.

## 3. Probar en tu computadora

Los módulos de JavaScript no funcionan abriendo `index.html` con doble clic (`file://`). Hace falta un servidor local:

```bash
python3 -m http.server 8000
# luego abre http://localhost:8000
```

Pruebas (opcionales, necesitan Node.js 18 o superior):

```bash
npm test        # pruebas del modelo, sin dependencias
npm run e2e     # prueba de la interfaz con una API simulada (requiere Playwright)
```

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

## Estructura del código

```
index.html            Esqueleto de la página, aviso fijo y navegación inferior
manifest.json         Datos para instalarla en el celular
css/styles.css        Estilos mobile-first, con modo claro y oscuro automático
js/config.js          Constantes: ligas, URL de la API, caché y parámetros del modelo
js/storage.js         Acceso seguro a localStorage (API key y ajustes)
js/cache.js           Caché con caducidad de las respuestas de la API
js/limitador.js       Máximo de 10 llamadas por minuto
js/api.js             Cliente de football-data.org (una llamada por liga)
js/modelo.js          Fuerzas de ataque y defensa, y Poisson
js/analisis.js        Forma reciente, resumen de goles y explicación en texto
js/historial.js       Pronósticos guardados y % de aciertos
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
- **Datos viejos**: toca **↻ Actualizar** en la lista de partidos, o **Vaciar caché** en Ajustes.

---

Datos proporcionados por [football-data.org](https://www.football-data.org/).
