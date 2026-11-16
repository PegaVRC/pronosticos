/**
 * Configuración general de la app.
 * Todo lo que se pueda ajustar sin tocar la lógica vive aquí.
 * IMPORTANTE: la API key NO va aquí; el usuario la escribe en Ajustes
 * y se guarda solo en el localStorage de su navegador.
 */

/** Versión de la app (igual que VERSION en sw.js); se muestra en Ajustes */
export const VERSION_APP = 'v6';

/** URL base de la API v4 de football-data.org */
export const API_BASE = 'https://api.football-data.org/v4';

/** Ligas disponibles (códigos del plan gratuito de football-data.org) */
export const LIGAS = [
  { codigo: 'PL', nombre: 'Premier League', corto: 'Premier' },
  { codigo: 'PD', nombre: 'LaLiga', corto: 'LaLiga' },
  { codigo: 'SA', nombre: 'Serie A', corto: 'Serie A' },
  { codigo: 'CL', nombre: 'Champions League', corto: 'Champions' },
];

/** Límite del plan gratuito: 10 llamadas por minuto */
export const LIMITE_LLAMADAS = 10;
export const VENTANA_LIMITE_MS = 60 * 1000;

/** Tiempo que una respuesta de la API se considera vigente en caché */
export const TTL_PARTIDOS_MS = 10 * 60 * 1000; // 10 minutos

/** Cuántos días hacia adelante mostrar en "Próximos partidos" */
export const DIAS_PROXIMOS = 10;

/* ---------- Parámetros del modelo ---------- */

/** Partidos recientes usados para medir la fuerza (por separado de local y de visita) */
export const PARTIDOS_FUERZA = 10;

/**
 * "Partidos ficticios" con el promedio de la liga que se suman a los datos reales.
 * Evitan valores extremos cuando un equipo ha jugado muy pocos partidos.
 */
export const PESO_PREVIO = 3;

/** Máximo de goles por equipo en la matriz de Poisson (0..MAX_GOLES) */
export const MAX_GOLES = 10;

/** Medias de respaldo si la liga aún no tiene partidos jugados */
export const MEDIA_LOCAL_DEFECTO = 1.5;
export const MEDIA_VISITA_DEFECTO = 1.2;

/** Partidos usados para la "forma reciente" */
export const PARTIDOS_FORMA = 5;
