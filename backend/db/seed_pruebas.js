// Prepara el ENTORNO DE PRUEBAS: los usuarios con los que se revisa la app y
// la sucursal oculta donde operan (migración 095).
//
// Los usuarios de prueba viven en la sucursal 'pruebas': sus notas, caja,
// clientes e inventario son solo suyos y no tocan los datos reales del
// negocio. Nadie más ve esa sucursal (ni el admin_main), y ellos no pueden
// salir de ella ni cambiar la configuración global (tarifas, tiempos,
// sucursales, catálogos). En la página de Empleados solo los ve el admin_main.
//
// Idempotente: localiza al usuario de prueba de cada rol por la bandera
// es_prueba (sin importar cómo se llame ahora) y lo actualiza; si no existe,
// lo crea. Las máquinas y productos de arranque se crean solo si faltan, así
// que volver a correrlo no duplica nada ni pisa lo que se haya capturado
// desde la app.
//
// Uso:   node db/seed_pruebas.js [contraseña]
// Si no se pasa contraseña, se usa PRUEBA_PASSWORD_DEFECTO.
import bcrypt from 'bcrypt';
import pool from './pool.js';

const PRUEBA_PASSWORD_DEFECTO = 'Prueba1234';

// Debe coincidir con SUCURSAL_PRUEBAS (middleware/sucursalActiva.js).
const SUCURSAL = 'pruebas';

const USUARIOS_PRUEBA = [
  { nombre: 'Prueba', apellido: 'Admin',    rol: 'admin' },
  { nombre: 'Prueba', apellido: 'Empleado', rol: 'operador' },
];

// Máquinas de arranque: lo mínimo para poder hacer una nota completa
// (autoservicio y por encargo, con carga jumbo).
const MAQUINAS_PRUEBA = [
  { nombre: 'L1', tipo: 'lavadora_mediana', tamano: 'mediana', capacidad: '20kg' },
  { nombre: 'L2', tipo: 'lavadora_mediana', tamano: 'mediana', capacidad: '20kg' },
  { nombre: 'L3', tipo: 'lavadora_jumbo',   tamano: 'jumbo',   capacidad: '35kg' },
  { nombre: 'S1', tipo: 'secadora',         tamano: 'mediana', capacidad: '20kg' },
  { nombre: 'S2', tipo: 'secadora',         tamano: 'jumbo',   capacidad: '35kg' },
];

// Productos de arranque: una copia de lo que hay en la Sucursal Retiro
// (tomada el 2026-09-03), para que el entorno controlado tenga el mismo
// catálogo con el que se trabaja de verdad: jabón y suavizante a granel,
// un suavizante de marca y las bolsas de los tres tamaños.
const PRODUCTOS_PRUEBA = [
  {
    nombre: 'Jabón', clase: 'liquido', unidad: 'Tapas',
    es_por_tapa: true, tipo_liquido: 'granel', tapas_por_envase: 100,
    botella_ml: 800, tapa_ml: 200, precio_botella: 27, precio_unitario: 5,
    stock_actual: 96, stock_minimo: 8,
  },
  {
    nombre: 'Suavizante', clase: 'liquido', unidad: 'Tapas',
    es_por_tapa: true, tipo_liquido: 'granel', tapas_por_envase: 100,
    botella_ml: 800, tapa_ml: 200, precio_botella: 27, precio_unitario: 5,
    stock_actual: 96, stock_minimo: 4,
  },
  {
    nombre: 'Suavizante', clase: 'liquido', unidad: 'Tapas', marca: 'Ensueño',
    es_por_tapa: true, tipo_liquido: 'marca', tapas_por_envase: 1,
    botella_ml: 1, tapa_ml: 1, precio_botella: 28,
    stock_actual: 3, stock_minimo: 2,
  },
  {
    nombre: 'Bolsa', clase: 'bolsa', unidad: 'pieza',
    tamano_bolsa: 'chica', bolsas_por_rollo: 80,
    precio_unitario: 5, stock_actual: 80, stock_minimo: 10,
  },
  {
    nombre: 'Bolsa', clase: 'bolsa', unidad: 'pieza',
    tamano_bolsa: 'grande', bolsas_por_rollo: 80,
    precio_unitario: 5, stock_actual: 80, stock_minimo: 10,
  },
  {
    nombre: 'Bolsa', clase: 'bolsa', unidad: 'pieza',
    tamano_bolsa: 'jumbo', bolsas_por_rollo: 80,
    precio_unitario: 5, stock_actual: 80, stock_minimo: 10,
  },
];

// Nombre legible para el log, que distingue las variantes homónimas.
function etiquetaProducto(p) {
  const detalle = p.marca ?? p.tipo_liquido ?? p.tamano_bolsa;
  return detalle ? `${p.nombre} (${detalle})` : p.nombre;
}

