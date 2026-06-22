// Aplica el esquema inicial y todas las migraciones en orden contra la base
// de datos apuntada por DATABASE_URL (o las variables DB_* en local).
//
// Es idempotente: registra cada archivo aplicado en la tabla schema_migrations
// y nunca lo vuelve a correr. La primera vez (base vacía) corre db/schema.sql y
// luego db/migrations/001..NNN en orden numérico.
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import pool from './pool.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const migrationsDir = path.join(__dirname, 'migrations');

// Orden: primero el esquema base, luego cada migración por nombre.
const archivos = [
  { name: '000_schema.sql', file: path.join(__dirname, 'schema.sql') },
  ...fs
    .readdirSync(migrationsDir)
    .filter((f) => f.endsWith('.sql'))
    .sort()
    .map((f) => ({ name: f, file: path.join(migrationsDir, f) })),
];

async function run() {
  const client = await pool.connect();
  try {
    await client.query(`
      CREATE TABLE IF NOT EXISTS schema_migrations (
        name        TEXT PRIMARY KEY,
        applied_at  TIMESTAMPTZ NOT NULL DEFAULT now()
      )
    `);

    const { rows } = await client.query('SELECT name FROM schema_migrations');
    const aplicadas = new Set(rows.map((r) => r.name));

    let nuevas = 0;
    for (const { name, file } of archivos) {
      if (aplicadas.has(name)) continue;
      const sql = fs.readFileSync(file, 'utf8');
      process.stdout.write(`Aplicando ${name} ... `);
      await client.query('BEGIN');
      try {
        await client.query(sql);
        await client.query('INSERT INTO schema_migrations (name) VALUES ($1)', [name]);
        await client.query('COMMIT');
        console.log('OK');
        nuevas++;
      } catch (err) {
        await client.query('ROLLBACK');
        console.log('ERROR');
        throw err;
      }
    }

    console.log(nuevas === 0 ? 'Sin migraciones pendientes.' : `${nuevas} migración(es) aplicada(s).`);
  } finally {
    client.release();
    await pool.end();
  }
}

run().catch((err) => {
  console.error(err);
  process.exit(1);
});
