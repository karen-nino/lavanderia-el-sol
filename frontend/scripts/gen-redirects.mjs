// Genera public/_redirects antes de compilar.
//
// El proxy de /api y /uploads tiene que apuntar al backend del sitio que se
// está construyendo: el de producción o el de la demo. Con el archivo escrito
// a mano en el repo haría falta una rama paralela por sitio, y el día que se
// olvide rebasarla la demo acabaría pegando contra la base del negocio. Aquí
// el destino sale de API_ORIGIN, que cada sitio de Netlify define por su
// cuenta; sin la variable se construye la de producción, como siempre.
import { writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const PRODUCCION = 'https://lavanderia-el-sol-api.fly.dev';
const origen = (process.env.API_ORIGIN || PRODUCCION).replace(/\/$/, '');

// Si la variable viene mal escrita, mejor romper el build que publicar un
// sitio cuyo proxy no lleva a ninguna parte.
if (!/^https:\/\/[\w.-]+$/.test(origen)) {
  console.error(`API_ORIGIN no parece una URL válida: ${origen}`);
  process.exit(1);
}

// El orden importa: el catch-all del SPA tiene que ir al final, o se traga
// las rutas del proxy.
const contenido = `# GENERADO por scripts/gen-redirects.mjs — no editar a mano.
# El backend sale de API_ORIGIN (sin la variable, el de producción).

# Proxy al backend (debe ir ANTES del catch-all de abajo).
/api/*       ${origen}/api/:splat       200
/uploads/*   ${origen}/uploads/:splat   200

# React Router (BrowserRouter): el resto sirve index.html.
/*           /index.html   200
`;

const destino = resolve(dirname(fileURLToPath(import.meta.url)), '../public/_redirects');
writeFileSync(destino, contenido);
console.log(`_redirects → ${origen}`);
