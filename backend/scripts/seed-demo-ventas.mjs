// Siembra notas FALSAS de demostración en la sucursal `pruebas` (usuario
// "Prueba Admin") para que la pantalla de Ventas se vea llena en una captura.
//
//   node seed-demo-ventas.mjs            -> siembra ~90 días de notas
//   node seed-demo-ventas.mjs --cuadrar  -> movimientos de inventario y cortes
//                                           de caja para esas mismas notas
//   node seed-demo-ventas.mjs --limpiar  -> borra TODO lo que sembró
//
// Lo sembrado se registra en .demo-ventas-ids.json (notas, clientes, cajas,
// movimientos de inventario y el stock que había antes), así la limpieza no
// toca ni una fila que no haya creado este script y deja el stock como estaba.
import pg from 'pg';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import dotenv from 'dotenv';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const BACKEND = '/Users/karen.nino/Desktop/lavanderia-el-sol/backend';
dotenv.config({ path: path.join(BACKEND, '.env') });

const MODO_DEMO = process.argv.includes('--demo');
// Un registro por entorno: si se mezclaran, limpiar en local intentaría borrar
// ids que solo existen en la base de la demo.
const REGISTRO = path.join(__dirname, MODO_DEMO ? '.demo-ventas-ids.demo.json' : '.demo-ventas-ids.json');
const SUCURSAL = 'pruebas';
const DIAS = 90;

const cfg = {
  host: process.env.DB_HOST, port: process.env.DB_PORT, user: process.env.DB_USER,
  password: process.env.DB_PASSWORD, database: process.env.DB_NAME,
};

// ── Candado: la base local, o la de la demo con --demo ────────────────────
// Esto inventa cientos de notas cobradas. En la base del negocio sería un
// destrozo, así que por defecto solo acepta la base LOCAL: `DATABASE_URL` es
// la cadena remota (db/pool.js la prefiere sobre las DB_* en cuanto existe) y
// el host tiene que ser esta misma máquina.
//
// Con --demo apunta al Postgres de la demo pública, que también necesita datos
// falsos. Esa puerta es estrecha a propósito: la cadena tiene que venir de
// backend/.env.demo —nunca del .env normal, que es el que apunta a la base de
// trabajo— y más abajo, ya conectados, se comprueba que la base no tenga
// operación real antes de escribir nada.
if (MODO_DEMO) {
  const archivo = path.join(BACKEND, '.env.demo');
  if (!fs.existsSync(archivo)) {
    console.error('ABORTADO: falta backend/.env.demo con la DATABASE_URL de la demo.');
    process.exit(1);
  }
  // override: en esta misma corrida ya se cargó el .env normal.
  dotenv.config({ path: archivo, override: true });
  if (!process.env.DATABASE_URL) {
    console.error('ABORTADO: backend/.env.demo no define DATABASE_URL.');
    process.exit(1);
  }
  cfg.connectionString = process.env.DATABASE_URL;
  cfg.ssl = { rejectUnauthorized: false };
  // Las DB_* del .env normal apuntan a la base local: si se quedan puestas,
  // pg las mezcla con la cadena y se conecta a quién sabe dónde.
  for (const k of ['host', 'port', 'user', 'password', 'database']) delete cfg[k];
} else {
  const LOCALES = ['localhost', '127.0.0.1', '::1', ''];
  if (process.env.DATABASE_URL) {
    console.error('ABORTADO: hay DATABASE_URL definida (producción).\n' +
                  'Este script solo siembra datos falsos en la base LOCAL, o en la demo con --demo.');
    process.exit(1);
  }
  if (!LOCALES.includes(String(cfg.host ?? '').trim())) {
    console.error(`ABORTADO: DB_HOST es "${cfg.host}" y no una base local.\n` +
                  'Este script solo siembra datos falsos en la base LOCAL, o en la demo con --demo.');
    process.exit(1);
  }
}

