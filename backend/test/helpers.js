// Utilidades para las pruebas de integración: limpiar la base entre tests,
// sembrar datos mínimos y firmar tokens como lo hace el login real.
import jwt from 'jsonwebtoken';
import pool from '../db/pool.js';

// Vacía todas las tablas de negocio (menos el registro de migraciones) y
// reinicia los SERIAL. Se llama en beforeEach para que cada test parta limpio.
export async function limpiarBase() {
  const { rows } = await pool.query(
    `SELECT tablename FROM pg_tables
      WHERE schemaname = 'public' AND tablename <> 'schema_migrations'`
  );
  if (rows.length === 0) return;
  const tablas = rows.map((r) => `"${r.tablename}"`).join(', ');
  await pool.query(`TRUNCATE ${tablas} RESTART IDENTITY CASCADE`);
}

export async function seedSucursal(slug = 'centro', nombre = 'Centro') {
  await pool.query(
    `INSERT INTO sucursales (slug, nombre, activa) VALUES ($1, $2, TRUE)
       ON CONFLICT (slug) DO NOTHING`,
    [slug, nombre]
  );
  return slug;
}

// Inserta un usuario y devuelve { id, token, sucursal }. La contraseña es un
// hash ficticio: los tests autentican con el token, no con el login.
export async function seedUsuario({ rol = 'admin', sucursal = 'centro', nombre = 'Prueba' } = {}) {
  const { rows } = await pool.query(
    `INSERT INTO usuarios (nombre, password, rol, sucursal, activo)
     VALUES ($1, 'x', $2, $3, TRUE)
     RETURNING id`,
    [nombre, rol, sucursal]
  );
  const id = rows[0].id;
  return { id, sucursal, token: tokenFor(id) };
}

// Inserta una máquina y devuelve su id. Por defecto una lavadora mediana
// disponible en la sucursal dada.
export async function seedMaquina({
  nombre = 'Lavadora 1',
  tipo = 'lavadora_mediana',
  tamano = 'mediana',
  estado = 'disponible',
  sucursal = 'centro',
} = {}) {
  const { rows } = await pool.query(
    `INSERT INTO maquinas (nombre, tipo, tamano, estado, sucursal)
     VALUES ($1, $2, $3, $4, $5) RETURNING id`,
    [nombre, tipo, tamano, estado, sucursal]
  );
  return rows[0].id;
}

// Firma un JWT como el login (payload { id }). Sin sid: el middleware solo
// exige coincidencia de sesión si el usuario tiene session_id, y el sembrado
// lo deja en NULL.
export function tokenFor(id) {
  return jwt.sign({ id }, process.env.JWT_SECRET || 'test-secret');
}

// Cabeceras de una petición autenticada (token + sucursal activa).
export function auth(token, sucursal = 'centro') {
  return { Authorization: `Bearer ${token}`, 'X-Sucursal': sucursal };
}

export { pool };
