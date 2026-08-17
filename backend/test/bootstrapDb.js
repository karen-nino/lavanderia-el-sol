// Recrea la base de datos de prueba y le aplica el esquema + todas las
// migraciones, en el mismo orden que db/migrate.js (schema.sql primero, luego
// db/migrations/001..NNN). Se conecta al Postgres local con las credenciales
// DB_* del .env, pero apunta a otra base (TEST_DB_NAME): la de desarrollo no
// se toca. Correr esto también verifica que la cadena de migraciones aplica
// limpia de cero.
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import pg from 'pg';
import dotenv from 'dotenv';
import { TEST_DB_NAME } from './config.js';

dotenv.config();

const { Client } = pg;
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const backendDir = path.join(__dirname, '..');
const migrationsDir = path.join(backendDir, 'db', 'migrations');

const conexionBase = () => ({
  host: process.env.DB_HOST,
  port: process.env.DB_PORT,
  user: process.env.DB_USER,
  password: process.env.DB_PASSWORD,
});

// Archivos a aplicar: esquema base y luego cada migración por nombre.
function archivosSql() {
  return [
    path.join(backendDir, 'db', 'schema.sql'),
    ...fs
      .readdirSync(migrationsDir)
      .filter((f) => f.endsWith('.sql'))
      .sort()
      .map((f) => path.join(migrationsDir, f)),
  ];
}

export async function bootstrapTestDb() {
  // 1. Recrear la base desde una conexión de mantenimiento (a la base de
  //    desarrollo, que siempre existe; no se puede dropear la base en uso).
  const admin = new Client({ ...conexionBase(), database: process.env.DB_NAME });
  await admin.connect();
  try {
    await admin.query(
      `SELECT pg_terminate_backend(pid) FROM pg_stat_activity
        WHERE datname = $1 AND pid <> pg_backend_pid()`,
      [TEST_DB_NAME]
    );
    await admin.query(`DROP DATABASE IF EXISTS ${TEST_DB_NAME}`);
    await admin.query(`CREATE DATABASE ${TEST_DB_NAME}`);
  } finally {
    await admin.end();
  }

  // 2. Aplicar esquema + migraciones sobre la base recién creada.
  const db = new Client({ ...conexionBase(), database: TEST_DB_NAME });
  await db.connect();
  try {
    for (const file of archivosSql()) {
      await db.query(fs.readFileSync(file, 'utf8'));
    }
  } finally {
    await db.end();
  }
}