// Segunda comprobación, ya conectados: una base con notas fuera de la sucursal
// de pruebas es una base con operación real. Da igual qué diga la cadena de
// conexión o el nombre del archivo; si hay trabajo de verdad ahí dentro, este
// script no escribe.
async function verificarBaseSinOperacionReal(db) {
  const { rows } = await db.query(
    'SELECT COUNT(*)::int AS n FROM notas WHERE sucursal <> $1', [SUCURSAL]
  );
  if (rows[0].n > 0) {
    console.error(`ABORTADO: la base tiene ${rows[0].n} notas fuera de la sucursal "${SUCURSAL}".\n` +
                  'Eso es operación real: este script solo siembra en bases de prueba o de demostración.');
    process.exit(1);
  }
}

// --- azar con semilla, para que dos corridas den lo mismo -------------------
let semilla = 20260910;
const rnd = () => { semilla = (semilla * 1664525 + 1013904223) % 4294967296; return semilla / 4294967296; };
const entre = (a, b) => a + Math.floor(rnd() * (b - a + 1));
const elige = (arr) => arr[Math.floor(rnd() * arr.length)];
const pesado = (pares) => { // [[valor, peso], ...]
  const total = pares.reduce((s, [, p]) => s + p, 0);
  let r = rnd() * total;
  for (const [v, p] of pares) { if ((r -= p) <= 0) return v; }
  return pares[pares.length - 1][0];
};

const NOMBRES = ['María', 'Guadalupe', 'José', 'Rosa', 'Javier', 'Alejandra', 'Martín', 'Leticia', 'Ramón', 'Carmen', 'Fernanda', 'Sergio'];
const APELLIDOS = ['Ramírez', 'Gutiérrez', 'Hernández', 'Torres', 'Vázquez', 'Aguilar', 'Mendoza', 'Sandoval', 'Delgado', 'Beltrán'];

async function limpiar(db) {
  if (!fs.existsSync(REGISTRO)) { console.log('No hay nada registrado que limpiar.'); return; }
  const { notas = [], clientes = [], movimientos = [], cajas = [], stockPrevio = [] } =
    JSON.parse(fs.readFileSync(REGISTRO, 'utf8'));
  await db.query('BEGIN');
  // Los movimientos de inventario van primero: borrar la nota no los borra
  // (producto_movimientos.nota_id es ON DELETE SET NULL) y quedarían sueltos
  // descuadrando el reporte diario.
  const m = await db.query('DELETE FROM producto_movimientos WHERE id = ANY($1) AND sucursal = $2',
                           [movimientos, SUCURSAL]);
  for (const s of stockPrevio) {
    await db.query('UPDATE productos SET stock_actual = $2, stock_granel_tapas = $3 WHERE id = $1',
                   [s.id, s.stock_actual, s.stock_granel_tapas]);
  }
  // Reserva apartada por las notas en espera (se recalcula desde sus productos).
  await db.query(
    `UPDATE productos p
        SET stock_reservado = GREATEST(0, p.stock_reservado - x.tapas)
       FROM (SELECT np.producto_id, SUM(np.cantidad_tapas) AS tapas
               FROM nota_productos np JOIN notas n ON n.id = np.nota_id
              WHERE np.nota_id = ANY($1) AND n.estado NOT IN ('CANCELADA', 'FINALIZADA')
                AND n.estado_pago = 'PENDIENTE'
              GROUP BY np.producto_id) x
      WHERE p.id = x.producto_id`, [notas]);
  // nota_cargas, nota_productos y nota_estado_historial caen por CASCADE.
  const n = await db.query('DELETE FROM notas WHERE id = ANY($1) AND sucursal = $2', [notas, SUCURSAL]);
  // Las cajas arrastran sus movimientos_caja por CASCADE.
  const k = await db.query('DELETE FROM cajas WHERE id = ANY($1) AND sucursal = $2', [cajas, SUCURSAL]);
  const c = await db.query('DELETE FROM clientes WHERE id = ANY($1) AND sucursal = $2', [clientes, SUCURSAL]);
  await db.query('COMMIT');
  fs.unlinkSync(REGISTRO);
  console.log(`Borradas ${n.rowCount} notas, ${c.rowCount} clientes, ${k.rowCount} sesiones de caja ` +
              `y ${m.rowCount} movimientos de inventario; stock restaurado.`);
}

