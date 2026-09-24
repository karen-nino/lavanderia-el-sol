// Utilidades para las pruebas de integración: limpiar la base entre tests,
// sembrar datos mínimos y firmar tokens como lo hace el login real.
import jwt from 'jsonwebtoken';
import bcrypt from 'bcrypt';
import request from 'supertest';
import app from '../app.js';
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

// Inserta una marca en el catálogo y, si se le dan minutos, su tiempo de ciclo
// para ese tipo y tamaño (mig. 107). `limpiarBase` vacía también los catálogos,
// así que la marca que sembró la migración no sobrevive al beforeEach.
export async function seedMarca({
  nombre = 'LG',
  tipo = 'lavadora',
  tamano = 'mediana',
  minutos = null,
} = {}) {
  const { rows } = await pool.query(
    `INSERT INTO marcas_maquina (nombre) VALUES ($1)
       ON CONFLICT (nombre) DO UPDATE SET nombre = EXCLUDED.nombre
     RETURNING id`,
    [nombre]
  );
  if (minutos != null) {
    await pool.query(
      `INSERT INTO tiempos_marca (marca_id, tipo, tamano, minutos) VALUES ($1, $2, $3, $4)
         ON CONFLICT (marca_id, tipo, tamano) DO UPDATE SET minutos = EXCLUDED.minutos`,
      [rows[0].id, tipo, tamano, minutos]
    );
  }
  return nombre;
}

// Inserta una máquina y devuelve su id. Por defecto una lavadora mediana
// disponible en la sucursal dada.
//
// Sin `marca` la máquina queda como las que nadie ha terminado de configurar:
// se cronometra con el respaldo por tamaño de Ajustes y su carga corre un solo
// ciclo. Para probar el flujo de dos ciclos hay que sembrar antes la marca con
// `seedMarca({ minutos })` y pasarla aquí.
export async function seedMaquina({
  nombre = 'Lavadora 1',
  tipo = 'lavadora_mediana',
  tamano = 'mediana',
  estado = 'disponible',
  sucursal = 'centro',
  marca = null,
  modelo = null,
} = {}) {
  const { rows } = await pool.query(
    `INSERT INTO maquinas (nombre, tipo, tamano, estado, sucursal, marca, modelo)
     VALUES ($1, $2, $3, $4, $5, $6, $7) RETURNING id`,
    [nombre, tipo, tamano, estado, sucursal, marca, modelo]
  );
  return rows[0].id;
}

// Inserta un cliente en la sucursal dada y devuelve su id. Necesario para las
// notas Por Encargo, que exigen cliente_id de la misma sucursal.
// Los catálogos editables (marcas, envases, graneles, tamaños de bolsa) los
// siembra su migración, pero `limpiarBase` los vacía como a todo lo demás. Las
// pruebas que dependan de uno lo vuelven a sembrar con esto.
export async function seedEtiquetas(tabla, nombres) {
  for (const [i, nombre] of nombres.entries()) {
    await pool.query(
      `INSERT INTO ${tabla} (nombre, orden) VALUES ($1, $2)
       ON CONFLICT (nombre) DO NOTHING`,
      [nombre, i + 1]
    );
  }
}

export async function seedCliente({ nombre = 'Cliente', apellido = 'Prueba', sucursal = 'centro' } = {}) {
  const { rows } = await pool.query(
    `INSERT INTO clientes (nombre, apellido, sucursal, activo)
     VALUES ($1, $2, $3, TRUE) RETURNING id`,
    [nombre, apellido, sucursal]
  );
  return rows[0].id;
}

// Inserta un producto con stock y devuelve su id. Por defecto un producto
// normal (no por tapa) con precio y stock suficientes para reservarlo.
export async function seedProducto({
  nombre = 'Detergente',
  precio_unitario = 40,          // precio por tapa (Por Encargo)
  precio_botella = null,         // precio por botella (Autoservicio)
  stock_actual = 100,            // en tapas
  stock_granel_tapas = 0,
  es_por_tapa = false,
  tipo_liquido = 'granel',
  botella_ml = 800,
  tapa_ml = 200,                 // → 4 tapas por botella
  stock_minimo = 0,
  sucursal = 'centro',
} = {}) {
  const { rows } = await pool.query(
    `INSERT INTO productos
       (nombre, precio_unitario, precio_botella, stock_actual, stock_reservado, stock_granel_tapas,
        es_por_tapa, tipo_liquido, botella_ml, tapa_ml, stock_minimo, sucursal)
     VALUES ($1, $2, $3, $4, 0, $5, $6, $7, $8, $9, $10, $11) RETURNING id`,
    [nombre, precio_unitario, precio_botella, stock_actual, stock_granel_tapas,
     es_por_tapa, tipo_liquido, botella_ml, tapa_ml, stock_minimo, sucursal]
  );
  return rows[0].id;
}

