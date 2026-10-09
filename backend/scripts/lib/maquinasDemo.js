// Las máquinas de la DEMO PÚBLICA (2026-10-08, a pedido): solo Speed Queen
// jumbo, que en la demo corren con temporizador (MAQUINAS_CRONOMETRO=off en
// fly.demo.toml).
//
// Lo llama ÚNICAMENTE scripts/reset-demo.mjs, después de vaciar las máquinas y
// antes de db/seed_pruebas.js. Ese seed es compartido —también arma la sucursal
// oculta de pruebas de producción— y solo crea las máquinas que falten por
// nombre, así que al encontrar L1…S2 ya puestas aquí no siembra las suyas.
// Producción y la base local no pasan nunca por este archivo.

export const MARCA_DEMO = 'Speed Queen';

// Un modelo por tipo, con su tiempo de ciclo (con temporizador es lo que dura).
export const MODELOS_DEMO = [
  { nombre: 'Lavadora Jumbo', tipo: 'lavadora', tamano: 'jumbo', minutos: 45 },
  { nombre: 'Secadora Jumbo', tipo: 'secadora', tamano: 'jumbo', minutos: 40 },
];

export const MAQUINAS_DEMO = [
  { nombre: 'L1', tipo: 'lavadora_jumbo', modelo: 'Lavadora Jumbo' },
  { nombre: 'L2', tipo: 'lavadora_jumbo', modelo: 'Lavadora Jumbo' },
  { nombre: 'L3', tipo: 'lavadora_jumbo', modelo: 'Lavadora Jumbo' },
  { nombre: 'S1', tipo: 'secadora',       modelo: 'Secadora Jumbo' },
  { nombre: 'S2', tipo: 'secadora',       modelo: 'Secadora Jumbo' },
];

// Idempotente: la marca y los modelos se crean si faltan (los catálogos no se
// vacían en el reset) y cada máquina solo si su nombre no existe en la sucursal.
export async function sembrarMaquinasDemo(db, sucursal) {
  let { rows: [marca] } = await db.query('SELECT id FROM marcas_maquina WHERE nombre = $1', [MARCA_DEMO]);
  if (!marca) {
    ({ rows: [marca] } = await db.query(
      'INSERT INTO marcas_maquina (nombre) VALUES ($1) RETURNING id', [MARCA_DEMO]
    ));
  }

  for (const mo of MODELOS_DEMO) {
    await db.query(
      `INSERT INTO modelos_maquina (marca_id, nombre, tipo, tamano, minutos)
       VALUES ($1, $2, $3, $4, $5)
       ON CONFLICT (marca_id, nombre) DO UPDATE
         SET tipo = EXCLUDED.tipo, tamano = EXCLUDED.tamano, minutos = EXCLUDED.minutos,
             activo = TRUE, pregunta_tiempo = FALSE, dos_ciclos = FALSE, minutos_por_moneda = NULL`,
      [marca.id, mo.nombre, mo.tipo, mo.tamano, mo.minutos]
    );
  }

  let creadas = 0;
  for (const m of MAQUINAS_DEMO) {
    const { rowCount: existe } = await db.query(
      'SELECT 1 FROM maquinas WHERE sucursal = $1 AND nombre = $2', [sucursal, m.nombre]
    );
    if (existe > 0) continue;
    await db.query(
      `INSERT INTO maquinas (nombre, tipo, tamano, capacidad, sucursal, marca, modelo)
       VALUES ($1, $2, 'jumbo', '35kg', $3, $4, $5)`,
      [m.nombre, m.tipo, sucursal, MARCA_DEMO, m.modelo]
    );
    creadas += 1;
  }
  return creadas;
}

// Precios de los servicios de edredón de la demo (catálogo tamanos_edredon,
// mig. 130). El reset no restaura ese catálogo y en la demo estaban vacíos, así
// que una nota Por Encargo de edredón no se podía crear (2026-10-08). Solo se
// ponen a los tamaños que existen; los demás no se tocan.
export const PRECIOS_EDREDON_DEMO = {
  'cubre colchón': 120, individual: 150, matrimonial: 180, king: 220, queen: 200,
};

export async function preciosEdredonDemo(db) {
  for (const [nombre, precio] of Object.entries(PRECIOS_EDREDON_DEMO)) {
    await db.query('UPDATE tamanos_edredon SET precio = $2 WHERE lower(nombre) = $1', [nombre, precio]);
  }
}
