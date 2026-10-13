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
import { sembrarMaquinasDemo, preciosEdredonDemo } from './lib/maquinasDemo.js';
import { sembrarProductosMarcaDemo } from './lib/productosDemo.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const BACKEND = path.resolve(__dirname, '..');
const SUCURSAL = 'pruebas';

// Slugs que existen de fábrica (migraciones + seed_pruebas). Todo lo que no
// esté aquí lo creó un visitante y se va.
const SUCURSALES_BASE = ['zapopan', 'retiro', 'pruebas'];

// --forzar: limpiar aunque haya notas fuera de la sucursal de pruebas (en la
// demo eso es contaminación de un visitante). Sin ella se aborta; el workflow
// nocturno no la pasa.
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

// Producción vive en Supabase: contra esa base nunca corre, con ninguna bandera.
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
  // La base debe tener todas las migraciones de este código antes de borrar
  // nada (solo corren al desplegar el backend de la demo); si no, la siembra
  // fallaría con la demo ya vacía.
  const enCodigo = fs.readdirSync(path.join(BACKEND, 'db', 'migrations'))
    .filter((f) => f.endsWith('.sql'));
  const { rows: aplicadas } = await db.query('SELECT name FROM schema_migrations');
  const yaAplicadas = new Set(aplicadas.map((r) => r.name));
  const pendientes = enCodigo.filter((f) => !yaAplicadas.has(f)).sort();
  if (pendientes.length > 0) {
    console.error(
      `ABORTADO: a la base de la demo le faltan ${pendientes.length} migración(es) ` +
      `(${pendientes[0]} … ${pendientes.at(-1)}). No se borró nada.\n` +
      'Despliega el backend de la demo, que las corre al publicar:\n' +
      '  cd backend && fly deploy -c fly.demo.toml --ha=false\n' +
      'y vuelve a lanzar este script (o el workflow "Restaurar la demo").'
    );
    process.exit(1);
  }

  // Notas fuera de la sucursal de pruebas = operación real.
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

  // La secuencia vive en scripts/lib/limpiarDemo.js para poder probarla.
  await limpiarOperacion(db);
  const usuariosBorrados = await borrarUsuariosDeVisitantes(db);
  await borrarCatalogos(db);
  // Máquinas de la demo (Speed Queen jumbo), antes que seed_pruebas.js.
  await sembrarMaquinasDemo(db, SUCURSAL);
  // Y los servicios de edredón con precio: sin él no se puede vender ninguno.
  await preciosEdredonDemo(db);
  // Productos de marca de exhibición.
  await sembrarProductosMarcaDemo(db, SUCURSAL);
  // Al final: las sucursales que un visitante creara solo se sueltan cuando ya
  // no les cuelga nada (usuarios, productos, máquinas e insumos).
  const { rowCount: sucursalesBorradas } = await db.query(
    'DELETE FROM sucursales WHERE slug <> ALL($1)', [SUCURSALES_BASE]
  );

  // Ajustes: se reponen desde la copia versionada (demo-ajustes-base.json).
  const base = JSON.parse(fs.readFileSync(path.join(__dirname, 'demo-ajustes-base.json'), 'utf8'));
  const columnas = Object.keys(base);

  // Avisa si una migración agregó columnas que el JSON no lista.
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

// Sin registro de siembra: se borró la operación entera.
const registro = path.join(__dirname, '.demo-ventas-ids.demo.json');
if (fs.existsSync(registro)) fs.unlinkSync(registro);

// Desde aquí un fallo deja la demo a medias: el mensaje pide relanzar.
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