// Crea/actualiza la fila de ajustes (id = 1) con las tarifas y topes que el
// test necesite. Los topes solo aplican a Por Encargo y comparan
// lavadora + secadora + productos contra el tope del tamaño de la carga.
export async function seedAjustes(overrides = {}) {
  const cols = { precio_carga_mediana: 70, precio_carga_secadora: 45, ...overrides };
  const nombres = Object.keys(cols);
  const valores = Object.values(cols);
  const placeholders = nombres.map((_, i) => `$${i + 1}`).join(', ');
  const set = nombres.map((n) => `${n} = EXCLUDED.${n}`).join(', ');
  await pool.query(
    `INSERT INTO ajustes (id, ${nombres.join(', ')})
       VALUES (1, ${placeholders})
     ON CONFLICT (id) DO UPDATE SET ${set}`,
    valores
  );
}

// Inserta un insumo y devuelve su id. Por defecto con stock suficiente.
export async function seedInsumo({
  nombre = 'Jabón', unidad = 'litro', stock_actual = 100, stock_minimo = 0,
  sucursal = 'centro',
} = {}) {
  const { rows } = await pool.query(
    `INSERT INTO insumos (nombre, unidad, stock_actual, stock_minimo, sucursal)
     VALUES ($1, $2, $3, $4, $5) RETURNING id`,
    [nombre, unidad, stock_actual, stock_minimo, sucursal]
  );
  return rows[0].id;
}

// Inserta un usuario con una contraseña real (hash bcrypt) para probar el
// login de verdad. Devuelve { id, password, rol, sucursal }.
export async function seedLogin({ rol = 'admin', sucursal = 'centro', nombre = 'Login', apellido = null, password = 'secret123' } = {}) {
  const hash = await bcrypt.hash(password, 4); // costo bajo: tests rápidos
  const { rows } = await pool.query(
    `INSERT INTO usuarios (nombre, apellido, password, rol, sucursal, activo)
     VALUES ($1, $2, $3, $4, $5, TRUE) RETURNING id`,
    [nombre, apellido, hash, rol, sucursal]
  );
  return { id: rows[0].id, password, rol, sucursal };
}

// Inserta una notificación (campana del Dashboard) y devuelve su id.
// `minutosAtras` la envejece para probar la ventana de 24 h.
export async function seedNotificacion({
  tipo = 'aviso', mensaje = 'Notificación de prueba', sucursal = 'centro',
  usuario_id = null, minutosAtras = 0,
} = {}) {
  const { rows } = await pool.query(
    `INSERT INTO notificaciones (tipo, mensaje, sucursal, usuario_id, created_at)
     VALUES ($1, $2, $3, $4, NOW() - ($5 || ' minutes')::interval) RETURNING id`,
    [tipo, mensaje, sucursal, usuario_id, String(minutosAtras)]
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

// Flujo nuevo de Autoservicio: crea la nota con TIPO de lavado, le asigna la
// lavadora física (Salidas) y la arranca → nota LAVANDO. Devuelve
// { notaId, lavadoraId }. Reutilizable en los tests que necesitan una lavadora
// de autoservicio en uso.
export async function autoservicioLavando({ token, sucursal = 'centro', nombre = 'Lav Auto', estado_pago = 'PAGADO' } = {}) {
  const lavadoraId = await seedMaquina({ nombre, tipo: 'lavadora_mediana', tamano: 'mediana', sucursal });
  const crea = await request(app).post('/api/notas').set(auth(token, sucursal)).send({
    tipo_servicio: 'AUTOSERVICIO', tipo_prenda: 'ROPA', estado_pago,
    cargas: [{ lavadora_tipo: 'mediana' }],
  });
  const cargaId = crea.body.cargas[0].id;
  await request(app).patch(`/api/notas/${crea.body.id}/asignar-carga-maquina`).set(auth(token, sucursal))
    .send({ carga_id: cargaId, slot: 'lavadora', maquina_id: lavadoraId });
  await request(app).patch(`/api/notas/${crea.body.id}/activar-pendientes`).set(auth(token, sucursal))
    .send({ maquina_id: lavadoraId });
  return { notaId: crea.body.id, lavadoraId };
}

export { pool };