async function sembrar(db) {
  if (fs.existsSync(REGISTRO)) {
    console.log('Ya hay una siembra registrada. Corre --limpiar antes de volver a sembrar.');
    process.exit(1);
  }

  const { rows: usuarios } = await db.query(
    `SELECT id, rol FROM usuarios WHERE sucursal = $1 AND es_prueba = true ORDER BY id`, [SUCURSAL]);
  const admin = usuarios.find(u => u.rol === 'admin')?.id;
  const empleado = usuarios.find(u => u.rol !== 'admin')?.id ?? admin;
  if (!admin) throw new Error('No encontré al usuario "Prueba Admin" en la sucursal pruebas.');

  const { rows: maquinas } = await db.query(
    `SELECT id, nombre, tipo FROM maquinas WHERE sucursal = $1`, [SUCURSAL]);
  const lavMedianas = maquinas.filter(m => m.tipo === 'lavadora_mediana').map(m => m.id);
  const lavJumbo    = maquinas.filter(m => m.tipo === 'lavadora_jumbo').map(m => m.id);
  const secadoras   = maquinas.filter(m => m.tipo === 'secadora').map(m => m.id);
  if (!lavMedianas.length || !secadoras.length) throw new Error('Faltan máquinas en la sucursal pruebas.');

  const { rows: t } = await db.query('SELECT * FROM ajustes WHERE id = 1');
  const tarifa = {
    mediana: Number(t[0].precio_carga_mediana), jumbo: Number(t[0].precio_carga_jumbo),
    secadora: Number(t[0].precio_carga_secadora), edredon: Number(t[0].precio_edredon_jumbo),
    secadoraEdredon: Number(t[0].precio_secadora_edredon ?? t[0].precio_carga_secadora),
  };

  const { rows: productos } = await db.query(
    `SELECT id, nombre, marca, clase, precio_unitario, precio_botella, botella_ml, tapa_ml
       FROM productos WHERE sucursal = $1 AND archivado = false`, [SUCURSAL]);
  const liquidos = productos.filter(p => p.clase === 'liquido');
  const bolsas   = productos.filter(p => p.clase === 'bolsa');

  await db.query('BEGIN');

  // Clientes de demostración (para las notas Por Encargo y de edredón).
  const clientesIds = [];
  for (let i = 0; i < 10; i++) {
    const { rows } = await db.query(
      `INSERT INTO clientes (nombre, apellido, telefono, sucursal)
       VALUES ($1, $2, $3, $4) RETURNING id`,
      [elige(NOMBRES), elige(APELLIDOS), `33${entre(10000000, 99999999)}`, SUCURSAL]);
    clientesIds.push(rows[0].id);
  }

  // El folio es global y correlativo: arranca después del más alto que exista.
  const { rows: maxFolio } = await db.query(
    `SELECT COALESCE(MAX(NULLIF(split_part(folio, '-', 1), '')::int), 0) AS n FROM notas`);
  let consecutivo = Number(maxFolio[0].n) + 1;

  const notasIds = [];
  const hoy = new Date();

  for (let d = DIAS - 1; d >= 0; d--) {
    const dia = new Date(hoy);
    dia.setDate(hoy.getDate() - d);
    const dow = dia.getDay();                       // 0 domingo, 6 sábado
    const esHoy = d === 0;
    // Sábado y domingo cargan más trabajo; hoy va lleno para la vista "Hoy".
    let cuantas = esHoy ? entre(10, 14) : (dow === 0 || dow === 6 ? entre(5, 8) : entre(2, 5));

    for (let i = 0; i < cuantas; i++) {
      const hora = entre(8, 19), minuto = entre(0, 59);
      const stamp = `${dia.getFullYear()}-${String(dia.getMonth() + 1).padStart(2, '0')}-${String(dia.getDate()).padStart(2, '0')} ${String(hora).padStart(2, '0')}:${String(minuto).padStart(2, '0')}:00`;
      const folio = `${String(consecutivo++).padStart(4, '0')}-${String(dia.getDate()).padStart(2, '0')}${String(dia.getMonth() + 1).padStart(2, '0')}${String(dia.getFullYear()).slice(-2)}`;

      const servicio = pesado([['AUTOSERVICIO', 60], ['POR_ENCARGO', 32], ['EDREDON', 8]]);
      const esEdredon = servicio === 'EDREDON';
      const prenda = esEdredon ? 'EDREDON' : 'ROPA';
      const usuario = pesado([[admin, 7], [empleado, 3]]);

      // Una de cada 25 se canceló; de las recientes, algunas siguen sin cobrar.
      const cancelada = rnd() < 0.04;
      const pendiente = !cancelada && d <= 3 && rnd() < 0.18;
      const pagado = !cancelada && !pendiente;
      const estado = cancelada ? 'CANCELADA'
        : (servicio !== 'AUTOSERVICIO' && d <= 1 && rnd() < 0.5) ? 'LISTA'
        : 'FINALIZADA';
      const formaPago = pagado ? pesado([['EFECTIVO', 70], ['TRANSFERENCIA', 20], ['TARJETA', 10]]) : null;

      const { rows: notaRows } = await db.query(
        `INSERT INTO notas (cliente_id, usuario_id, estado, precio_total, folio, tipo_servicio,
                            estado_pago, sucursal, tipo_prenda, forma_pago, tiempo_entrega,
                            fecha_entrega, tamano_edredon, ajuste, motivo_cancelacion,
                            created_at, updated_at, pagado_en)
         VALUES ($1, $2, $3::estado_orden, 0, $4, $5::tipo_servicio, $6::estado_pago_orden, $7, $8, $9, $10,
                 CASE WHEN $5::text = 'AUTOSERVICIO' THEN NULL
                      ELSE ($11::timestamp + INTERVAL '1 day') AT TIME ZONE 'America/Mexico_City' END,
                 $12, 0, $13,
                 $11::timestamp AT TIME ZONE 'America/Mexico_City',
                 $11::timestamp AT TIME ZONE 'America/Mexico_City',
                 CASE WHEN $6::text = 'PAGADO' THEN $11::timestamp AT TIME ZONE 'America/Mexico_City' END)
         RETURNING id`,
        [
          servicio === 'AUTOSERVICIO' ? null : elige(clientesIds),
          usuario, estado, folio, servicio,
          pagado ? 'PAGADO' : 'PENDIENTE', SUCURSAL, prenda, formaPago,
          servicio === 'POR_ENCARGO' ? elige(['MANANA', 'TARDE', 'NOCHE']) : null,
          stamp,
          esEdredon ? elige(['matrimonial', 'king size', 'individual']) : null,
          cancelada ? elige(['El cliente ya no quiso el servicio', 'Se capturó por equivocación']) : null,
        ]);

      const notaId = notaRows[0].id;
      notasIds.push(notaId);

      // --- cargas ---
      const nCargas = esEdredon ? 1 : (servicio === 'AUTOSERVICIO' ? pesado([[1, 5], [2, 4], [3, 2]]) : pesado([[1, 6], [2, 3]]));
      let totalCargas = 0;
      const cargaIds = [];
      for (let c = 1; c <= nCargas; c++) {
        const usaJumbo = !esEdredon && rnd() < 0.3 && lavJumbo.length;
        const lavId = esEdredon ? (lavJumbo[0] ?? elige(lavMedianas)) : (usaJumbo ? elige(lavJumbo) : elige(lavMedianas));
        const conSecadora = esEdredon ? true : rnd() < 0.8;
        const secId = conSecadora ? elige(secadoras) : null;
        const precioLav = esEdredon ? tarifa.edredon : (usaJumbo ? tarifa.jumbo : tarifa.mediana);
        const precioSec = conSecadora ? (esEdredon ? tarifa.secadoraEdredon : tarifa.secadora) : 0;
        totalCargas += precioLav + precioSec;
        const { rows: cRows } = await db.query(
          `INSERT INTO nota_cargas (nota_id, orden, lavadora_usada_id, secadora_usada_id,
                                    precio_lavadora, precio_secadora, tipo_prenda, tamano,
                                    lavadora_tipo, secadora_tipo, ajuste, created_at)
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, 0,
                   $11::timestamp AT TIME ZONE 'America/Mexico_City')
           RETURNING id`,
          [notaId, c, lavId, secId, precioLav, precioSec, prenda,
           servicio === 'POR_ENCARGO' ? elige(['chico', 'grande', 'jumbo']) : null,
           esEdredon ? 'edredon' : (usaJumbo ? 'jumbo' : 'mediana'),
           conSecadora ? (esEdredon ? 'edredon' : 'mediana') : null,
           stamp]);
        cargaIds.push(cRows[0].id);
      }

      // --- productos ---
      let totalProductos = 0;
      const porBotella = servicio === 'AUTOSERVICIO';
      for (const carga of cargaIds) {
        if (liquidos.length && rnd() < 0.75) {
          const cuantos = entre(1, Math.min(2, liquidos.length));
          const usados = [...liquidos].sort(() => rnd() - 0.5).slice(0, cuantos);
          for (const p of usados) {
            const precio = porBotella ? Number(p.precio_botella ?? 0) : Number(p.precio_unitario ?? 0);
            if (!precio) continue;
            const cant = porBotella ? 1 : entre(1, 3);
            const tapas = porBotella
              ? Math.max(1, Math.floor(Number(p.botella_ml || 0) / Number(p.tapa_ml || 1)) || 1)
              : cant;
            totalProductos += precio * cant;
            await db.query(
              `INSERT INTO nota_productos (nota_id, producto_id, cantidad, precio_unitario, unidad, cantidad_tapas, carga_id, created_at)
               VALUES ($1, $2, $3, $4, $5, $6, $7, $8::timestamp AT TIME ZONE 'America/Mexico_City')`,
              [notaId, p.id, cant, precio, porBotella ? 'botella' : 'tapa', tapas, carga, stamp]);
          }
        }
      }
      if (bolsas.length && rnd() < 0.35) {
        const b = elige(bolsas);
        const precio = Number(b.precio_unitario ?? 0);
        if (precio) {
          const cant = entre(1, 2);
          totalProductos += precio * cant;
          await db.query(
            `INSERT INTO nota_productos (nota_id, producto_id, cantidad, precio_unitario, unidad, cantidad_tapas, carga_id, created_at)
             VALUES ($1, $2, $3, $4, 'pieza', $3, NULL, $5::timestamp AT TIME ZONE 'America/Mexico_City')`,
            [notaId, b.id, cant, precio, stamp]);
        }
      }

      await db.query('UPDATE notas SET precio_total = $2 WHERE id = $1', [notaId, totalCargas + totalProductos]);
    }
  }

  await db.query('COMMIT');
  fs.writeFileSync(REGISTRO, JSON.stringify({ notas: notasIds, clientes: clientesIds }, null, 2));

  const { rows: resumen } = await db.query(
    `SELECT COUNT(*) FILTER (WHERE estado_pago = 'PAGADO' AND estado <> 'CANCELADA') AS pagadas,
            COALESCE(SUM(precio_total) FILTER (WHERE estado_pago = 'PAGADO' AND estado <> 'CANCELADA'), 0) AS cobrado
       FROM notas WHERE id = ANY($1)`, [notasIds]);
  console.log(`Sembradas ${notasIds.length} notas (${resumen[0].pagadas} cobradas, $${Number(resumen[0].cobrado).toLocaleString('es-MX')}) y ${clientesIds.length} clientes.`);
  console.log(`Registro para limpiar: ${REGISTRO}`);
}


