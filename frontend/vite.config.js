import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import { readFileSync } from 'node:fs'

// La versión de la app sale de package.json y se inyecta en el bundle para
// poder mostrarla en la pantalla de login (ver src/lib/version.js).
const { version } = JSON.parse(readFileSync(new URL('./package.json', import.meta.url), 'utf8'))

// La versión publicada también se deja en un archivo suelto (/version.json) para
// que la app instalada en un teléfono pueda preguntar si ya hay otra sin tener
// que recargarse primero (ver src/lib/actualizacion.js). En desarrollo no hay
// build, así que el mismo dato se sirve desde el servidor de Vite.
const versionJson = () => ({
  name: 'version-json',
  configureServer(server) {
    server.middlewares.use('/version.json', (_req, res) => {
      res.setHeader('Content-Type', 'application/json');
      res.end(JSON.stringify({ version }));
    });
  },
  generateBundle() {
    this.emitFile({
      type: 'asset',
      fileName: 'version.json',
      source: JSON.stringify({ version }),
    });
  },
});

// https://vite.dev/config/
export default defineConfig({
  plugins: [react(), versionJson()],
  define: {
    __APP_VERSION__: JSON.stringify(version),
  },
  server: {
    proxy: {
      // API_ORIGIN permite levantar el front contra otro backend (p. ej. el de
      // la demo en otro puerto) sin tocar este archivo. La misma variable
      // decide el destino del proxy en el build (scripts/gen-redirects.mjs).
      '/api': {
        target: process.env.API_ORIGIN || 'http://localhost:4000',
        changeOrigin: true,
      },
    },
  },
  test: {
    // jsdom para que localStorage/DOM existan (helpers de lib y pruebas de
    // componentes). Los archivos *.test.js viven junto al código.
    environment: 'jsdom',
    include: ['src/**/*.test.{js,jsx}'],
    setupFiles: ['./src/test/setup.js'],
  },
})
