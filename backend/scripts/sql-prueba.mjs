// Utilería de desarrollo: ejecuta contra la base LOCAL el SQL que llegue por
// argumentos. Sirve para montar y deshacer escenarios al revisar la app a mano.
// Se niega a correr contra una base que no sea local.
import 'dotenv/config';
import pool from '../db/pool.js';

if (process.env.DATABASE_URL || !['localhost', '127.0.0.1', '', undefined].includes(process.env.DB_HOST)) {
  console.error('Solo contra la base local.');
  process.exit(1);
}
for (const q of process.argv.slice(2)) {
  const { rowCount } = await pool.query(q);
  console.log(`ok (${rowCount ?? 0}): ${q.slice(0, 70)}`);
}
await pool.end();
