// Devuelve la DEMO PÚBLICA a su estado de exhibición.
//
//   node scripts/reset-demo.mjs [--forzar]
//
// Quien entra a la demo entra como administrador y puede borrar el inventario,
// cancelar notas o poner cualquier cosa en el nombre del negocio. Esto deshace
// todo eso: borra la operación que dejaron los visitantes y vuelve a sembrar
// los 90 días de notas, cortes e inventario cuadrado.
//
// Lo corre a diario .github/workflows/reset-demo.yml, y se puede lanzar a mano.
//
// La conexión sale de backend/.env.demo, igual que el seeder: nunca del .env
// normal. Además comprueba, ya conectado, que la base no tenga operación real.
import pg from 'pg';
import fs from 'fs';
import path from 'path';
import { execFileSync } from 'child_process';
import { fileURLToPath } from 'url';
import dotenv from 'dotenv';
import { limpiarOperacion, borrarUsuariosDeVisitantes, borrarCatalogos } from './lib/limpiarDemo.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const BACKEND = path.resolve(__dirname, '..');
const SUCURSAL = 'pruebas';

// Slugs que existen de fábrica (migraciones + seed_pruebas). Todo lo que no
// esté aquí lo creó un visitante y se va.
const SUCURSALES_BASE = ['lopez_cotilla', 'retiro', 'pruebas'];

// --forzar: limpiar aunque la base tenga notas FUERA de la sucursal de pruebas.
// Sin la bandera eso aborta, porque es la señal de "esta base tiene operación
// real". En la base de la demo no puede haberla de forma legítima, así que si
// aparece es contaminación —un usuario dado de alta por un visitante que acabó
// operando en una sucursal real— y hay que poder barrerla sin entrar a la base
// a mano. El workflow nocturno NO pasa la bandera: se queda en el camino seguro.
const FORZAR = process.argv.includes('--forzar');

const archivoEnv = path.join(BACKEND, '.env.demo');
if (!fs.existsSync(archivoEnv)) {
  console.error('ABORTADO: falta backend/.env.demo con la DATABASE_URL de la demo.');
  process.exit(1);
}
dotenv.config({ path: archivoEnv, override: true });
if (!process.env.DATABASE_URL) {
  console.error('ABORTADO: backend/.env.demo no define DATABASE_URL.');
  process.exit(1);
}

// Red de seguridad que no depende de lo que haya dentro de la base: producción
// vive en Supabase, y este script borra la operación entera. Ninguna bandera
// levanta este candado.
if (/supabase/i.test(process.env.DATABASE_URL)) {
  console.error('ABORTADO: la DATABASE_URL de .env.demo apunta a Supabase, que es producción.');
  process.exit(1);
}

const db = new pg.Client({
  connectionString: process.env.DATABASE_URL,
  ssl: { rejectUnauthorized: true },
});

const seed = (script, args = []) =>
  execFileSync('node', [script, ...args], { cwd: BACKEND, stdio: 'inherit' });

await db.connect();
try {
  // Mismo criterio que el resto: notas fuera de la sucursal de pruebas = base
  // con operación real. Aquí importa el doble, porque esto borra a conciencia.
  const { rows: reales } = await db.query(
    'SELECT COUNT(*)::int AS n FROM notas WHERE sucursal <> $1', [SUCURSAL]
  );
  if (reales[0].n > 0) {
    if (!FORZAR) {
      console.error(
        `ABORTADO: la base tiene ${reales[0].n} nota(s) fuera de "${SUCURSAL}".\n` +
        'Si es la base de la demo, eso es contaminación y se barre con --forzar.\n' +
        'Si no lo es, revisa a dónde apunta backend/.env.demo antes de nada.'
      );
      process.exit(1);
    }
    console.warn(`--forzar: se borrarán también ${reales[0].n} nota(s) fuera de "${SUCURSAL}".`);
  }

  await db.query('BEGIN');

  // La secuencia vive en scripts/lib/limpiarDemo.js: es lo único de aquí que
  // las pruebas de integración pueden ejecutar tal cual contra una base real.
  await limpiarOperacion(db);
  const usuariosBorrados = await borrarUsuariosDeVisitantes(db);
  await borrarCatalogos(db);
  // Al final: las sucursales que un visitante creara solo se sueltan cuando ya
  // no les cuelga nada (usuarios, productos, máquinas e insumos).
  const { rowCount: sucursalesBorradas } = await db.query(
    'DELETE FROM sucursales WHERE slug <> ALL($1)', [SUCURSALES_BASE]
  );

  // Ajustes: son globales y en la demo cualquiera puede escribirlos, así que se
  // reponen desde la copia versionada del estado de exhibición.
  const base = JSON.parse(fs.readFileSync(path.join(__dirname, 'demo-ajustes-base.json'), 'utf8'));
  const columnas = Object.keys(base);

  // El JSON lista las columnas a mano: cuando una migración añada una nueva,
  // esto avisa en vez de dejar de restaurarla en silencio.
  const { rows: cols } = await db.query(
    `SELECT column_name FROM information_schema.columns
      WHERE table_name = 'ajustes' AND column_name <> 'id'`
  );
  const faltan = cols.map((c) => c.column_name).filter((c) => !columnas.includes(c));
  if (faltan.length > 0) {
    console.warn(`AVISO: demo-ajustes-base.json no cubre ${faltan.join(', ')}; ` +
                 'esas columnas se quedan como las dejó el último visitante.');
  }

  await db.query(
    `UPDATE ajustes SET ${columnas.map((c, i) => `${c} = $${i + 1}`).join(', ')} WHERE id = 1`,
    columnas.map((c) => base[c])
  );

  // El nombre visible de la sucursal vive aparte de los ajustes.
  await db.query(
    `UPDATE sucursales SET nombre = 'Sucursal Centro', activa = TRUE WHERE slug = $1`, [SUCURSAL]
  );

  await db.query('COMMIT');
  console.log(`Limpieza: ${usuariosBorrados} usuario(s) y ${sucursalesBorradas} sucursal(es) ` +
              'de visitantes; notas, caja, clientes, inventario y máquinas a cero.');
} catch (e) {
  await db.query('ROLLBACK').catch(() => {});
  console.error('Falló la limpieza:', e.message);
  process.exit(1);
} finally {
  await db.end();
}

// El registro de lo sembrado sobra: acaba de borrarse la operación entera, no
// unos ids sueltos. Si se quedara, el seeder creería que ya hay una siembra viva.
const registro = path.join(__dirname, '.demo-ventas-ids.demo.json');
if (fs.existsSync(registro)) fs.unlinkSync(registro);

// La limpieza ya está confirmada en la base, así que a partir de aquí un fallo
// deja la demo a medio montar. Conviene que se lea como lo que es —y no como un
// error suelto de un script— para que quien lo vea sepa que hay que relanzar.
try {
  // Repone usuarios, máquinas, productos y el stock de granel; es idempotente.
  seed('db/seed_pruebas.js', [process.env.DEMO_PASSWORD || 'Demo1234']);
  seed('scripts/seed-demo-ventas.mjs', ['--demo']);
  seed('scripts/seed-demo-ventas.mjs', ['--demo', '--cuadrar']);
} catch {
  console.error('\nLA DEMO QUEDÓ VACÍA: se borró lo viejo pero falló al sembrar.\n' +
                'Revisa el error de arriba y vuelve a lanzar este script.');
  process.exit(1);
}

console.log('\nDemo restaurada.');