async function main() {
  const password = process.argv[2] || PRUEBA_PASSWORD_DEFECTO;
  if (password.length < 6) {
    console.error('Error: la contraseña debe tener al menos 6 caracteres.');
    process.exit(1);
  }

  const hash = await bcrypt.hash(password, 10);
  const client = await pool.connect();
  try {
    // ── Sucursal oculta ───────────────────────────────────────
    // La crea la migración 095; aquí solo se asegura por si el seed corre
    // contra una base donde alguien la borró o la desactivó.
    await client.query(
      `INSERT INTO sucursales (slug, nombre, activa, oculta, orden)
       VALUES ($1, 'Sucursal Pruebas', TRUE, TRUE, 999)
       ON CONFLICT (slug) DO UPDATE SET activa = TRUE, oculta = TRUE`,
      [SUCURSAL]
    );

    // ── Usuarios ──────────────────────────────────────────────
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
           SET password = $1, sucursal = $2, activo = TRUE, updated_at = NOW()
           WHERE id = $3`,
          [hash, SUCURSAL, existente.rows[0].id]
        );
        const u = existente.rows[0];
        console.log(`Actualizado: ${[u.nombre, u.apellido].filter(Boolean).join(' ')} (${rol})`);
      } else {
        await client.query(
          `INSERT INTO usuarios (nombre, apellido, password, rol, sucursal, es_prueba)
           VALUES ($1, $2, $3, $4, $5, TRUE)`,
          [nombre, apellido, hash, rol, SUCURSAL]
        );
        console.log(`Creado:      ${nombre} ${apellido} (${rol})`);
      }
    }

    // ── Máquinas ──────────────────────────────────────────────
    for (const m of MAQUINAS_PRUEBA) {
      const { rowCount } = await client.query(
        'SELECT 1 FROM maquinas WHERE sucursal = $1 AND nombre = $2',
        [SUCURSAL, m.nombre]
      );
      if (rowCount > 0) continue;
      await client.query(
        `INSERT INTO maquinas (nombre, tipo, tamano, capacidad, sucursal)
         VALUES ($1, $2, $3, $4, $5)`,
        [m.nombre, m.tipo, m.tamano, m.capacidad, SUCURSAL]
      );
      console.log(`Máquina:     ${m.nombre} (${m.tipo})`);
    }

    // ── Productos ─────────────────────────────────────────────
    for (const p of PRODUCTOS_PRUEBA) {
      // Hay productos que comparten nombre (suavizante granel y de marca, las
      // tres bolsas), así que la variante se identifica por nombre + clase +
      // marca/tipo de líquido + tamaño de bolsa.
      const { rowCount } = await client.query(
        `SELECT 1 FROM productos
          WHERE sucursal = $1 AND nombre = $2 AND clase = $3 AND archivado = FALSE
            AND COALESCE(marca, '')        = COALESCE($4, '')
            AND COALESCE(tipo_liquido, '') = COALESCE($5, '')
            AND COALESCE(tamano_bolsa, '') = COALESCE($6, '')`,
        [SUCURSAL, p.nombre, p.clase, p.marca ?? null, p.tipo_liquido ?? null, p.tamano_bolsa ?? null]
      );
      if (rowCount > 0) continue;
      await client.query(
        `INSERT INTO productos
           (nombre, clase, unidad, marca, es_por_tapa, tipo_liquido, tapas_por_envase,
            botella_ml, tapa_ml, precio_botella, precio_unitario,
            tamano_bolsa, bolsas_por_rollo, stock_actual, stock_minimo, sucursal)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16)`,
        [
          p.nombre, p.clase, p.unidad, p.marca ?? null,
          p.es_por_tapa ?? false, p.tipo_liquido ?? null, p.tapas_por_envase ?? null,
          p.botella_ml ?? null, p.tapa_ml ?? null, p.precio_botella ?? null,
          p.precio_unitario ?? null, p.tamano_bolsa ?? null, p.bolsas_por_rollo ?? null,
          p.stock_actual ?? 0, p.stock_minimo ?? 0, SUCURSAL,
        ]
      );
      console.log(`Producto:    ${etiquetaProducto(p)}`);
    }

    // Los seeds viejos creaban un jabón y un suavizante de marca inventada
    // ('Prueba') que ya no forman parte del catálogo. Se archivan (no se
    // borran, por si alguna nota los usó) para dejar solo la copia de Retiro.
    const { rowCount: archivados } = await client.query(
      `UPDATE productos SET archivado = TRUE
        WHERE sucursal = $1 AND marca = 'Prueba' AND archivado = FALSE`,
      [SUCURSAL]
    );
    if (archivados > 0) console.log(`Archivados:  ${archivados} producto(s) de la marca 'Prueba'`);

    console.log(`\nSucursal:            ${SUCURSAL} (oculta)`);
    console.log(`Contraseña de ambos: ${password}`);
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
