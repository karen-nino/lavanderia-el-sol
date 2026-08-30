// Versión de la app, tomada de package.json en tiempo de build (ver el `define`
// de vite.config.js). El fallback cubre entornos donde no se inyecta.
export const APP_VERSION =
  typeof __APP_VERSION__ === 'string' ? __APP_VERSION__ : 'dev';
