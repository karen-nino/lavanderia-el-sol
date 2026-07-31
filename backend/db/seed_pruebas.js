// Crea (o actualiza) los usuarios de prueba usados para revisar la app con
// distintos roles. NO están ligados a ninguna sucursal (sucursal = NULL).
// En la página de Empleados solo los ve el admin_main.
//
// Uso:   node db/seed_pruebas.js [contraseña]
// Si no se pasa contraseña, se usa PRUEBA_PASSWORD_DEFECTO.
import bcrypt from 'bcrypt';
import pool from './pool.js';

const PRUEBA_PASSWORD_DEFECTO = 'Prueba1234';

const USUARIOS_PRUEBA = [
  { nombre: 'Prueba_Admin',    rol: 'admin' },
  { nombre: 'Prueba_Empleado', rol: 'operador' },
];

async function main() {
  const password = process.argv[2] || PRUEBA_PASSWORD_DEFECTO;
  if (password.length < 8) {
    console.error('Error: la contraseña debe tener al menos 8 caracteres.');
    process.exit(1);
  }

  const hash = await bcrypt.hash(password, 10);
  const client = await pool.connect();
  try {
    for (const { nombre, rol } of USUARIOS_PRUEBA) {
      // Idempotente: si ya existe (por nombre) se actualiza; si no, se inserta.
      const existente = await client.query(
        'SELECT id FROM usuarios WHERE nombre = $1',
        [nombre]
      );
      if (existente.rowCount > 0) {
        await client.query(
          `UPDATE usuarios
           SET password = $1, rol = $2, sucursal = NULL, activo = TRUE, es_prueba = TRUE, updated_at = NOW()
           WHERE nombre = $3`,
          [hash, rol, nombre]
        );
        console.log(`Actualizado: ${nombre} (${rol}, sin sucursal)`);
      } else {
        await client.query(
          `INSERT INTO usuarios (nombre, password, rol, sucursal, es_prueba)
           VALUES ($1, $2, $3, NULL, TRUE)`,
          [nombre, hash, rol]
        );
        console.log(`Creado:      ${nombre} (${rol}, sin sucursal)`);
      }
    }
    console.log(`\nContraseña para ambos: ${password}`);
    console.log('Listo.\n');
  } finally {
    client.release();
    await pool.end();
  }
}

main().catch((err) => {
  console.error('\nError inesperado:', err.message);
  process.exit(1);
});
