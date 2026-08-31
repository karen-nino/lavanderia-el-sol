// Imprime {token, usuario} para entrar sin contraseña. Se ejecuta con
// cwd=backend/ para que dotenv y db/pool.js resuelvan igual que el servidor.
//   cd backend && USUARIO="Prueba Admin" node scripts/sesion-driver.mjs
import 'dotenv/config';
import jwt from 'jsonwebtoken';
import pool from '../db/pool.js';

const nombre = process.env.USUARIO || 'Prueba Admin';
const { rows } = await pool.query(
  `SELECT id, nombre, apellido, rol, sucursal, session_id
     FROM usuarios
    WHERE activo = TRUE
      AND TRIM(nombre || ' ' || COALESCE(apellido, '')) ILIKE $1
    LIMIT 1`,
  [nombre]
);
await pool.end();
if (!rows[0]) {
  console.error(`No hay usuario activo que coincida con "${nombre}".`);
  process.exit(1);
}
const u = rows[0];
// El middleware compara este `sid` contra usuarios.session_id: sin él la API
// responde 401 "Se inició sesión en otro dispositivo".
const token = jwt.sign(
  { id: u.id, rol: u.rol, sucursal: u.sucursal, sid: u.session_id },
  process.env.JWT_SECRET,
  { expiresIn: '2h' }
);
console.log(JSON.stringify({
  token,
  usuario: { id: u.id, nombre: [u.nombre, u.apellido].filter(Boolean).join(' '),
             rol: u.rol, sucursal: u.sucursal },
}));