// ── Fase 2: que Inventario y Caja acompañen a Ventas ──────────────────────
// La siembra deja las notas cobradas pero sin huella en el resto del sistema:
// ni salidas de inventario ni sesiones de caja. Esto lo rellena imitando lo que
// habría hecho la app:
//   · inventario → un movimiento 'venta' por producto de cada nota (como
//     registrarMovimientosProductosNota) más los reabastos que harían falta
//     para no quedarse sin stock, y el stock final ajustado al saldo resultante;
//   · caja → una sesión por día, con sus notas atadas y las cifras congeladas
//     al cerrar (mig. 101). La del día en curso se deja ABIERTA.
async function cuadrar(db) {
  if (!fs.existsSync(REGISTRO)) {
    console.log('No hay siembra registrada. Corre primero el script sin banderas.');
    process.exit(1);
  }
  const reg = JSON.parse(fs.readFileSync(REGISTRO, 'utf8'));
  if (reg.cuadrado) { console.log('Esta siembra ya está cuadrada.'); process.exit(1); }

  const notas = reg.notas ?? [];
  const movimientos = [];
  const cajas = [];
  const stockPrevio = [];

  await db.query('BEGIN');

  // ── Inventario ──────────────────────────────────────────────────────────
  // Solo consume lo que la app consumiría: al cobrar o al entregar, lo que
  // ocurra primero. Una nota cancelada devuelve el producto; una que sigue en
  // espera y sin cobrar lo tiene apenas reservado.
  const { rows: lineas } = await db.query(
    `SELECT np.id, np.nota_id, np.producto_id, np.cantidad, np.cantidad_tapas, np.unidad,
            n.created_at, n.usuario_id, n.estado, n.estado_pago,
            p.clase, p.tipo_liquido, p.botella_ml, p.tapa_ml, p.volumen_envase_ml,
            p.bolsas_por_rollo, p.stock_actual, p.stock_granel_tapas
       FROM nota_productos np
       JOIN notas n    ON n.id = np.nota_id
       JOIN productos p ON p.id = np.producto_id
      WHERE np.nota_id = ANY($1)
      ORDER BY n.created_at, np.id`,
    [notas]);

  const consumidas = lineas.filter(l => l.estado !== 'CANCELADA' &&
    (l.estado === 'FINALIZADA' || l.estado_pago === 'PAGADO'));
  const reservadas = lineas.filter(l => l.estado !== 'CANCELADA' &&
    !(l.estado === 'FINALIZADA' || l.estado_pago === 'PAGADO'));

  const porProducto = new Map();
  for (const l of consumidas) {
    if (!porProducto.has(l.producto_id)) porProducto.set(l.producto_id, []);
    porProducto.get(l.producto_id).push(l);
  }

  const movVenta = async (l, destino) => {
    const etiqueta = l.unidad === 'pieza' ? ' bolsa(s)'
      : l.unidad === 'botella' ? (l.tipo_liquido === 'marca' ? ' unidad(es)' : ' botella(s)')
      : ' tapa(s)';
    const { rows } = await db.query(
      `INSERT INTO producto_movimientos
         (producto_id, sucursal, usuario_id, tipo, destino, cantidad_tapas, descripcion, nota_id, created_at)
       VALUES ($1, $2, $3, 'venta', $4, $5, $6, $7, $8) RETURNING id`,
      [l.producto_id, SUCURSAL, l.usuario_id, destino, l.cantidad_tapas,
       `${l.cantidad}${etiqueta}`, l.nota_id, l.created_at]);
    movimientos.push(rows[0].id);
  };

  const movEntrada = async (prodId, usuarioId, tipo, destino, tapas, desc, cuando) => {
    const { rows } = await db.query(
      `INSERT INTO producto_movimientos
         (producto_id, sucursal, usuario_id, tipo, destino, cantidad_tapas, descripcion, created_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8) RETURNING id`,
      [prodId, SUCURSAL, usuarioId, tipo, destino, tapas, desc, cuando]);
    movimientos.push(rows[0].id);
  };

  for (const [prodId, ventas] of porProducto) {
    const p = ventas[0];
    stockPrevio.push({ id: prodId, stock_actual: p.stock_actual, stock_granel_tapas: p.stock_granel_tapas });
    // El stock de hoy se toma como el que había hace 90 días: a partir de ahí
    // se simulan compras y ventas, y al final se escribe el saldo resultante.
    let botellas = Number(p.stock_actual);
    let granel   = Number(p.stock_granel_tapas);
    const tapasBotella = (Number(p.botella_ml) > 0 && Number(p.tapa_ml) > 0)
      ? Math.max(1, Math.floor(Number(p.botella_ml) / Number(p.tapa_ml))) : 1;
    const tapasBidon = (Number(p.volumen_envase_ml) > 0 && Number(p.tapa_ml) > 0)
      ? Math.floor(Number(p.volumen_envase_ml) / Number(p.tapa_ml)) : 0;
    const destino = p.clase === 'bolsa' ? 'piezas' : 'botellas';

    for (const l of ventas) {
      const necesita = Number(l.cantidad_tapas);
      // Reabasto: el mostrador repone antes de quedarse sin nada que vender.
      if (botellas - necesita < 8) {
        const cuando = new Date(new Date(l.created_at).getTime() - 2 * 3600 * 1000);
        if (p.clase === 'bolsa') {
          const rollo = Number(p.bolsas_por_rollo) || 80;
          await movEntrada(prodId, l.usuario_id, 'entrada', 'piezas', rollo, '1 rollo', cuando);
          botellas += rollo;
        } else if (p.tipo_liquido === 'granel') {
          const relleno = 10 * tapasBotella;               // 10 botellas del bidón
          if (granel < relleno && tapasBidon > 0) {
            await movEntrada(prodId, l.usuario_id, 'entrada', 'granel', 2 * tapasBidon, '2 bidón(es)', cuando);
            granel += 2 * tapasBidon;
          }
          const pasar = Math.min(relleno, granel);
          if (pasar > 0) {
            await movEntrada(prodId, l.usuario_id, 'rellenar', 'botellas', pasar,
                             `${Math.round(pasar / tapasBotella)} botella(s)`, cuando);
            botellas += pasar; granel -= pasar;
          }
        } else {
          const caja = 12 * tapasBotella;                  // caja de 12 unidades
          await movEntrada(prodId, l.usuario_id, 'entrada', 'botellas', caja, '12 unidad(es)', cuando);
          botellas += caja;
        }
      }
      await movVenta(l, destino);
      botellas -= necesita;
    }
    // Compra reciente de bidones: sin esto el granel termina en las últimas
    // tapas y el inventario abre con la alerta de "por acabarse" encima.
    if (p.tipo_liquido === 'granel' && tapasBidon > 0 && granel < 2 * tapasBidon) {
      const ayer = new Date();
      ayer.setDate(ayer.getDate() - 1);
      ayer.setHours(9, 0, 0, 0);
      await movEntrada(prodId, ventas[ventas.length - 1].usuario_id, 'entrada', 'granel',
                       3 * tapasBidon, '3 bidón(es)', ayer);
      granel += 3 * tapasBidon;
    }
    await db.query('UPDATE productos SET stock_actual = $2, stock_granel_tapas = $3 WHERE id = $1',
                   [prodId, Math.max(0, botellas), Math.max(0, granel)]);
  }

  // Lo de las notas en espera y sin cobrar queda apartado, no consumido.
  for (const l of reservadas) {
    if (!stockPrevio.some(s => s.id === l.producto_id)) {
      stockPrevio.push({ id: l.producto_id, stock_actual: l.stock_actual, stock_granel_tapas: l.stock_granel_tapas });
    }
    await db.query('UPDATE productos SET stock_reservado = stock_reservado + $2 WHERE id = $1',
                   [l.producto_id, Number(l.cantidad_tapas)]);
  }

  // ── Caja: una sesión por día ────────────────────────────────────────────
  const { rows: dias } = await db.query(
    `SELECT to_char(pagado_en AT TIME ZONE 'America/Mexico_City', 'YYYY-MM-DD') AS dia,
            array_agg(id) AS ids
       FROM notas
      WHERE id = ANY($1) AND estado_pago = 'PAGADO' AND estado <> 'CANCELADA'
      GROUP BY 1 ORDER BY 1`, [notas]);

  const { rows: usuarios } = await db.query(
    `SELECT id, rol FROM usuarios WHERE sucursal = $1 AND es_prueba = true ORDER BY id`, [SUCURSAL]);
  const admin = usuarios.find(u => u.rol === 'admin')?.id;
  const empleado = usuarios.find(u => u.rol !== 'admin')?.id ?? admin;


  for (const { dia, ids } of dias) {
    // Todas las sesiones nacen CERRADAS, la del día en curso incluida: una caja
    // abierta se queda apartando las notas que se creen después y el cierre de
    // medianoche acabaría cerrándola sola.
    const abre = `${dia} 08:00:00`;
    const cierra = `${dia} 21:30:00`;
    const inicial = 500;

    const { rows: cRows } = await db.query(
      `INSERT INTO cajas (usuario_apertura_id, estado, monto_inicial, sucursal, abierta_at, notas_apertura)
       VALUES ($1, $2, $3, $4, $5::timestamp AT TIME ZONE 'America/Mexico_City', $6)
       RETURNING id`,
      [pesado([[admin, 6], [empleado, 4]]), 'cerrada', inicial, SUCURSAL, abre,
       'Fondo del día']);
    const cajaId = cRows[0].id;
    cajas.push(cajaId);

    await db.query('UPDATE notas SET caja_id = $2 WHERE id = ANY($1)', [ids, cajaId]);

    // Algún gasto o ingreso suelto del día, como en el mostrador real.
    let entradas = 0, salidas = 0;
    if (rnd() < 0.35) {
      const monto = entre(50, 300);
      const tipo = rnd() < 0.7 ? 'salida' : 'entrada';
      const concepto = tipo === 'salida'
        ? elige(['Compra de jabón', 'Garrafón de agua', 'Pago de mensajería', 'Papelería'])
        : elige(['Depósito del dueño', 'Cambio para el cajón']);
      await db.query(
        `INSERT INTO movimientos_caja (caja_id, usuario_id, tipo, concepto, monto, created_at)
         VALUES ($1, $2, $3, $4, $5, ($6::timestamp + INTERVAL '5 hours') AT TIME ZONE 'America/Mexico_City')`,
        [cajaId, admin, tipo, concepto, monto, abre]);
      if (tipo === 'entrada') entradas += monto; else salidas += monto;
    }

    // Cifras congeladas del corte, con la misma cuenta que ventasDeSesion().
    const { rows: vRows } = await db.query(
      `SELECT COALESCE(SUM(precio_total), 0) AS total,
              COALESCE(SUM(precio_total) FILTER (WHERE COALESCE(forma_pago, 'EFECTIVO') = 'EFECTIVO'), 0) AS efectivo,
              COALESCE(SUM(precio_total) FILTER (WHERE forma_pago = 'TRANSFERENCIA'), 0) AS transferencia,
              COALESCE(SUM(precio_total) FILTER (WHERE forma_pago = 'TARJETA'), 0) AS tarjeta
         FROM notas
        WHERE caja_id = $1 AND estado_pago = 'PAGADO' AND estado <> 'CANCELADA'`, [cajaId]);
    const v = vRows[0];
    const esperado = inicial + Number(v.efectivo) + entradas - salidas;
    // Casi siempre cuadra; de vez en cuando falta o sobra un poco de feria.
    const contado = rnd() < 0.2 ? esperado + entre(-30, 30) : esperado;

    await db.query(
      `UPDATE cajas
          SET estado = 'cerrada', usuario_cierre_id = $2, monto_contado = $3,
              cerrada_at = $4::timestamp AT TIME ZONE 'America/Mexico_City',
              ventas_total = $5, ventas_efectivo = $6, ventas_transferencia = $7,
              ventas_tarjeta = $8, total_entradas = $9, total_salidas = $10
        WHERE id = $1`,
      [cajaId, admin, Math.max(0, contado), cierra,
       v.total, v.efectivo, v.transferencia, v.tarjeta, entradas, salidas]);
  }

  await db.query('COMMIT');
  fs.writeFileSync(REGISTRO, JSON.stringify({ ...reg, cuadrado: true, movimientos, cajas, stockPrevio }, null, 2));
  console.log(`Inventario: ${movimientos.length} movimientos (${consumidas.length} ventas).`);
  console.log(`Caja: ${cajas.length} sesiones, todas cerradas.`);
}

const db = new pg.Client(cfg);
await db.connect();
try {
  if (MODO_DEMO) await verificarBaseSinOperacionReal(db);
  if (process.argv.includes('--limpiar')) await limpiar(db);
  else if (process.argv.includes('--cuadrar')) await cuadrar(db);
  else await sembrar(db);
} catch (e) {
  await db.query('ROLLBACK').catch(() => {});
  console.error('Falló:', e.message);
  process.exitCode = 1;
} finally {
  await db.end();
}
