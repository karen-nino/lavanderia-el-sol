// Devuelve la DEMO PÚBLICA a su estado de exhibición.
//
//   node scripts/reset-demo.mjs
//
// Quien entra a la demo entra como administrador y puede borrar el inventario,
// cancelar notas o poner cualquier cosa en el nombre del negocio. Esto deshace
// todo eso: limpia lo que hayan dejado los visitantes y vuelve a sembrar los
// 90 días de notas, cortes e inventario cuadrado.
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

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const BACKEND = path.resolve(__dirname, '..');
const SUCURSAL = 'pruebas';

// Slugs y usuarios que existen de fábrica (migraciones + seed_pruebas). Todo lo
// que no esté aquí lo creó un visitante y se va.
const SUCURSALES_BASE = ['lopez_cotilla', 'retiro', 'pruebas'];

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
    console.error(`ABORTADO: la base tiene ${reales[0].n} notas fuera de "${SUCURSAL}".`);
    process.exit(1);
  }

  await db.query('BEGIN');

  // Orden: primero lo que apunta a las notas, luego las notas.
  await db.query('DELETE FROM producto_movimientos WHERE sucursal = $1', [SUCURSAL]);
  await db.query('DELETE FROM notas WHERE sucursal = $1', [SUCURSAL]);
  await db.query('DELETE FROM cajas WHERE sucursal = $1', [SUCURSAL]);
  await db.query('DELETE FROM clientes WHERE sucursal = $1', [SUCURSAL]);
  await db.query('DELETE FROM notificaciones WHERE sucursal = $1', [SUCURSAL]);
  await db.query(
    'DELETE FROM checkins WHERE usuario_id IN (SELECT id FROM usuarios WHERE es_prueba = TRUE)'
  );

  // Altas que haya hecho un visitante desde Empleados y Sucursales.
  const { rowCount: usuariosBorrados } = await db.query(
    `DELETE FROM usuarios WHERE es_prueba = FALSE AND rol <> 'admin_main'`
  );
  const { rowCount: sucursalesBorradas } = await db.query(
    'DELETE FROM sucursales WHERE slug <> ALL($1)', [SUCURSALES_BASE]
  );

  // Máquinas: si alguien dejó un ciclo corriendo, vuelven a estar libres.
  await db.query(
    `UPDATE maquinas SET estado = 'disponible', en_uso_desde = NULL WHERE sucursal = $1`,
    [SUCURSAL]
  );

  // Ajustes: son globales y en la demo cualquiera puede escribirlos, así que se
  // reponen desde la copia versionada del estado de exhibición.
  const base = JSON.parse(fs.readFileSync(path.join(__dirname, 'demo-ajustes-base.json'), 'utf8'));
  const columnas = Object.keys(base);
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
              'de visitantes; notas, caja, clientes e inventario a cero.');
} catch (e) {
  await db.query('ROLLBACK').catch(() => {});
  console.error('Falló la limpieza:', e.message);
  process.exit(1);
} finally {
  await db.end();
}

// El registro de lo sembrado sobra: acaba de borrarse todo por sucursal, no por
// ids. Si se quedara, el seeder creería que ya hay una siembra viva.
const registro = path.join(__dirname, '.demo-ventas-ids.demo.json');
if (fs.existsSync(registro)) fs.unlinkSync(registro);

// Repone usuarios, máquinas, productos y el stock de granel; es idempotente.
seed('db/seed_pruebas.js', [process.env.DEMO_PASSWORD || 'Demo1234']);
seed('scripts/seed-demo-ventas.mjs', ['--demo']);
seed('scripts/seed-demo-ventas.mjs', ['--demo', '--cuadrar']);

console.log('\nDemo restaurada.');
