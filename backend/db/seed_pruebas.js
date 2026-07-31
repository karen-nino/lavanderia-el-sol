// Crea (o actualiza) los usuarios de prueba usados para revisar la app con
// distintos roles. NO están ligados a ninguna sucursal (sucursal = NULL).
// En la página de Empleados solo los ve el admin_main.
//
// Idempotente: localiza al usuario de prueba de cada rol por la bandera
// es_prueba (sin importar cómo se llame ahora) y lo actualiza; si no existe,
// lo crea.
//
// Uso:   node db/seed_pruebas.js [contraseña]
// Si no se pasa contraseña, se usa PRUEBA_PASSWORD_DEFECTO.
import bcrypt from 'bcrypt';
import pool from './pool.js';

const PRUEBA_PASSWORD_DEFECTO = 'Prueba1234';

const USUARIOS_PRUEBA = [
  { nombre: 'Prueba', apellido: 'Admin',    rol: 'admin' },
  { nombre: 'Prueba', apellido: 'Empleado', rol: 'operador' },
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
    for (const { nombre, apellido, rol } of USUARIOS_PRUEBA) {
      const existente = await client.query(
        'SELECT id, nombre, apellido FROM usuarios WHERE es_prueba = TRUE AND rol = $1 ORDER BY id LIMIT 1',
        [rol]
      );
      if (existente.rowCount > 0) {
        // Ya hay un usuario de prueba con ese rol: solo se reactiva y se le
        // renueva la contraseña, respetando el nombre que tenga ahora.
        await client.query(
          `UPDATE usuarios
           SET password = $1, sucursal = NULL, activo = TRUE, updated_at = NOW()
           WHERE id = $2`,
          [hash, existente.rows[0].id]
        );
        const u = existente.rows[0];
        console.log(`Actualizado: ${[u.nombre, u.apellido].filter(Boolean).join(' ')} (${rol}, sin sucursal)`);
      } else {
        await client.query(
          `INSERT INTO usuarios (nombre, apellido, password, rol, sucursal, es_prueba)
           VALUES ($1, $2, $3, $4, NULL, TRUE)`,
          [nombre, apellido, hash, rol]
        );
        console.log(`Creado:      ${nombre} ${apellido} (${rol}, sin sucursal)`);
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
