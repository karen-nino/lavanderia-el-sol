import pool from '../db/pool.js';
import { esAdmin, esAdminMain } from '../middleware/roles.js';
import { notaRequiereCaja } from '../middleware/cajaAbierta.js';
import { tarifaSecadora, precioProductoEnNota, unidadDeVenta, medidasPorUnidad, generarFolio } from '../utils/calculosNotas.js';
// Encender y apagar normalmente lo dispara el trigger LISTEN/NOTIFY. "Encender
// máquina" llama directo para no depender del listener; es idempotente.
import { sincronizarSonoff, maxCiclosDeMaquina } from '../services/sincronizarSonoff.js';
import { sellarPasadasVivas } from '../db/pasadas.js';
import { COBRO_APARTE_ENCARGO } from '../db/sqlProductos.js';
import {
  MINUTOS_CONFIGURADOS, MINUTOS_DEL_MODELO, PROGRAMAS_DEL_MODELO, PRECIOS_DE_PROGRAMAS, OPCIONES_DE_MARCA,
  esCronometroSql, conIniciarSql, soloFichasSql, cronometroActivo, TOPE_RELOJ,
} from '../db/sqlMaquina.js';

const ESTADOS_VALIDOS     = ['EN_ESPERA', 'LAVANDO', 'SECANDO', 'LISTA', 'PAGADA', 'FINALIZADA', 'CANCELADA'];
/** PRODUCTOS es la venta de mostrador: productos sueltos, sin cargas. */
const TIPOS_SERVICIO_VALIDOS = ['AUTOSERVICIO', 'EDREDON', 'POR_ENCARGO', 'PRODUCTOS'];

const esVenta = (tipo_servicio) => tipo_servicio === 'PRODUCTOS';
const ESTADOS_PAGO_VALIDOS = ['PENDIENTE', 'PAGADO'];
/**
 * Solo EFECTIVO entra al cajón; transferencia y tarjeta se cobran pero no
 * cuentan en el esperado del corte.
 */
const FORMAS_PAGO_VALIDAS = ['EFECTIVO', 'TRANSFERENCIA', 'TARJETA'];

/** Forma de pago en mayúsculas, o null si no es válida. */
const normalizarFormaPago = (v) => {
  if (v == null) return null;
  const s = String(v).trim().toUpperCase();
  return FORMAS_PAGO_VALIDAS.includes(s) ? s : null;
};
const TAMANOS_VALIDOS     = ['chico', 'mediano', 'grande', 'jumbo'];
const TIPOS_PRENDA_VALIDOS = ['ROPA', 'EDREDON'];
/** Tipo de máquina previsto por carga; la máquina física se asigna en Salidas. */
const TIPOS_MAQUINA_VALIDOS = ['mediana', 'jumbo', 'edredon'];
/** Día en que estará lista la ropa (opcional). OTRA usa `fecha_entrega`. */
const TIEMPOS_ENTREGA_VALIDOS = ['MANANA', 'DOS_DIAS', 'OTRA'];

/** Valores en MAYÚSCULAS → como se leen en los mensajes ("en espera"). */
const PALABRA = {
  EN_ESPERA: 'en espera', LAVANDO: 'lavando', SECANDO: 'secando', LISTA: 'lista',
  PAGADA: 'pagada', FINALIZADA: 'finalizada', CANCELADA: 'cancelada',
  AUTOSERVICIO: 'autoservicio', EDREDON: 'edredón', POR_ENCARGO: 'por encargo',
  PRODUCTOS: 'productos',
  PENDIENTE: 'pendiente', PAGADO: 'pagado',
  EFECTIVO: 'efectivo', TRANSFERENCIA: 'transferencia', TARJETA: 'tarjeta',
  ROPA: 'ropa', MANANA: 'mañana', TARDE: 'tarde', NOCHE: 'noche',
};
const palabra = (v) => PALABRA[v] ?? String(v ?? '').toLowerCase().replace(/_/g, ' ');

/** ['L1', 'S2'] → "L1 y S2" */
const listaY = (valores) => {
  if (valores.length <= 1) return valores.join('');
  return `${valores.slice(0, -1).join(', ')} y ${valores.at(-1)}`;
};

/** ['chico', 'grande', 'jumbo'] → "chico, grande o jumbo" */
const enPalabras = (valores) => {
  const legibles = valores.map(palabra);
  if (legibles.length <= 1) return legibles.join('');
  return `${legibles.slice(0, -1).join(', ')} o ${legibles.at(-1)}`;
};

/** Estados a los que puede pasar una nota desde cada estado. */
const TRANSICIONES_VALIDAS = {
  // EN_ESPERA → LISTA cierra a mano una nota con cargas que ya no se usarán.
  // Se cobra lo que tenga: conviene quitar antes la carga sin usar.
  EN_ESPERA:  ['LAVANDO', 'SECANDO', 'LISTA', 'CANCELADA'],
  LAVANDO:    ['SECANDO', 'LISTA',            'CANCELADA'],
  SECANDO:    ['LISTA',                       'CANCELADA'],
  LISTA:      ['PAGADA',  'FINALIZADA',       'CANCELADA'],
  PAGADA:     ['FINALIZADA',                  'CANCELADA'],
  FINALIZADA: [],
  CANCELADA:  [],
};

/** Subconsulta: ids de las máquinas asignadas a las cargas de la nota `n`. */
const SQL_MAQUINAS_DE_NOTA = `
  SELECT nc.lavadora_id AS mid FROM nota_cargas nc WHERE nc.nota_id = n.id
  UNION SELECT nc.secadora_id FROM nota_cargas nc WHERE nc.nota_id = n.id`;

/**
 * Fase según las máquinas que ESTA nota arrancó y siguen en uso: LAVANDO si
 * corre una lavadora, si no SECANDO si corre una secadora, si no EN_ESPERA.
 * Otra nota puede tener la misma máquina asignada; su ciclo no cuenta.
 */
async function faseProcesoDeNota(client, notaId) {
  const { rows } = await client.query(
    `SELECT
       EXISTS (
         SELECT 1 FROM nota_cargas nc JOIN maquinas m ON m.id = nc.lavadora_id
          WHERE nc.nota_id = $1 AND m.estado = 'en_uso'
            AND nc.lavadora_iniciada_at IS NOT NULL
       ) AS lavando,
       EXISTS (
         SELECT 1 FROM nota_cargas nc JOIN maquinas m ON m.id = nc.secadora_id
          WHERE nc.nota_id = $1 AND m.estado = 'en_uso'
            AND nc.secadora_iniciada_at IS NOT NULL
       ) AS secando`,
    [notaId]
  );
  if (rows[0].lavando) return 'LAVANDO';
  if (rows[0].secando) return 'SECANDO';
  return 'EN_ESPERA';
}

/**
 * ¿Ya terminó alguna lavadora que arrancó esta nota? Habilita "Procesado".
 * Terminó si la soltó, si ya no corre o, con temporizador, si cumplió su
 * tiempo. Con cronómetro solo cuenta al finalizarla.
 */
async function algunaLavadoraTermino(client, notaId) {
  const { rows } = await client.query(
    `SELECT EXISTS (
       SELECT 1 FROM nota_cargas nc
         LEFT JOIN maquinas m ON m.id = nc.lavadora_id
        WHERE nc.nota_id = $1
          AND nc.lavadora_iniciada_at IS NOT NULL
          AND (
            nc.lavadora_id IS NULL
            OR m.estado <> 'en_uso'
            OR (m.en_uso_desde IS NOT NULL AND m.ciclo_minutos IS NOT NULL
                AND NOT ${esCronometroSql('m')}
                AND m.en_uso_desde + make_interval(mins => m.ciclo_minutos) <= NOW())
          )
     ) AS termino`,
    [notaId]
  );
  return rows[0].termino;
}

/**
 * ¿A la nota le falta trabajo? Una carga está pendiente si tiene una máquina
 * asignada o corriendo, o si pidió lavado o secado que nunca arrancó.
 * Un servicio Por Encargo sin máquina no cuenta: sus máquinas se manejan
 * aparte en Salidas.
 */
async function hayCargasPendientes(client, notaId) {
  const { rows } = await client.query(
    `SELECT EXISTS (
       SELECT 1 FROM nota_cargas nc
        WHERE nc.nota_id = $1
          AND (
            nc.lavadora_id IS NOT NULL
            OR nc.secadora_id IS NOT NULL
            OR (nc.lavadora_tipo IS NOT NULL AND nc.lavadora_iniciada_at IS NULL
                AND nc.lavadora_usada_id IS NULL)
            OR (nc.secadora_tipo IS NOT NULL AND nc.secadora_iniciada_at IS NULL
                AND nc.secadora_usada_id IS NULL)
          )
     ) AS pendientes`,
    [notaId]
  );
  return rows[0].pendientes;
}

/**
 * Estado de una nota a la que ya no le falta ninguna carga:
 * - Autoservicio pagado → FINALIZADA (el cliente se lleva su ropa).
 * - Autoservicio que debe → LISTA, hasta liquidarla (ver cambiarEstadoPago).
 * - Por Encargo → sigue EN_ESPERA: solo "Procesado" la pasa a Por Entregar,
 *   porque falta doblar y empacar.
 * - Edredón y venta de productos → LISTA.
 */
async function estadoAlTerminarCargas(client, notaId) {
  const { rows } = await client.query(
    'SELECT tipo_servicio, estado_pago FROM notas WHERE id = $1',
    [notaId]
  );
  const nota = rows[0];
  if (nota?.tipo_servicio === 'POR_ENCARGO') return 'EN_ESPERA';
  return (nota?.tipo_servicio === 'AUTOSERVICIO' && nota.estado_pago === 'PAGADO')
    ? 'FINALIZADA'
    : 'LISTA';
}

/**
 * Cierra la nota sin cargas pendientes y devuelve su estado. Si queda
 * FINALIZADA, descuenta sus productos del inventario.
 */
async function cerrarNotaSinCargasPendientes(client, notaId, { sucursal, usuarioId }) {
  const estado = await estadoAlTerminarCargas(client, notaId);
  if (estado === 'FINALIZADA') {
    await consumirProductosDeNota(client, notaId, sucursal, usuarioId);
  }
  await client.query('UPDATE notas SET estado = $1 WHERE id = $2', [estado, notaId]);
  return estado;
}

/** Ids, sin repetir, de las máquinas asignadas a la nota. */
async function maquinasDeNota(client, notaId) {
  const { rows } = await client.query(
    `SELECT DISTINCT x.mid
       FROM notas n, LATERAL (${SQL_MAQUINAS_DE_NOTA}) x
      WHERE n.id = $1 AND x.mid IS NOT NULL`,
    [notaId]
  );
  return rows.map(r => r.mid);
}

/**
 * Nota (id, folio) que está usando la máquina ahora, sin contar
 * `notaIdExcluir`. Asignar no aparta: la primera nota que le da a "Iniciar" se
 * la queda y las demás tienen que cambiarla. Sirve para el aviso de quién la usa.
 */
async function notaQueUsaMaquina(client, maquinaId, notaIdExcluir = null) {
  const { rows } = await client.query(
    `SELECT n.id, n.folio
       FROM notas n
      WHERE n.estado IN ('LAVANDO', 'SECANDO')
        AND ($2::int IS NULL OR n.id <> $2)
        AND EXISTS (
          SELECT 1 FROM nota_cargas nc
           WHERE nc.nota_id = n.id
             AND (nc.lavadora_id = $1 OR nc.secadora_id = $1)
        )
      ORDER BY n.created_at ASC
      LIMIT 1`,
    [maquinaId, notaIdExcluir]
  );
  return rows[0] ?? null;
}

/**
 * Marca en las cargas que ESTA nota arrancó esas máquinas. Distingue usar una
 * máquina de solo tenerla asignada (varias notas pueden tener la misma); se usa
 * para liberar máquinas y en el reporte de uso.
 */
async function marcarMaquinasIniciadas(client, notaId, maquinaIds) {
  if (!maquinaIds || maquinaIds.length === 0) return;
  await client.query(
    `UPDATE nota_cargas
        SET lavadora_iniciada_at = CASE WHEN lavadora_id = ANY($2) AND lavadora_iniciada_at IS NULL
                                        THEN NOW() ELSE lavadora_iniciada_at END,
            secadora_iniciada_at = CASE WHEN secadora_id = ANY($2) AND secadora_iniciada_at IS NULL
                                        THEN NOW() ELSE secadora_iniciada_at END
      WHERE nota_id = $1`,
    [notaId, maquinaIds.map(Number)]
  );
}

/**
 * Apaga y suelta las máquinas que esta nota encendió y nadie arrancó, para que
 * no queden con corriente sin nota. Si ya arrancaron (`en_uso_desde`), no las
 * toca. La usan eliminar, cancelar y pasar a Por Entregar.
 */
async function apagarEncendidasSinArrancar(client, notaId) {
  await client.query(
    `UPDATE maquinas
        SET encendida_sin_iniciar_at = NULL,
            encendida_para_nota_id   = NULL,
            estado = CASE WHEN estado = 'en_uso' AND en_uso_desde IS NULL
                          THEN 'disponible'::estado_maquina ELSE estado END
      WHERE encendida_para_nota_id = $1`,
    [notaId]
  );
}

/**
 * Pasa a disponible las máquinas que esta nota arrancó y siguen en uso, y apaga
 * las que encendió sin arrancar. Las que solo tiene asignadas no se tocan:
 * pueden estar corriendo para otra nota.
 */
async function liberarMaquinasDeNota(client, notaId) {
  await apagarEncendidasSinArrancar(client, notaId);
  const { rows } = await client.query(
    `SELECT DISTINCT mid FROM (
       SELECT lavadora_id AS mid FROM nota_cargas
        WHERE nota_id = $1 AND lavadora_iniciada_at IS NOT NULL
       UNION
       SELECT secadora_id FROM nota_cargas
        WHERE nota_id = $1 AND secadora_iniciada_at IS NOT NULL
     ) x WHERE mid IS NOT NULL`,
    [notaId]
  );
  const ids = rows.map(r => r.mid);
  if (ids.length === 0) return;
  // Su uso queda con hora de fin, como si la hubieran finalizado.
  await sellarPasadasVivas(client, ids);
  await client.query(
    `UPDATE maquinas SET estado = 'disponible', en_uso_desde = NULL
      WHERE id = ANY($1) AND estado = 'en_uso'`,
    [ids]
  );
}

/**
 * El total no puede quedar por debajo de lo ya abonado: el corte esperaría
 * menos dinero del que entró. Para bajarlo, primero se revierte el abono.
 */
class TotalBajoAbonosError extends Error {
  constructor(abonado, total) {
    super(`El cliente ya abonó $${abonado.toFixed(2)}: el total no puede quedar en `
        + `$${total.toFixed(2)}. Si hay que devolverle dinero, revierte primero su abono.`);
    this.name = 'TotalBajoAbonosError';
  }
}

/**
 * El cobro de la nota ya está en un corte cerrado (con cifras congeladas): su
 * total no se puede cambiar, o ese dinero se contaría dos veces. Un corte
 * cerrado no se reabre; lo que falte se cobra o devuelve aparte.
 */
class CorteCerradoError extends Error {
  constructor(folio) {
    super(`El cobro de la nota ${folio} ya quedó en un corte cerrado, así que no se puede `
        + 'cambiar lo que cuesta: la nota volvería a pendiente y ese dinero ya está contado '
        + 'en aquel corte. Si falta cobrar algo, hazlo en una nota nueva; si hay que devolver, '
        + 'regístralo como salida de caja.');
    this.name = 'CorteCerradoError';
  }
}

/** Un descuento (ajuste) no puede dejar el total de la nota en negativo. */
class TotalNegativoError extends Error {
  constructor() {
    super('El total de la nota no puede ser negativo. Revisa el ajuste (descuento) antes de quitar o reducir algo.');
    this.name = 'TotalNegativoError';
  }
}

/**
 * Responde los errores de `recalcularPrecioTotal` como reglas de negocio (400 o
 * 409 con su motivo) en vez de un 500. Devuelve true si ya respondió.
 */
export function respondioCorteCerrado(res, err) {
  if (err instanceof TotalNegativoError) {
    res.status(400).json({ message: err.message });
    return true;
  }
  if (!(err instanceof CorteCerradoError) && !(err instanceof TotalBajoAbonosError)) return false;
  res.status(409).json({ message: err.message });
  return true;
}

/**
 * Recalcula y guarda `precio_total`. Por carga:
 * - Por Encargo con precio de servicio (tope): el tope + los productos que se
 *   venden por unidad (marca y polvo). El granel y la bolsa ya van en el tope.
 * - Lo demás: máquinas + productos de la carga.
 * Más el ajuste de cada carga, los productos sueltos de la nota y el ajuste de
 * la nota.
 *
 * Con `desmarcarPagoSiCambia`, una nota PAGADA cuyo total cambia vuelve a
 * PENDIENTE para cobrarla por el importe nuevo (y deja aviso en la campana).
 *
 * @throws {TotalNegativoError} si el total queda negativo.
 * @throws {TotalBajoAbonosError} si queda por debajo de lo abonado.
 * @throws {CorteCerradoError} si el cobro ya está en un corte cerrado.
 */
export async function recalcularPrecioTotal(client, notaId, opciones = {}) {
  const { desmarcarPagoSiCambia = false, usuarioId = null, sucursal = null } = opciones;
  const { rows: previas } = desmarcarPagoSiCambia
    ? await client.query(
        'SELECT id, folio, precio_total, estado_pago, caja_id FROM notas WHERE id = $1',
        [notaId]
      )
    : { rows: [] };

  // Candado sobre su caja para que un cierre simultáneo no congele la venta
  // mientras aquí la nota vuelve a PENDIENTE. Consulta aparte: Postgres no
  // bloquea el lado nulo de un LEFT JOIN.
  if (previas[0]?.caja_id) {
    const { rows: cj } = await client.query(
      'SELECT estado FROM cajas WHERE id = $1 FOR SHARE', [previas[0].caja_id]
    );
    previas[0].caja_estado = cj[0]?.estado ?? null;
  }
  const { rows } = await client.query(
    `UPDATE notas n
        SET precio_total =
          COALESCE((
            SELECT SUM(
              CASE
                -- Por Encargo: el precio del servicio + lo que se vende por unidad.
                WHEN n.tipo_servicio = 'POR_ENCARGO' AND carga.tope IS NOT NULL
                  THEN carga.tope + carga.productos_marca
                ELSE carga.maquinas + carga.productos
              END
              + carga.ajuste)
            FROM (
              -- El tope congelado en la carga: cambiar Ajustes no re-tarifa notas.
              SELECT nc.ajuste, nc.precio_tope AS tope,
                     -- Con las fichas de más de la secadora de fichas (Autoservicio).
                     nc.precio_lavadora + nc.precio_secadora + nc.precio_fichas_extra AS maquinas,
                     COALESCE((SELECT SUM(np.cantidad * np.precio_unitario)
                                 FROM nota_productos np WHERE np.carga_id = nc.id), 0) AS productos,
                     COALESCE((SELECT SUM(np.cantidad * np.precio_unitario)
                                 FROM nota_productos np
                                 JOIN productos a ON a.id = np.producto_id
                                WHERE np.carga_id = nc.id
                                  AND a.se_vende_por_unidad), 0) AS productos_marca
                FROM nota_cargas nc
               WHERE nc.nota_id = n.id
            ) carga
          ), 0)
          -- Productos sueltos. En Por Encargo solo lo que se cobra aparte: marca,
          -- polvo y las bolsas de más (ver COBRO_APARTE_ENCARGO).
          + COALESCE((SELECT SUM(CASE WHEN n.tipo_servicio <> 'POR_ENCARGO'
                                      THEN np.cantidad * np.precio_unitario
                                      ELSE ${COBRO_APARTE_ENCARGO('np', 'a', 'n')} END)
                        FROM nota_productos np
                        JOIN productos a ON a.id = np.producto_id
                       WHERE np.nota_id = n.id AND np.carga_id IS NULL), 0)
          + n.ajuste
      WHERE n.id = $1
      RETURNING precio_total`,
    [notaId]
  );
  const nuevo = rows[0]?.precio_total ?? null;

  if (nuevo != null && Number(nuevo) < 0) throw new TotalNegativoError();

  // Quien llama está en una transacción: su catch la deshace.
  const abonado = await totalAbonado(client, notaId);
  if (abonado > 0 && Number(nuevo) < abonado - 1e-9) {
    throw new TotalBajoAbonosError(abonado, Number(nuevo));
  }

  const antes = previas[0];
  if (antes && antes.estado_pago === 'PAGADO' && Number(nuevo) !== Number(antes.precio_total)) {
    // Un cobro sin caja no está en ningún corte y sí se puede deshacer.
    if (antes.caja_id && antes.caja_estado !== 'abierta') {
      throw new CorteCerradoError(antes.folio ?? `#${antes.id}`);
    }
    await desmarcarPagoPorCambio(client, antes, Number(antes.precio_total), Number(nuevo), usuarioId, sucursal);
  }
  return nuevo;
}

/**
 * Devuelve a PENDIENTE una nota cuyo total cambió y deja aviso en la campana
 * con los dos importes. Un trigger limpia `pagado_en`.
 */
async function desmarcarPagoPorCambio(client, nota, antes, ahora, usuarioId, sucursal) {
  await client.query(
    "UPDATE notas SET estado_pago = 'PENDIENTE', forma_pago = NULL WHERE id = $1",
    [nota.id]
  );
  if (!sucursal) return;
  const fmt = (n) => `$${Number(n).toFixed(2)}`;
  const etiqueta = nota.folio ?? `#${nota.id}`;
  const verbo = ahora > antes ? 'subió' : 'bajó';
  await client.query(
    `INSERT INTO notificaciones (tipo, mensaje, usuario_id, sucursal)
     VALUES ('pago_desmarcado', $1, $2, $3)`,
    [`La nota ${etiqueta} ${verbo} de ${fmt(antes)} a ${fmt(ahora)} tras un cambio: quedó PENDIENTE de cobro`,
     usuarioId, sucursal]
  );
}


/** Tarifas y precios de servicio desde Ajustes, con valores por defecto. */
async function tarifasCarga(client) {
  const { rows } = await client.query(
    `SELECT precio_carga_mediana, precio_carga_jumbo,
            precio_carga_secadora, precio_secadora_jumbo, precio_edredon_jumbo,
            tope_carga_chico, tope_carga_mediano, tope_carga_grande, tope_carga_jumbo, tope_carga_edredon
       FROM ajustes WHERE id = 1`
  );
  const c = rows[0] ?? {};
  return {
    mediana:         c.precio_carga_mediana    != null ? Number(c.precio_carga_mediana)    : 70,
    jumbo:           c.precio_carga_jumbo      != null ? Number(c.precio_carga_jumbo)      : 70,
    // precio_carga_secadora es la secadora mediana.
    secadora:       c.precio_carga_secadora   != null ? Number(c.precio_carga_secadora)   : 45,
    secadoraJumbo:   c.precio_secadora_jumbo   != null ? Number(c.precio_secadora_jumbo)   : 45,
    // Ajustes → Máquinas → Lavadora → Edredón.
    edredonJumbo:   c.precio_edredon_jumbo    != null ? Number(c.precio_edredon_jumbo)    : 80,
    // Precio de cada servicio Por Encargo. null = sin configurar.
    topeChico:      c.tope_carga_chico   != null ? Number(c.tope_carga_chico)   : null,
    topeMediano:     c.tope_carga_mediano != null ? Number(c.tope_carga_mediano) : null,
    topeGrande:      c.tope_carga_grande  != null ? Number(c.tope_carga_grande)  : null,
    topeJumbo:       c.tope_carga_jumbo   != null ? Number(c.tope_carga_jumbo)   : null,
    topeEdredon:     c.tope_carga_edredon != null ? Number(c.tope_carga_edredon) : null,
    preciosEdredon: await preciosEdredon(client),
  };
}

/**
 * Precio de cada tamaño de edredón (nombre en minúsculas → precio o null).
 * Incluye los inactivos, para que una nota que ya los usa conserve su precio.
 */
async function preciosEdredon(client) {
  const { rows } = await client.query('SELECT nombre, precio FROM tamanos_edredon');
  return new Map(rows.map(r => [
    String(r.nombre).trim().toLowerCase(),
    r.precio != null ? Number(r.precio) : null,
  ]));
}

/**
 * Precio del servicio (tope) según prenda y tamaño; el edredón, según su tamaño.
 * Se congela en `nota_cargas.precio_tope` al crear la carga. null = sin tope:
 * se cobra la suma de lo que lleva.
 */
function topeDeCarga(prenda, tamano, t, tamanoEdredon) {
  if (String(prenda ?? '').toUpperCase() === 'EDREDON') {
    const nombre = String(tamanoEdredon ?? '').trim().toLowerCase();
    if (!nombre) return t.topeEdredon;
    return t.preciosEdredon?.get(nombre) ?? null;
  }
  switch (tamano) {
    case 'chico':   return t.topeChico;
    case 'mediano': return t.topeMediano;
    case 'grande':  return t.topeGrande;
    case 'jumbo':  return t.topeJumbo;
    default:       return null;
  }
}

/**
 * Servicios Por Encargo a la venta: Chico, Mediano, Grande y Edredón (este se
 * reconoce por la prenda). Jumbo de ropa no se vende, pero sigue siendo válido
 * en notas existentes.
 */
const esServicioQueSeVende = (prenda, tamano) =>
  String(prenda ?? '').toUpperCase() === 'EDREDON' || ['chico', 'mediano', 'grande'].includes(tamano);

/**
 * Costo de las máquinas de un servicio Por Encargo, que gasta de su tope igual
 * que el material: Chico, Mediano y Grande usan lavadora y secadora medianas;
 * el Edredón, la lavadora jumbo (su secado no cuenta).
 */
function costoMaquinasDeServicio(prenda, tamano, t) {
  if (String(prenda ?? '').toUpperCase() === 'EDREDON') return Number(t.edredonJumbo) || 0;
  if (tamano === 'jumbo')  return (Number(t.jumbo)   || 0) + (Number(t.secadora) || 0);
  if (['chico', 'mediano', 'grande'].includes(tamano)) {
    return (Number(t.mediana) || 0) + (Number(t.secadora) || 0);
  }
  return 0;
}

/** Nombre del servicio como se ve en pantalla, para los mensajes. */
function nombreServicio(prenda, tamano, tamanoEdredon) {
  if (String(prenda ?? '').toUpperCase() === 'EDREDON') {
    return tamanoEdredon ? `Edredón ${String(tamanoEdredon).trim()}` : 'Edredón';
  }
  switch (tamano) {
    case 'chico':   return 'Chico';
    case 'mediano': return 'Mediano';
    case 'grande':  return 'Grande';
    case 'jumbo':   return 'Jumbo';
    default:        return 'sin tamaño';
  }
}

/**
 * Minutos de ciclo de respaldo por tamaño, desde Ajustes. Solo se usan si la
 * máquina no tiene tiempo configurado por modelo o marca.
 */
async function tiemposCarga(client) {
  const { rows } = await client.query(
    `SELECT tiempo_carga_mediana, tiempo_carga_jumbo,
            tiempo_carga_secadora, tiempo_secadora_jumbo
       FROM ajustes WHERE id = 1`
  );
  const c = rows[0] ?? {};
  // `tiempo_carga_secadora` es la secadora mediana; la jumbo cae en ella si no
  // tiene tiempo propio.
  const secMediana = c.tiempo_carga_secadora != null ? Number(c.tiempo_carga_secadora) : 30;
  return {
    mediana:    c.tiempo_carga_mediana  != null ? Number(c.tiempo_carga_mediana)  : 30,
    jumbo:      c.tiempo_carga_jumbo    != null ? Number(c.tiempo_carga_jumbo)    : 45,
    secMediana,
    secJumbo:   c.tiempo_secadora_jumbo != null ? Number(c.tiempo_secadora_jumbo) : secMediana,
  };
}

/** Precio de lavadora. El edredón tiene tarifa propia en cualquier lavadora. */
function tarifaLavadora(tipoMaquina, tipoPrenda, t) {
  if (String(tipoPrenda).toUpperCase() === 'EDREDON') return t.edredonJumbo;
  if (tipoMaquina === 'lavadora_jumbo') return t.jumbo;
  return t.mediana;
}

/**
 * Guarda `ciclo_minutos` en las máquinas que esta nota arrancó y siguen en uso.
 * Los minutos son de la máquina: modelo, luego marca y tamaño, y si no, el
 * respaldo de Ajustes. Con cronómetro son su tope. Idempotente.
 *
 * `elegido` ({ maquinaId, minutos }) es el programa escogido al iniciar un
 * modelo que pregunta: con cronómetro se guarda en `ciclo_elegido_minutos` (el
 * tope no cambia); con temporizador reemplaza la duración.
 */
async function sellarCicloMaquinas(client, notaId, elegido = null) {
  const ti = await tiemposCarga(client);
  await client.query(
    `UPDATE maquinas m
        -- Una que ya corría con fichas de más conserva el tope que le subieron.
        SET ciclo_minutos = CASE WHEN m.minutos_pagados IS NOT NULL AND m.en_uso_desde <> NOW()
                                 THEN m.ciclo_minutos ELSE ciclos.minutos END,
            -- Si arrancó en esta transacción (en_uso_desde = NOW()), limpia el
            -- programa y lo sumado de la vuelta anterior.
            ciclo_elegido_minutos = CASE WHEN m.en_uso_desde = NOW() THEN NULL
                                         ELSE m.ciclo_elegido_minutos END,
            minutos_pagados = CASE WHEN m.en_uso_desde = NOW() THEN NULL
                                   ELSE m.minutos_pagados END
       FROM (
         -- Lavadoras de la nota
         SELECT nc.lavadora_id AS mid,
                -- El modelo de solo fichas no tiene tope.
                CASE WHEN COALESCE(mo.solo_fichas, FALSE) THEN NULL
                     ELSE COALESCE(
                       ${MINUTOS_DEL_MODELO('mo')},
                       tm.minutos,
                       CASE WHEN ml.tipo = 'lavadora_jumbo' THEN $2::int ELSE $3::int END
                     )
                END AS minutos
           FROM nota_cargas nc
           JOIN maquinas ml ON ml.id = nc.lavadora_id
           -- La máquina guarda marca y modelo por nombre. Misma cadena que
           -- MINUTOS_CONFIGURADOS: modelo, luego marca.
           LEFT JOIN marcas_maquina mm ON mm.nombre = ml.marca
           LEFT JOIN modelos_maquina mo
                  ON mo.marca_id = mm.id AND mo.nombre = ml.modelo
           LEFT JOIN tiempos_marca tm
                  ON tm.marca_id = mm.id AND tm.tipo = 'lavadora' AND tm.tamano = ml.tamano
          WHERE nc.nota_id = $1 AND nc.lavadora_id IS NOT NULL
            AND nc.lavadora_iniciada_at IS NOT NULL
         UNION ALL
         -- Secadoras de la nota, con el mismo criterio.
         SELECT nc.secadora_id AS mid,
                CASE WHEN COALESCE(mo.solo_fichas, FALSE) THEN NULL
                     ELSE COALESCE(
                       ${MINUTOS_DEL_MODELO('mo')}, tm.minutos,
                       CASE WHEN ms.tamano = 'jumbo' THEN $5::int ELSE $4::int END
                     )
                END AS minutos
           FROM nota_cargas nc
           JOIN maquinas ms ON ms.id = nc.secadora_id
           LEFT JOIN marcas_maquina mm ON mm.nombre = ms.marca
           LEFT JOIN modelos_maquina mo
                  ON mo.marca_id = mm.id AND mo.nombre = ms.modelo
           LEFT JOIN tiempos_marca tm
                  ON tm.marca_id = mm.id AND tm.tipo = 'secadora' AND tm.tamano = ms.tamano
          WHERE nc.nota_id = $1 AND nc.secadora_id IS NOT NULL
            AND nc.secadora_iniciada_at IS NOT NULL
       ) ciclos
      WHERE m.id = ciclos.mid AND m.estado = 'en_uso'`,
    [notaId, ti.jumbo, ti.mediana, ti.secMediana, ti.secJumbo]
  );

  if (elegido) {
    await client.query(
      cronometroActivo()
        ? `UPDATE maquinas SET ciclo_elegido_minutos = $2 WHERE id = $1 AND estado = 'en_uso'`
        : `UPDATE maquinas SET ciclo_minutos = $2 WHERE id = $1 AND estado = 'en_uso'`,
      [elegido.maquinaId, elegido.minutos]
    );
  }
}

/**
 * Valida el programa elegido al iniciar: tiene que ser uno de los que ofrece el
 * modelo de la máquina. Devuelve `{ minutos }`, `{ error }`, o null si no llegó.
 */
async function tiempoElegidoDeMaquina(client, maquinaId, minutos) {
  if (minutos === undefined || minutos === null || minutos === '') return null;
  const n = Number(minutos);
  if (!Number.isInteger(n) || n <= 0) {
    return { error: 'El tiempo elegido no es válido.' };
  }
  const { rows } = await client.query(
    `SELECT mo.pregunta_tiempo,
            ${PROGRAMAS_DEL_MODELO('mo')} AS tiempos
       FROM maquinas m
       JOIN marcas_maquina mm ON mm.nombre = m.marca
       JOIN modelos_maquina mo ON mo.marca_id = mm.id AND mo.nombre = m.modelo
      WHERE m.id = $1`,
    [maquinaId]
  );
  const modelo = rows[0];
  if (!modelo || !modelo.pregunta_tiempo || !(modelo.tiempos ?? []).includes(n)) {
    return { error: 'Esa máquina no ofrece ese tiempo de ciclo.' };
  }
  return { minutos: n };
}

/**
 * Precio de cada programa del modelo de la máquina (Sec49): Map minutos →
 * precio (null = ese programa va por tamaño), o null si su modelo no cobra por
 * programa (no pregunta, tiene un solo programa o ninguno lleva precio).
 */
async function preciosDePrograma(client, maquinaId) {
  const { rows } = await client.query(
    `SELECT mo.pregunta_tiempo,
            ${PROGRAMAS_DEL_MODELO('mo')} AS tiempos,
            ${PRECIOS_DE_PROGRAMAS('mo')} AS precios
       FROM maquinas m
       JOIN marcas_maquina mm ON mm.nombre = m.marca
       JOIN modelos_maquina mo ON mo.marca_id = mm.id AND mo.nombre = m.modelo
      WHERE m.id = $1 AND m.tipo = 'secadora'`,
    [maquinaId]
  );
  const mo = rows[0];
  if (!mo || !mo.pregunta_tiempo || (mo.tiempos ?? []).length < 2) return null;
  if (!(mo.precios ?? []).some(p => p != null)) return null;
  return new Map(mo.tiempos.map((min, i) => [
    Number(min), mo.precios[i] == null ? null : Number(mo.precios[i]),
  ]));
}

/**
 * Precio de la secadora al ponerla en una carga de Autoservicio. La que cobra
 * por programa queda "por definir" ($0) hasta que al iniciarla se elija.
 */
async function precioSecadoraAutoservicio(client, maquina, tipoPrenda, t) {
  if (await preciosDePrograma(client, maquina.id)) return { precio: 0, porDefinir: true };
  return { precio: tarifaSecadora(maquina.tamano, tipoPrenda, t), porDefinir: false };
}

/**
 * Al iniciar la secadora que cobra por programa: sus cargas por definir toman
 * el precio del programa elegido (o el de su tamaño si ese no tiene precio).
 * Devuelve cuántas cargas cambiaron.
 */
async function cobrarProgramaDeSecadora(client, notaId, secadoraId, minutos, t) {
  const precios = await preciosDePrograma(client, secadoraId);
  const precio = precios?.get(Number(minutos)) ?? tarifaSecadora(null, null, t);
  const { rowCount } = await client.query(
    `UPDATE nota_cargas SET precio_secadora = $3, secadora_por_definir = FALSE
      WHERE nota_id = $1 AND secadora_id = $2 AND secadora_por_definir`,
    [notaId, secadoraId, precio]
  );
  return rowCount;
}

/** Mensaje si la nota tiene una secadora por definir (no se puede liquidar), o null. */
async function secadoraPorDefinir(client, notaId) {
  const { rows } = await client.query(
    `SELECT m.nombre
       FROM nota_cargas nc
       LEFT JOIN maquinas m ON m.id = nc.secadora_id
      WHERE nc.nota_id = $1 AND nc.secadora_por_definir
      ORDER BY nc.orden LIMIT 1`,
    [notaId]
  );
  if (rows.length === 0) return null;
  const nombre = rows[0].nombre ? `${rows[0].nombre} ` : '';
  return `Inicia la secadora ${nombre}para saber cuánto cobrar: su precio depende del tiempo que se elija.`;
}

/**
 * Solo Por Encargo: lo que cuesta cada servicio (máquinas + material servido)
 * no puede pasar de su precio (tope), y el material de toda la nota no puede
 * pasar de lo que se cobra por sus servicios. Aplica a todos los roles.
 * Se llama antes del COMMIT en las rutas que encarecen una carga.
 *
 * @returns {Promise<string|null>} el mensaje de error, o null si todo cabe.
 */
async function validarTopesCargas(client, notaId) {
  const { rows } = await client.query(
    `SELECT nc.orden, nc.tamano, nc.tipo_prenda,
            UPPER(COALESCE(nc.tipo_prenda, '')) = 'EDREDON' AS es_edredon,
            nc.tamano_edredon,
            nc.precio_lavadora + nc.precio_secadora AS maquinas,
            -- Cuenta lo servido (granel y bolsa); lo que se vende por unidad va aparte.
            COALESCE(SUM(CASE WHEN a.se_vende_por_unidad THEN 0
                              ELSE np.cantidad * np.precio_unitario END), 0) AS productos,
            nc.precio_tope AS tope
       FROM nota_cargas nc
       JOIN notas n ON n.id = nc.nota_id
       LEFT JOIN nota_productos np ON np.carga_id = nc.id
       LEFT JOIN productos a ON a.id = np.producto_id
      WHERE nc.nota_id = $1 AND n.tipo_servicio = 'POR_ENCARGO'
        AND (nc.tamano IS NOT NULL OR UPPER(COALESCE(nc.tipo_prenda, '')) = 'EDREDON')
      GROUP BY nc.id
      ORDER BY nc.orden`,
    [notaId]
  );
  const fmt = (n) => `$${Number(n).toFixed(2)}`;
  const t = await tarifasCarga(client);
  // Costo de máquinas: el guardado en la carga o, si no tiene, el que le toca
  // al servicio.
  const maquinasDe = (r) => {
    const guardado = Number(r.maquinas) || 0;
    return guardado > 0 ? guardado : costoMaquinasDeServicio(r.tipo_prenda, r.tamano, t);
  };

  // Primero cada servicio, para decir cuál se pasó y por cuánto.
  for (const r of rows) {
    if (r.tope == null) continue;
    const total = maquinasDe(r) + Number(r.productos);
    if (total > Number(r.tope) + 1e-9) {
      const servicio = nombreServicio(r.es_edredon ? 'EDREDON' : 'ROPA', r.tamano, r.tamano_edredon);
      const desglose = `máquinas ${fmt(maquinasDe(r))} + material ${fmt(r.productos)} = ${fmt(total)}`;
      return `El servicio ${servicio} (carga ${r.orden}) se cobra en ${fmt(r.tope)} y ${desglose}. `
        + `Baja $${(total - Number(r.tope)).toFixed(2)}: quita algún producto o la bolsa, `
        + 'o sube el precio del servicio en Ajustes.';
    }
  }

  // Después la nota completa: máquinas de los servicios + todo el material
  // servido contra lo que se cobra por los servicios. Las máquinas agregadas en
  // Salidas no cuentan: no cobran ni traen presupuesto.
  const { rows: totales } = await client.query(
    `SELECT
       -- El ajuste de la nota cambia lo que se cobra, así que entra al presupuesto.
       COALESCE((SELECT SUM(nc2.precio_tope) FROM nota_cargas nc2 WHERE nc2.nota_id = $1), 0)
         + n.ajuste AS presupuesto,
       -- Lo servido que va en los servicios: sin las bolsas de más, que se cobran aparte.
       COALESCE((SELECT SUM(np.cantidad * np.precio_unitario - ${COBRO_APARTE_ENCARGO('np', 'a', 'n')})
                   FROM nota_productos np
                   JOIN productos a ON a.id = np.producto_id
                  WHERE np.nota_id = $1 AND NOT a.se_vende_por_unidad), 0) AS material
       FROM notas n
      WHERE n.id = $1 AND n.tipo_servicio = 'POR_ENCARGO'`,
    [notaId]
  );
  const tot = totales[0];
  // Solo si hay servicios con precio.
  const hayServicios = rows.some(r => r.tope != null);
  if (tot && hayServicios) {
    const maquinas = rows.reduce((a, r) => a + (r.tope == null ? 0 : maquinasDe(r)), 0);
    const usado = maquinas + Number(tot.material);
    if (usado > Number(tot.presupuesto) + 1e-9) {
      return `El material de la nota suma ${fmt(usado)} y los servicios se cobran en ${fmt(tot.presupuesto)}. `
        + `Baja $${(usado - Number(tot.presupuesto)).toFixed(2)}: quita productos o sube el precio de los servicios en Ajustes.`;
    }
  }

  return null;
}

/**
 * Aparta un producto en la nota (o en una carga): valida existencia, suma al
 * renglón si ya estaba o crea uno, y sube `stock_reservado`.
 *
 * @throws {Error} con el mensaje para el usuario si no existe o no alcanza.
 */
async function reservarProducto(client, notaId, cargaId, productoId, cantidad, sucursal, tipo_servicio) {
  const { rows: artRows } = await client.query(
    'SELECT * FROM productos WHERE id = $1 AND sucursal = $2 FOR UPDATE',
    [productoId, sucursal]
  );
  if (artRows.length === 0) {
    throw new Error(`Producto ${productoId} no encontrado.`);
  }
  const art = artRows[0];
  // Bolsa: por pieza. Granel: botella en Autoservicio, medida en Por Encargo.
  // Marca y polvo: siempre por unidad.
  const esBolsa = art.clase === 'bolsa';
  const unidad = esBolsa ? 'pieza' : unidadDeVenta(art, tipo_servicio);
  const tpu = esBolsa ? 1 : medidasPorUnidad(art, unidad);
  const precioUnit = esBolsa ? (Number(art.precio_unitario) || 0) : precioProductoEnNota(art, tipo_servicio);
  const cantidadMedidas = Number(cantidad) * tpu;
  const disponibleMedidas = Number(art.stock_actual) - Number(art.stock_reservado);
  if (disponibleMedidas < cantidadMedidas) {
    const dispUnidad = unidad === 'botella' ? Math.floor(disponibleMedidas / tpu) : disponibleMedidas;
    const nombreArt = esBolsa && art.tamano_bolsa ? `Bolsa ${art.tamano_bolsa}` : art.nombre;
    const uni = esBolsa ? 'bolsa(s)' : unidad === 'botella' ? 'botella(s)' : 'medida(s)';
    throw new Error(`No hay suficiente existencia de "${nombreArt}": quedan ${dispUnidad} ${uni} y se necesitan ${cantidad}. Carga más en Inventario o quítalo de la nota.`);
  }
  // Si ya está en la nota (y en la misma carga) se suma al mismo renglón.
  const { rows: npRows } = await client.query(
    `INSERT INTO nota_productos (nota_id, carga_id, producto_id, cantidad, unidad, precio_unitario, cantidad_medidas)
          SELECT $1, $2, $3, $4, $5, $6, $7
           WHERE NOT EXISTS (
                 SELECT 1 FROM nota_productos
                  WHERE nota_id = $1 AND producto_id = $3
                    AND carga_id IS NOT DISTINCT FROM $2)
     RETURNING *`,
    [notaId, cargaId, productoId, cantidad, unidad, precioUnit, cantidadMedidas]
  );
  if (npRows.length === 0) {
    const { rows } = await client.query(
      `UPDATE nota_productos
          SET cantidad       = cantidad + $4,
              cantidad_medidas = cantidad_medidas + $5
        WHERE nota_id = $1 AND producto_id = $3 AND carga_id IS NOT DISTINCT FROM $2
     RETURNING *`,
      // El precio del renglón no cambia: es el que se congeló al ponerlo.
      [notaId, cargaId, productoId, cantidad, cantidadMedidas]
    );
    npRows.push(rows[0]);
  }
  await client.query(
    'UPDATE productos SET stock_reservado = stock_reservado + $1 WHERE id = $2',
    [cantidadMedidas, productoId]
  );
  return { ...npRows[0], nombre: art.nombre, subtotal: Number(npRows[0].cantidad) * Number(npRows[0].precio_unitario) };
}

/** Suelta lo apartado por los productos de una nota y los borra. */
async function liberarProductosDeNota(client, notaId) {
  await client.query(
    `UPDATE productos a
        SET stock_reservado = stock_reservado - np.cantidad_medidas
      FROM nota_productos np
      WHERE np.nota_id = $1 AND np.producto_id = a.id`,
    [notaId]
  );
  await client.query('DELETE FROM nota_productos WHERE nota_id = $1', [notaId]);
}

/**
 * Registra en el historial de inventario un movimiento por renglón de la nota
 * ('venta' al descontar, 'liberacion' al devolver), opcionalmente solo de `ids`.
 * Copia el folio para que el movimiento lo conserve si la nota se borra.
 */
async function registrarMovimientosProductosNota(client, notaId, sucursal, usuarioId, tipo, ids = null) {
  await client.query(
    `INSERT INTO producto_movimientos
       (producto_id, sucursal, usuario_id, tipo, destino, cantidad_medidas, descripcion, nota_id, nota_folio)
     SELECT np.producto_id, $2, $3, $4,
            (CASE WHEN a.clase = 'bolsa' THEN 'piezas' ELSE 'botellas' END),
            np.cantidad_medidas,
            np.cantidad || (CASE
                              WHEN np.unidad = 'pieza' THEN ' bolsa(s)'
                              WHEN np.unidad = 'botella'
                                THEN (CASE WHEN a.se_vende_por_unidad THEN ' unidad(es)' ELSE ' botella(s)' END)
                              ELSE ' medida(s)' END),
            np.nota_id,
            n.folio
       FROM nota_productos np
       JOIN productos a ON a.id = np.producto_id
       JOIN notas n     ON n.id = np.nota_id
      WHERE np.nota_id = $1
        AND ($5::int[] IS NULL OR np.id = ANY($5::int[]))`,
    [notaId, sucursal, usuarioId ?? null, tipo, ids]
  );
}

// ── Inventario de la nota, por renglón ──
// `nota_productos.consumido_at`: NULL = apartado; con fecha = ya salió del
// estante. El granel de los servicios sale al terminar la primera lavadora; lo
// demás, al cobrar o entregar.

/** Condición SQL: granel líquido de un servicio (el que se elige en Salidas). */
const SQL_GRANEL_DE_SERVICIO = `np.carga_id IS NOT NULL AND a.tipo_liquido = 'granel'
  AND COALESCE(a.forma, 'liquido') = 'liquido'`;

/**
 * Medidas por producto de los renglones `$1`. Se agrupa porque un UPDATE … FROM
 * con dos renglones del mismo producto solo aplicaría uno.
 */
const SQL_MEDIDAS_POR_PRODUCTO = `(SELECT producto_id, SUM(cantidad_medidas) AS medidas
     FROM nota_productos WHERE id = ANY($1::int[]) GROUP BY producto_id)`;

/**
 * Descuenta del inventario los renglones que siguen apartados (o solo el granel
 * de servicio con `soloGranel`): baja existencia y apartado, registra la
 * 'venta' y marca el renglón. Lo ya descontado no se repite, así que se puede
 * llamar varias veces.
 *
 * @returns {Promise<number>} cuántos renglones descontó.
 */
async function consumirProductosDeNota(client, notaId, sucursal, usuarioId, { soloGranel = false } = {}) {
  const { rows } = await client.query(
    `SELECT np.id FROM nota_productos np
       JOIN productos a ON a.id = np.producto_id
      WHERE np.nota_id = $1 AND np.consumido_at IS NULL
        ${soloGranel ? `AND ${SQL_GRANEL_DE_SERVICIO}` : ''}
      FOR UPDATE OF np`,
    [notaId]
  );
  const ids = rows.map(r => r.id);
  if (ids.length === 0) return 0;
  await registrarMovimientosProductosNota(client, notaId, sucursal, usuarioId, 'venta', ids);
  await client.query(
    `UPDATE productos a
        SET stock_actual    = a.stock_actual - x.medidas,
            stock_reservado = GREATEST(0, a.stock_reservado - x.medidas)
       FROM ${SQL_MEDIDAS_POR_PRODUCTO} x
      WHERE a.id = x.producto_id`,
    [ids]
  );
  await client.query('UPDATE nota_productos SET consumido_at = NOW() WHERE id = ANY($1::int[])', [ids]);
  return ids.length;
}

/**
 * Lo contrario de `consumirProductosDeNota`, para cancelar, borrar o quitar: lo
 * descontado vuelve al inventario (con su 'liberacion') y lo apartado se suelta.
 * `ids` limita a esos renglones. No borra los renglones: eso lo decide quien llama.
 */
async function devolverProductosDeNota(client, notaId, sucursal, usuarioId, { ids = null } = {}) {
  const { rows } = await client.query(
    `SELECT id, consumido_at IS NOT NULL AS consumido FROM nota_productos
      WHERE nota_id = $1 AND ($2::int[] IS NULL OR id = ANY($2::int[]))
      FOR UPDATE`,
    [notaId, ids]
  );
  const consumidos = rows.filter(r => r.consumido).map(r => r.id);
  const apartados  = rows.filter(r => !r.consumido).map(r => r.id);
  if (consumidos.length > 0) {
    await registrarMovimientosProductosNota(client, notaId, sucursal, usuarioId, 'liberacion', consumidos);
    await client.query(
      `UPDATE productos a SET stock_actual = a.stock_actual + x.medidas
         FROM ${SQL_MEDIDAS_POR_PRODUCTO} x WHERE a.id = x.producto_id`,
      [consumidos]
    );
    await client.query('UPDATE nota_productos SET consumido_at = NULL WHERE id = ANY($1::int[])', [consumidos]);
  }
  if (apartados.length > 0) {
    await client.query(
      `UPDATE productos a SET stock_reservado = GREATEST(0, a.stock_reservado - x.medidas)
         FROM ${SQL_MEDIDAS_POR_PRODUCTO} x WHERE a.id = x.producto_id`,
      [apartados]
    );
  }
}

/**
 * Devuelve al inventario un renglón ya descontado y lo vuelve a apartar. Se usa
 * antes de cambiar un producto de una nota reabierta, para que al entregarla de
 * nuevo se descuente lo correcto. Si el renglón no estaba descontado, no hace nada.
 */
async function reabrirRenglonProducto(client, notaId, npId, sucursal, usuarioId) {
  const { rows } = await client.query(
    'SELECT producto_id, cantidad_medidas FROM nota_productos WHERE id = $1 AND consumido_at IS NOT NULL',
    [npId]
  );
  if (rows.length === 0) return;
  await devolverProductosDeNota(client, notaId, sucursal, usuarioId, { ids: [npId] });
  await client.query(
    'UPDATE productos SET stock_reservado = stock_reservado + $1 WHERE id = $2',
    [rows[0].cantidad_medidas, rows[0].producto_id]
  );
}

/**
 * Valida y pone precio a las cargas del body. Cada carga puede traer
 * { lavadora_id, secadora_id, lavadora_tipo, secadora_tipo, tipo_prenda,
 *   tipo_tela, tamano, tamano_edredon, ajuste, productos, granel }.
 *
 * - Por Encargo vende servicios: sin máquina; el precio es el del servicio.
 * - Autoservicio: se cobra la máquina elegida, que queda asignada sin arrancar.
 * - Edredón (servicio aparte): máquina física desde el alta.
 *
 * @returns las filas listas para insertar.
 * @throws {Error} con el mensaje para el usuario.
 */
async function prepararCargas(client, cargas, tipoPrendaNota, sucursal, tipo_servicio, notaIdExcluir = null) {
  if (!Array.isArray(cargas) || cargas.length === 0) {
    throw new Error('cargas debe ser una lista con al menos una carga.');
  }
  if (cargas.length > 20) {
    throw new Error('Máximo 20 cargas por nota.');
  }
  // Por Encargo y Autoservicio comparten el camino de "tipo de máquina".
  const esPorEncargo = tipo_servicio === 'POR_ENCARGO' || tipo_servicio === 'AUTOSERVICIO';
  const ids = tipo_servicio === 'POR_ENCARGO' ? [] : [...new Set(
    cargas.flatMap(c => [c.lavadora_id, c.secadora_id]).filter(Boolean).map(Number)
  )];
  const tipoPorId = new Map();
  const tamanoPorId = new Map();
  const estadoPorId = new Map();
  if (ids.length > 0) {
    const { rows } = await client.query(
      'SELECT id, nombre, tipo, tamano, estado FROM maquinas WHERE id = ANY($1) AND sucursal = $2',
      [ids, sucursal]
    );
    rows.forEach(r => {
      tipoPorId.set(Number(r.id), r.tipo);
      tamanoPorId.set(Number(r.id), r.tamano);
      estadoPorId.set(Number(r.id), { estado: r.estado, nombre: r.nombre });
    });
    const faltante = ids.find(id => !tipoPorId.has(id));
    if (faltante) throw new Error(`La máquina ${faltante} no existe.`);

    // Autoservicio no acepta una máquina que otra nota abierta ya tiene: se
    // cobra por ella desde el alta. Cubre dos mostradores capturando a la vez.
    if (tipo_servicio === 'AUTOSERVICIO') {
      const { rows: apartadas } = await client.query(
        `SELECT DISTINCT m.nombre, n.folio
           FROM maquinas m
           JOIN nota_cargas nc ON nc.lavadora_id = m.id OR nc.secadora_id = m.id
           JOIN notas n ON n.id = nc.nota_id
          WHERE m.id = ANY($1)
            AND n.estado IN ('EN_ESPERA', 'LAVANDO', 'SECANDO')
            AND ($2::int IS NULL OR n.id <> $2)
          LIMIT 1`,
        [ids, notaIdExcluir]
      );
      if (apartadas.length > 0) {
        throw new Error(
          `La máquina ${apartadas[0].nombre} ya está apartada por la nota `
          + `${apartadas[0].folio ?? 'abierta'}. Elige otra.`
        );
      }
    }
  }
  const t = await tarifasCarga(client);
  // Autoservicio: secadoras que cobran por programa (quedan por definir).
  const porPrograma = new Set();
  if (tipo_servicio === 'AUTOSERVICIO') {
    for (const mid of ids) {
      if (await preciosDePrograma(client, mid)) porPrograma.add(mid);
    }
  }
  return cargas.map((c, i) => {
    const prendaCarga = (c.tipo_prenda ? String(c.tipo_prenda).toUpperCase() : tipoPrendaNota) || 'ROPA';
    if (c.tipo_prenda && !TIPOS_PRENDA_VALIDOS.includes(prendaCarga)) {
      throw new Error(`tipo_prenda inválido en la carga ${i + 1}.`);
    }
    if (c.tamano && !TAMANOS_VALIDOS.includes(String(c.tamano).toLowerCase())) {
      throw new Error(`tamano inválido en la carga ${i + 1}.`);
    }
    const ajusteCarga = c.ajuste != null && c.ajuste !== '' ? Number(c.ajuste) : 0;
    if (!Number.isFinite(ajusteCarga)) {
      throw new Error(`ajuste inválido en la carga ${i + 1}.`);
    }
    const productos = Array.isArray(c.productos)
      ? c.productos
          .filter(p => p.producto_id && p.cantidad && Number(p.cantidad) > 0)
          .map(p => ({ producto_id: Number(p.producto_id), cantidad: Number(p.cantidad) }))
      : [];

    // La nota nace sin arrancar (activar = false).
    let lavadoraId = null, secadoraId = null, lavadoraTipo = null, secadoraTipo = null;
    let precioLavadora = 0, precioSecadora = 0, secadoraPorDefinir = false, activar;
    if (esPorEncargo) {
      lavadoraTipo = c.lavadora_tipo ? String(c.lavadora_tipo).toLowerCase() : null;
      secadoraTipo = c.secadora_tipo ? String(c.secadora_tipo).toLowerCase() : null;
      if (lavadoraTipo && !TIPOS_MAQUINA_VALIDOS.includes(lavadoraTipo)) {
        throw new Error(`Tipo de lavadora inválido en la carga ${i + 1}.`);
      }
      if (secadoraTipo && !TIPOS_MAQUINA_VALIDOS.includes(secadoraTipo)) {
        throw new Error(`Tipo de secadora inválido en la carga ${i + 1}.`);
      }
      // Autoservicio: la máquina física elegida. Tiene que ser del tipo correcto
      // y estar libre; queda asignada sin arrancar.
      if (tipo_servicio === 'AUTOSERVICIO') {
        lavadoraId = c.lavadora_id ? Number(c.lavadora_id) : null;
        secadoraId = c.secadora_id ? Number(c.secadora_id) : null;
        if (lavadoraId && tipoPorId.get(lavadoraId) === 'secadora') {
          throw new Error(`La máquina de lavado de la máquina ${i + 1} es una secadora.`);
        }
        if (secadoraId && tipoPorId.get(secadoraId) !== 'secadora') {
          throw new Error(`La máquina de secado de la máquina ${i + 1} no es una secadora.`);
        }
        // Otro compañero pudo arrancarla mientras se llenaba el formulario.
        for (const mid of [lavadoraId, secadoraId].filter(Boolean)) {
          const m = estadoPorId.get(mid);
          if (m && m.estado !== 'disponible') {
            throw new Error(`La máquina ${m.nombre} ya no está disponible. Elige otra.`);
          }
        }
        // El tipo sale de la máquina (para el ticket y el trabajo pendiente).
        if (lavadoraId) lavadoraTipo = tipoPorId.get(lavadoraId) === 'lavadora_jumbo' ? 'jumbo' : 'mediana';
        if (secadoraId) secadoraTipo = 'mediana';
      }
      // En Autoservicio se cobra la máquina: sin ella no hay nada que cobrar.
      if (tipo_servicio === 'AUTOSERVICIO' && !lavadoraId && !secadoraId && !lavadoraTipo && !secadoraTipo) {
        throw new Error(`La máquina ${i + 1} necesita ser una lavadora o una secadora.`);
      }
      // Se pone precio al crear, salvo un Autoservicio que solo trae el tipo
      // (vale $0 hasta asignarle máquina en Salidas). El edredón de Autoservicio
      // se cobra con su tarifa aunque no traiga máquina.
      const tarifaAlCrear = tipo_servicio !== 'AUTOSERVICIO' || Boolean(lavadoraId || secadoraId)
        || prendaCarga === 'EDREDON';
      if (lavadoraTipo && tarifaAlCrear) {
        precioLavadora = lavadoraId
          ? tarifaLavadora(tipoPorId.get(lavadoraId), prendaCarga, t)
          : tarifaLavadora(lavadoraTipo === 'jumbo' ? 'lavadora_jumbo' : 'lavadora_mediana', prendaCarga, t);
      }
      if (secadoraTipo && tarifaAlCrear) {
        precioSecadora = tarifaSecadora(secadoraId ? tamanoPorId.get(secadoraId) : secadoraTipo, prendaCarga, t);
      }
      // La que cobra por programa: su precio sale al iniciarla.
      if (secadoraId && porPrograma.has(secadoraId)) {
        precioSecadora = 0;
        secadoraPorDefinir = true;
      }
      activar = false;
    } else {
      // Servicio EDREDON: máquina física desde el alta.
      lavadoraId = c.lavadora_id ? Number(c.lavadora_id) : null;
      secadoraId = c.secadora_id ? Number(c.secadora_id) : null;
      if (lavadoraId && tipoPorId.get(lavadoraId) === 'secadora') {
        throw new Error(`La máquina de lavado de la carga ${i + 1} es una secadora.`);
      }
      if (secadoraId && tipoPorId.get(secadoraId) !== 'secadora') {
        throw new Error(`La máquina de secado de la carga ${i + 1} no es una secadora.`);
      }
      precioLavadora = lavadoraId ? tarifaLavadora(tipoPorId.get(lavadoraId), prendaCarga, t) : 0;
      precioSecadora = secadoraId ? tarifaSecadora(tamanoPorId.get(secadoraId), prendaCarga, t) : 0;
      // Arranca de inmediato salvo `activar: false`.
      activar = c.activar !== false;
    }

    // Precio del servicio Por Encargo, congelado en la carga. Un servicio a la
    // venta sin precio configurado se rechaza para no crear una nota en $0.
    const tamanoCarga = c.tamano ? String(c.tamano).toLowerCase() : null;
    const tamanoEdredon = prendaCarga === 'EDREDON' && c.tamano_edredon ? String(c.tamano_edredon).trim() : null;
    let precioTope = null;
    if (tipo_servicio === 'POR_ENCARGO') {
      precioTope = topeDeCarga(prendaCarga, tamanoCarga, t, tamanoEdredon);
      if (precioTope == null && esServicioQueSeVende(prendaCarga, tamanoCarga)) {
        throw new Error(
          `Falta configurar el precio del servicio ${nombreServicio(prendaCarga, tamanoCarga, tamanoEdredon)} `
          + 'en Ajustes → Servicios Por Encargo.'
        );
      }
    }

    return {
      orden:           i + 1,
      lavadora_id:     lavadoraId,
      secadora_id:     secadoraId,
      lavadora_tipo:   lavadoraTipo,
      secadora_tipo:   secadoraTipo,
      precio_lavadora: precioLavadora,
      precio_secadora: precioSecadora,
      secadora_por_definir: secadoraPorDefinir,
      tipo_prenda:     c.tipo_prenda ? prendaCarga : null,
      tipo_tela:       prendaCarga === 'ROPA' && c.tipo_tela ? String(c.tipo_tela).trim() : null,
      tamano_edredon:  tamanoEdredon,
      tamano:          tamanoCarga,
      ajuste:          ajusteCarga,
      precio_tope:     precioTope,
      activar,
      productos,
      // Medidas de granel capturadas; sin ellas, las de Ajustes.
      granel:          tipo_servicio === 'POR_ENCARGO' ? leerGranelDeCarga(c.granel, i) : null,
    };
  });
}

/**
 * Lee las medidas de granel de una carga: [{ tipo_granel_id, cantidad }].
 * @returns {Map<number, number>|null} tipo → medidas (0 = no lleva), o null si
 *   no vino nada y se usan las de Ajustes.
 */
function leerGranelDeCarga(v, i) {
  if (v == null) return null;
  if (!Array.isArray(v)) throw new Error(`El granel de la carga ${i + 1} no es válido.`);
  const porTipo = new Map();
  for (const g of v) {
    const tipo = Number(g?.tipo_granel_id);
    const cantidad = Number(g?.cantidad);
    if (!Number.isInteger(tipo) || tipo < 1 || !Number.isInteger(cantidad) || cantidad < 0) {
      throw new Error(`Las medidas de granel de la carga ${i + 1} deben ser números enteros de 0 o más.`);
    }
    porTipo.set(tipo, cantidad);
  }
  return porTipo;
}

/**
 * Registra una pasada de la carga por una máquina en `nota_carga_maquinas` (una
 * fila por vuelta, así un relavado no borra la anterior). Copia nombre y tipo
 * para que la nota los conserve si la máquina se renombra o se borra.
 *
 * Llamar ANTES de poner la máquina en la carga, para distinguir una vuelta
 * nueva de reescribir la misma.
 *
 * @param {'pasada'|'reemplazo'} modo  'pasada' agrega una vuelta; 'reemplazo'
 *   corrige la máquina de la vuelta en curso (cambiar máquina).
 * @param {boolean} cicloUnico  la vuelta corre un solo ciclo aunque el modelo dé
 *   para dos (la que se agrega desde Salidas, sin cobro).
 */
async function registrarMaquinaEnCarga(client, cargaId, slot, maquinaId, modo = 'pasada', cicloUnico = false) {
  if (!cargaId || !maquinaId) return;
  const { rows: maq } = await client.query(
    'SELECT id, nombre, tipo, tamano FROM maquinas WHERE id = $1', [maquinaId]
  );
  if (maq.length === 0) return;
  const m = maq[0];

  const { rows: ultimas } = await client.query(
    `SELECT id, maquina_id FROM nota_carga_maquinas
      WHERE carga_id = $1 AND slot = $2
      ORDER BY asignada_at DESC, id DESC LIMIT 1`,
    [cargaId, slot]
  );
  const ultima = ultimas[0];

  if (modo === 'reemplazo' && ultima) {
    await client.query(
      `UPDATE nota_carga_maquinas
          SET maquina_id = $1, maquina_nombre = $2, maquina_tipo = $3, maquina_tamano = $4
        WHERE id = $5`,
      [m.id, m.nombre, m.tipo, m.tamano, ultima.id]
    );
    return;
  }

  // Volver a escribir la misma máquina que el hueco ya tiene no es otra vuelta.
  if (ultima && String(ultima.maquina_id) === String(m.id)) {
    const { rows: c } = await client.query(
      'SELECT lavadora_id, secadora_id FROM nota_cargas WHERE id = $1', [cargaId]
    );
    const enElHueco = slot === 'lavadora' ? c[0]?.lavadora_id : c[0]?.secadora_id;
    if (String(enElHueco) === String(m.id)) return;
  }

  // Una vuelta nueva aún no arranca: se borra la marca de la anterior, o la
  // máquina nueva contaría como arrancada por esta nota.
  if (ultima) {
    const col = slot === 'secadora' ? 'secadora_iniciada_at' : 'lavadora_iniciada_at';
    await client.query(`UPDATE nota_cargas SET ${col} = NULL WHERE id = $1`, [cargaId]);
  }

  await client.query(
    `INSERT INTO nota_carga_maquinas
       (carga_id, slot, maquina_id, maquina_nombre, maquina_tipo, maquina_tamano, ciclo_unico)
     VALUES ($1, $2, $3, $4, $5, $6, $7)`,
    [cargaId, slot, m.id, m.nombre, m.tipo, m.tamano, cicloUnico]
  );
}

/**
 * Guarda inicio y fin de la vuelta en curso de esta máquina (la última de cada
 * carga, si no estaba sellada). Llamar ANTES de soltarla, mientras
 * `en_uso_desde` conserva el arranque. Con cronómetro, si ya pasó el tope, el
 * fin es el tope y no la hora del clic.
 */
async function sellarFinDePasada(client, notaId, slot, maquinaId) {
  const col = slot === 'secadora' ? 'secadora' : 'lavadora';
  await client.query(
    `UPDATE nota_carga_maquinas ncm
        SET encendida_at  = t.inicio,
            llego_tope    = COALESCE(t.inicio + t.tope <= NOW(), FALSE),
            finalizada_at = CASE WHEN t.inicio + t.tope <= NOW()
                                 THEN t.inicio + t.tope ELSE NOW() END
       FROM nota_cargas nc, maquinas m,
            LATERAL (
              SELECT COALESCE(m.en_uso_desde, nc.${col}_iniciada_at) AS inicio,
                     CASE WHEN ${esCronometroSql('m')} AND m.ciclo_minutos > 0
                          THEN make_interval(mins => ${TOPE_RELOJ('m')}) END AS tope
            ) t
      WHERE nc.nota_id = $1
        AND nc.${col}_id = $3
        AND m.id = $3
        AND ncm.carga_id = nc.id
        AND ncm.maquina_id = $3
        AND ncm.finalizada_at IS NULL
        AND ncm.id = (
          SELECT x.id FROM nota_carga_maquinas x
           WHERE x.carga_id = nc.id AND x.slot = $2
           ORDER BY x.asignada_at DESC, x.id DESC LIMIT 1
        )`,
    [notaId, col, maquinaId]
  );
}

// ── Granel de los servicios Por Encargo ──────────────────────────────────

/** Clave del servicio para el granel ('chico'…'edredon'); todo edredón usa 'edredon'. */
function claveLigueServicio(prenda, tamano) {
  if (String(prenda ?? '').toUpperCase() === 'EDREDON') return 'edredon';
  return ['chico', 'mediano', 'grande'].includes(tamano) ? tamano : null;
}

/**
 * Medidas de cada tipo de granel que trae el servicio (Ajustes → Servicios Por
 * Encargo). El edredón, según su tamaño.
 */
async function medidasDeServicio(client, prenda, tamano, tamanoEdredon) {
  if (String(prenda ?? '').toUpperCase() === 'EDREDON') {
    if (!tamanoEdredon) return 0;
    const { rows } = await client.query(
      'SELECT precarga_medidas FROM tamanos_edredon WHERE lower(nombre) = lower($1) LIMIT 1',
      [String(tamanoEdredon).trim()]
    );
    return Number(rows[0]?.precarga_medidas) || 0;
  }
  if (!['chico', 'mediano', 'grande'].includes(tamano)) return 0;
  const { rows } = await client.query(`SELECT precarga_medidas_${tamano} AS n FROM ajustes WHERE id = 1`);
  return Number(rows[0]?.n) || 0;
}

/**
 * La bolsa ligada al servicio (Inventario) y cuántas incluye (Ajustes →
 * Servicios Por Encargo; el edredón, según su tamaño). Las de más se cobran.
 */
async function bolsasDeServicio(client, prenda, tamano, tamanoEdredon, sucursal) {
  const clave = claveLigueServicio(prenda, tamano);
  if (!clave) return { productoId: null, incluidas: 0 };
  let incluidas = 0;
  if (clave === 'edredon') {
    if (tamanoEdredon) {
      const { rows } = await client.query(
        'SELECT precarga_bolsas FROM tamanos_edredon WHERE lower(nombre) = lower($1) LIMIT 1',
        [String(tamanoEdredon).trim()]
      );
      incluidas = Number(rows[0]?.precarga_bolsas) || 0;
    }
  } else {
    const { rows } = await client.query(`SELECT precarga_bolsas_${clave} AS n FROM ajustes WHERE id = 1`);
    incluidas = Number(rows[0]?.n) || 0;
  }
  const { rows: bolsa } = await client.query(
    `SELECT id FROM productos
      WHERE clase = 'bolsa' AND archivado = FALSE AND sucursal = $1 AND $2 = ANY(servicios_bolsa)
      ORDER BY id LIMIT 1`,
    [sucursal, clave]
  );
  return { productoId: bolsa[0]?.id ?? null, incluidas };
}

/** Granel líquido de la sucursal agrupado por tipo (Map tipo → productos). */
async function opcionesGranelDeServicio(client, sucursal) {
  const { rows } = await client.query(
    `SELECT p.id, p.tipo_granel_id AS tipo_id, p.stock_actual - p.stock_reservado AS disponible
       FROM productos p
      WHERE p.sucursal = $1 AND p.archivado = FALSE
        AND p.tipo_liquido = 'granel' AND COALESCE(p.forma, 'liquido') = 'liquido'
        AND COALESCE(p.clase, 'liquido') <> 'bolsa'
        AND p.tipo_granel_id IS NOT NULL
      ORDER BY p.tipo_granel_id, p.id`,
    [sucursal]
  );
  const porTipo = new Map();
  for (const r of rows) {
    if (!porTipo.has(r.tipo_id)) porTipo.set(r.tipo_id, []);
    porTipo.get(r.tipo_id).push(r);
  }
  return porTipo;
}

/**
 * Pone el granel de un servicio nuevo: por cada tipo, las medidas capturadas o
 * las de Ajustes. Si el tipo tiene un solo producto y alcanza, se aparta
 * directo; si no, queda pendiente para elegirlo en Salidas. Que no alcance no
 * impide crear la nota.
 */
async function granelDeCarga(client, notaId, carga, sucursal, tipo_servicio, capturado = null) {
  const clave = claveLigueServicio(carga.tipo_prenda, carga.tamano);
  if (!clave) return [];
  const deAjustes = await medidasDeServicio(client, carga.tipo_prenda, carga.tamano, carga.tamano_edredon);
  const productos = [];
  for (const [tipoId, opciones] of await opcionesGranelDeServicio(client, sucursal)) {
    const medidas = capturado?.has(Number(tipoId)) ? capturado.get(Number(tipoId)) : deAjustes;
    if (!(medidas > 0)) continue;
    if (opciones.length === 1 && Number(opciones[0].disponible) >= medidas) {
      productos.push(await reservarProducto(client, notaId, carga.id, opciones[0].id, medidas, sucursal, tipo_servicio));
    } else {
      await client.query(
        `INSERT INTO nota_carga_pendientes (nota_id, carga_id, tipo_granel_id, cantidad)
         VALUES ($1, $2, $3, $4)`,
        [notaId, carga.id, tipoId, medidas]
      );
    }
  }
  return productos;
}

/**
 * Ninguna lavadora de la nota arranca mientras algún servicio tenga granel por
 * elegir: sin eso no se sabe qué descontar. Aplica a toda la nota porque las
 * máquinas de Por Encargo no van ligadas a un servicio. Las secadoras no cuentan.
 *
 * @returns {Promise<string|null>} el mensaje que lo explica, o null.
 */
async function granelSinElegir(client, notaId, maquinaIds) {
  if (!maquinaIds || maquinaIds.length === 0) return null;
  const { rows: lavadoras } = await client.query(
    `SELECT 1 FROM maquinas WHERE id = ANY($1::int[]) AND tipo::text LIKE 'lavadora%' LIMIT 1`,
    [maquinaIds.map(Number)]
  );
  if (lavadoras.length === 0) return null;
  const { rows } = await client.query(
    `SELECT nc.orden, nc.tipo_prenda, nc.tamano, nc.tamano_edredon,
            string_agg(t.nombre, ' y ' ORDER BY t.orden NULLS LAST, t.id) AS tipos
       FROM nota_carga_pendientes pe
       JOIN nota_cargas nc ON nc.id = pe.carga_id
       JOIN tipos_granel t ON t.id = pe.tipo_granel_id
      WHERE pe.nota_id = $1
        AND NOT pe.del_cliente   -- el cliente trajo el suyo
      GROUP BY nc.id
      ORDER BY nc.orden
      LIMIT 1`,
    [notaId]
  );
  if (rows.length === 0) return null;
  const r = rows[0];
  const servicio = nombreServicio(r.tipo_prenda, r.tamano, r.tamano_edredon);
  return `Antes de iniciar la lavadora, elige ${String(r.tipos).toLowerCase()} del servicio ${servicio} `
    + 'en los productos de la nota.';
}

/**
 * Inserta las cargas ya preparadas con sus productos (apartados) y, en Por
 * Encargo, el granel de cada servicio. Devuelve las cargas con sus productos.
 */
async function insertarCargas(client, notaId, filas, sucursal, tipo_servicio) {
  const insertadas = [];
  for (const f of filas) {
    // Por Encargo: el servicio incluye sus bolsas (congeladas aquí); las de más se cobran.
    const bolsas = tipo_servicio === 'POR_ENCARGO' && f.precio_tope != null
      ? await bolsasDeServicio(client, f.tipo_prenda, f.tamano, f.tamano_edredon, sucursal)
      : { productoId: null, incluidas: 0 };
    const { rows } = await client.query(
      `INSERT INTO nota_cargas
         (nota_id, orden, lavadora_id, secadora_id, lavadora_usada_id, secadora_usada_id,
          lavadora_tipo, secadora_tipo, precio_lavadora, precio_secadora,
          tipo_prenda, tipo_tela, tamano_edredon, tamano, ajuste, precio_tope, secadora_por_definir,
          bolsa_producto_id, bolsas_incluidas)
       VALUES ($1, $2, $3, $4, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17) RETURNING *`,
      [notaId, f.orden, f.lavadora_id, f.secadora_id, f.lavadora_tipo, f.secadora_tipo,
       f.precio_lavadora, f.precio_secadora,
       f.tipo_prenda, f.tipo_tela, f.tamano_edredon, f.tamano, f.ajuste,
       f.precio_tope ?? null, Boolean(f.secadora_por_definir),
       bolsas.productoId, bolsas.incluidas]
    );
    const carga = rows[0];
    // Primera pasada de cada hueco que nació con máquina.
    await registrarMaquinaEnCarga(client, carga.id, 'lavadora', f.lavadora_id);
    await registrarMaquinaEnCarga(client, carga.id, 'secadora', f.secadora_id);
    const productos = [];
    for (const p of (f.productos ?? [])) {
      productos.push(await reservarProducto(client, notaId, carga.id, p.producto_id, p.cantidad, sucursal, tipo_servicio));
    }
    if (tipo_servicio === 'POR_ENCARGO') {
      productos.push(...await granelDeCarga(client, notaId, carga, sucursal, tipo_servicio, f.granel));
    }
    insertadas.push({ ...carga, productos });
  }
  return insertadas;
}

/** Cargas de la nota con sus máquinas, vueltas, productos y granel pendiente. */
async function cargasDeNota(client, notaId) {
  const { rows } = await client.query(
    `SELECT nc.id, nc.orden, nc.lavadora_id, nc.secadora_id,
            nc.precio_lavadora, nc.precio_secadora, nc.es_adicional,
            -- Fichas de más de la secadora de fichas y lo que suman.
            nc.fichas_extra, nc.precio_fichas_extra, nc.secadora_por_definir,
            nc.bolsa_producto_id, nc.bolsas_incluidas,
            nc.tipo_prenda, nc.tipo_tela, nc.tamano_edredon, nc.tamano, nc.ajuste,
            -- Una carga que ya arrancó no se puede quitar.
            nc.lavadora_iniciada_at, nc.secadora_iniciada_at,
            nc.lavadora_tipo AS lavadora_tipo_previsto,
            nc.secadora_tipo AS secadora_tipo_previsto,
            ml.nombre AS lavadora_nombre, ml.tipo AS lavadora_tipo, ml.estado AS lavadora_estado,
            ml.en_uso_desde AS lavadora_en_uso_desde,
            -- Con él Salidas sabe si ya llegó al tope.
            ml.ciclo_minutos AS lavadora_ciclo_minutos,
            ml.ciclo_elegido_minutos AS lavadora_ciclo_elegido_minutos,
            -- Encendida por esta nota sin arrancar: el botón dice "Iniciar".
            (ml.estado = 'en_uso' AND ml.en_uso_desde IS NULL
             AND ml.encendida_para_nota_id = nc.nota_id) AS lavadora_esperando_arranque,
            ms.nombre AS secadora_nombre, ms.tipo AS secadora_tipo, ms.estado AS secadora_estado,
            ms.tamano AS secadora_tamano, ms.en_uso_desde AS secadora_en_uso_desde,
            ms.ciclo_minutos AS secadora_ciclo_minutos,
            ms.ciclo_elegido_minutos AS secadora_ciclo_elegido_minutos,
            (ms.estado = 'en_uso' AND ms.en_uso_desde IS NULL
             AND ms.encendida_para_nota_id = nc.nota_id) AS secadora_esperando_arranque,
            nc.lavadora_usada_id, nc.secadora_usada_id,
            mlu.nombre AS lavadora_usada_nombre, mlu.tipo AS lavadora_usada_tipo,
            msu.nombre AS secadora_usada_nombre, msu.tipo AS secadora_usada_tipo,
            msu.tamano AS secadora_usada_tamano,
            -- Precio del servicio congelado (null = se cobra lo que lleva).
            nc.precio_tope AS tope_carga,
            -- Vueltas de la carga en orden; "actual" es la que el hueco tiene hoy.
            (SELECT COALESCE(json_agg(x ORDER BY x.asignada_at, x.id), '[]'::json)
               FROM (
                 SELECT ncm.id, ncm.slot, ncm.maquina_id, ncm.asignada_at,
                        ncm.maquina_nombre AS nombre, ncm.maquina_tipo AS tipo,
                        ncm.maquina_tamano AS tamano,
                        -- Programas del modelo: si hay que preguntar al iniciar.
                        (SELECT json_build_object(
                                  'pregunta', mo.pregunta_tiempo,
                                  'minutos', ${PROGRAMAS_DEL_MODELO('mo')},
                                  'precios', ${PRECIOS_DE_PROGRAMAS('mo')})
                           FROM maquinas mm2
                           JOIN marcas_maquina mmk ON mmk.nombre = mm2.marca
                           JOIN modelos_maquina mo ON mo.marca_id = mmk.id AND mo.nombre = mm2.modelo
                          WHERE mm2.id = ncm.maquina_id) AS modelo_tiempos,
                        -- Si el modelo corre dos ciclos por carga.
                        (SELECT json_build_object(
                                  'dos_ciclos', COALESCE((
                                    SELECT mo2.dos_ciclos FROM modelos_maquina mo2
                                     WHERE mo2.marca_id = mmk2.id AND mo2.nombre = mm3.modelo
                                  ), FALSE))
                           FROM maquinas mm3
                           JOIN marcas_maquina mmk2 ON mmk2.nombre = mm3.marca
                          WHERE mm3.id = ncm.maquina_id) AS marca_opciones,
                        -- Aplica también a máquinas sin marca de catálogo.
                        (SELECT ${esCronometroSql('mm4')} FROM maquinas mm4
                          WHERE mm4.id = ncm.maquina_id) AS cronometro,
                        -- Cronómetro que arranca con "Iniciar" y no al encender.
                        (SELECT ${conIniciarSql('mm5')} FROM maquinas mm5
                          WHERE mm5.id = ncm.maquina_id) AS con_iniciar,
                        -- Solo fichas: su Iniciar no enciende nada.
                        (SELECT ${soloFichasSql('mm6')} FROM maquinas mm6
                          WHERE mm6.id = ncm.maquina_id) AS solo_fichas,
                        -- Actual = la última vuelta del hueco, si esa máquina
                        -- sigue puesta (un relavado repite máquina).
                        (ncm.maquina_id IS NOT NULL
                         AND ncm.maquina_id = CASE
                           WHEN ncm.slot = 'lavadora' THEN nc.lavadora_id ELSE nc.secadora_id
                         END
                         AND ROW_NUMBER() OVER (
                           PARTITION BY ncm.slot ORDER BY ncm.asignada_at DESC, ncm.id DESC
                         ) = 1) AS actual
                   FROM nota_carga_maquinas ncm
                  WHERE ncm.carga_id = nc.id
               ) x
            ) AS maquinas_usadas
       FROM nota_cargas nc
       LEFT JOIN maquinas ml  ON ml.id  = nc.lavadora_id
       LEFT JOIN maquinas ms  ON ms.id  = nc.secadora_id
       LEFT JOIN maquinas mlu ON mlu.id = nc.lavadora_usada_id
       LEFT JOIN maquinas msu ON msu.id = nc.secadora_usada_id
      WHERE nc.nota_id = $1
      ORDER BY nc.orden ASC`,
    [notaId]
  );
  const { rows: prods } = await client.query(
    `SELECT np.id, np.carga_id, np.producto_id, a.nombre, np.cantidad, np.unidad, np.precio_unitario,
            a.es_por_medida, a.tipo_liquido, a.forma, a.se_vende_por_unidad, a.clase, a.tamano_bolsa, a.marca,
            (np.cantidad * np.precio_unitario) AS subtotal
       FROM nota_productos np
       JOIN productos a ON a.id = np.producto_id
      WHERE np.nota_id = $1 AND np.carga_id IS NOT NULL
      ORDER BY np.created_at ASC`,
    [notaId]
  );
  // Granel por elegir de cada servicio; `del_cliente` = lo trajo el cliente.
  const { rows: pendientes } = await client.query(
    `SELECT pe.id, pe.carga_id, pe.tipo_granel_id, t.nombre AS tipo_granel, pe.cantidad, pe.del_cliente
       FROM nota_carga_pendientes pe
       JOIN tipos_granel t ON t.id = pe.tipo_granel_id
      WHERE pe.nota_id = $1
      ORDER BY t.orden NULLS LAST, t.id`,
    [notaId]
  );
  return rows.map(c => ({
    ...c,
    productos:  prods.filter(p => p.carga_id === c.id),
    pendientes: pendientes.filter(p => p.carga_id === c.id),
  }));
}

/**
 * ¿El registro existe y es de esta sucursal? `tabla` debe ser una constante
 * del código (se interpola en el SQL).
 */
async function perteneceASucursal(tabla, id, sucursal) {
  const { rows } = await pool.query(
    `SELECT 1 FROM ${tabla} WHERE id = $1 AND sucursal = $2`,
    [id, sucursal]
  );
  return rows.length > 0;
}

/**
 * Aviso en la campana al revertir un pago, con quién, la nota, el motivo y los
 * abonos revertidos: es el dinero que sale del corte.
 */
async function registrarReversionPago(client, nota, usuarioId, sucursal, motivo = null, abonos = []) {
  const { rows } = await client.query("SELECT TRIM(nombre || ' ' || COALESCE(apellido, '')) AS nombre FROM usuarios WHERE id = $1", [usuarioId]);
  const quien = rows[0]?.nombre ?? 'un administrador';
  const devuelto = abonos.reduce((t, a) => t + Number(a.monto), 0);
  const mensaje = `Pago revertido en la nota ${nota.folio ?? `#${nota.id}`} por ${quien}`
                + (abonos.length > 0
                    ? ` (se revirtieron ${abonos.length} abono(s) por $${devuelto.toFixed(2)})`
                    : '')
                + (motivo ? `: ${motivo}` : '');
  await client.query(
    `INSERT INTO notificaciones (tipo, mensaje, usuario_id, sucursal)
     VALUES ('pago_revertido', $1, $2, $3)`,
    [mensaje, usuarioId, sucursal]
  );
}

/** Aviso en la campana al cancelar una nota: quién y cuál. */
async function registrarCancelacionNota(client, nota, usuarioId, sucursal, motivo = null) {
  const { rows } = await client.query("SELECT TRIM(nombre || ' ' || COALESCE(apellido, '')) AS nombre FROM usuarios WHERE id = $1", [usuarioId]);
  const quien = rows[0]?.nombre ?? 'un empleado';
  const folio = nota.folio ?? `#${nota.id}`;
  const mensaje = `Nota ${folio} cancelada por ${quien}${motivo ? `: ${motivo}` : ''}`;
  await client.query(
    `INSERT INTO notificaciones (tipo, mensaje, nota_folio, usuario_id, sucursal)
     VALUES ('nota_cancelada', $1, $2, $3, $4)`,
    [mensaje, folio, usuarioId, sucursal]
  );
}

/** Aviso en la campana al eliminar una nota: quién y cuál. */
async function registrarEliminacionNota(client, nota, usuarioId, sucursal) {
  const { rows } = await client.query("SELECT TRIM(nombre || ' ' || COALESCE(apellido, '')) AS nombre FROM usuarios WHERE id = $1", [usuarioId]);
  const quien = rows[0]?.nombre ?? 'un administrador';
  const folio = nota.folio ?? `#${nota.id}`;
  await client.query(
    `INSERT INTO notificaciones (tipo, mensaje, nota_folio, usuario_id, sucursal)
     VALUES ('nota_eliminada', $1, $2, $3, $4)`,
    [`Nota ${folio} eliminada por ${quien}`, folio, usuarioId, sucursal]
  );
}

/**
 * Toma el siguiente número de folio de la sucursal (cada una lleva su
 * contador). Dentro de la transacción del alta: dos altas a la vez no repiten
 * número y un alta que falla no lo gasta.
 */
async function tomarNumeroFolio(client, sucursal) {
  const { rows } = await client.query(
    `INSERT INTO folios_sucursal (sucursal, ultimo) VALUES ($1, 1)
     ON CONFLICT (sucursal) DO UPDATE SET ultimo = folios_sucursal.ultimo + 1
     RETURNING ultimo`,
    [sucursal]
  );
  return rows[0].ultimo;
}

// ── GET /notas/next-folio ───────────────────────────────────
export const getNextFolio = async (req, res) => {
  try {
    const { rows } = await pool.query(
      'SELECT COALESCE((SELECT ultimo FROM folios_sucursal WHERE sucursal = $1), 0) + 1 AS siguiente',
      [req.sucursal]
    );
    const folio = generarFolio(rows[0].siguiente, new Date());
    res.json({ folio });
  } catch (err) {
    console.error('getNextFolio error:', err);
    res.status(500).json({ message: 'No se pudo obtener el siguiente folio. Intenta de nuevo.' });
  }
};

// ── GET /notas ──────────────────────────────────────────────
export const getNotas = async (req, res) => {
  // ?cliente_id=N: solo las notas de ese cliente (historial en Clientes).
  const clienteId = req.query.cliente_id != null ? Number(req.query.cliente_id) : null;
  if (clienteId !== null && !Number.isInteger(clienteId)) {
    return res.status(400).json({ message: 'Cliente inválido.' });
  }
  try {
    const { rows } = await pool.query(
      `SELECT n.*,
              c.nombre   AS cliente_nombre,
              c.apellido AS cliente_apellido,
              c.telefono AS cliente_telefono,
              TRIM(u.nombre || ' ' || COALESCE(u.apellido, '')) AS usuario_nombre,
              su.nombre  AS sucursal_nombre,
              su.direccion AS sucursal_direccion,
              -- Para el comodín *Horario* de WhatsApp.
              su.horario_semana AS sucursal_horario_semana,
              (SELECT COALESCE(json_agg(DISTINCT x.mid), '[]'::json)
                 FROM (${SQL_MAQUINAS_DE_NOTA}) x
                WHERE x.mid IS NOT NULL) AS maquinas_ids,
              -- Todas las máquinas que la nota usa o usó: las puestas, las
              -- últimas usadas y las de su historial de vueltas.
              (SELECT COALESCE(json_agg(mm.nombre ORDER BY mm.nombre), '[]'::json)
                 FROM (
                   SELECT nc.lavadora_id       AS mid FROM nota_cargas nc WHERE nc.nota_id = n.id
                   UNION SELECT nc.secadora_id        FROM nota_cargas nc WHERE nc.nota_id = n.id
                   UNION SELECT nc.lavadora_usada_id  FROM nota_cargas nc WHERE nc.nota_id = n.id
                   UNION SELECT nc.secadora_usada_id  FROM nota_cargas nc WHERE nc.nota_id = n.id
                   UNION SELECT ncm.maquina_id
                           FROM nota_carga_maquinas ncm
                           JOIN nota_cargas nc ON nc.id = ncm.carga_id
                          WHERE nc.nota_id = n.id
                 ) xm
                 JOIN maquinas mm ON mm.id = xm.mid) AS maquinas_nombres,
              -- "Doblado": Por Encargo que ya lavó y secó, sin cargas pendientes,
              -- esperando "Procesado". Sigue EN_ESPERA; solo cambia cómo se ve.
              (n.tipo_servicio = 'POR_ENCARGO' AND n.estado = 'EN_ESPERA'
                AND EXISTS (SELECT 1 FROM nota_cargas nc
                             WHERE nc.nota_id = n.id
                               AND (nc.lavadora_usada_id IS NOT NULL OR nc.lavadora_iniciada_at IS NOT NULL))
                AND EXISTS (SELECT 1 FROM nota_cargas nc
                             WHERE nc.nota_id = n.id
                               AND (nc.secadora_usada_id IS NOT NULL OR nc.secadora_iniciada_at IS NOT NULL))
                AND NOT EXISTS (SELECT 1 FROM nota_cargas nc
                                 WHERE nc.nota_id = n.id
                                   AND (nc.lavadora_id IS NOT NULL
                                     OR nc.secadora_id IS NOT NULL
                                     OR (nc.lavadora_tipo IS NOT NULL AND nc.lavadora_iniciada_at IS NULL
                                         AND nc.lavadora_usada_id IS NULL)
                                     OR (nc.secadora_tipo IS NOT NULL AND nc.secadora_iniciada_at IS NULL
                                         AND nc.secadora_usada_id IS NULL)))
              ) AS doblado,
              -- Máquinas que esta nota arrancó y siguen corriendo.
              (SELECT COALESCE(json_agg(DISTINCT mm.nombre), '[]'::json)
                 FROM nota_cargas nc
                 JOIN maquinas mm
                   ON (mm.id = nc.lavadora_id AND nc.lavadora_iniciada_at IS NOT NULL)
                   OR (mm.id = nc.secadora_id AND nc.secadora_iniciada_at IS NOT NULL)
                WHERE nc.nota_id = n.id AND mm.estado = 'en_uso') AS maquinas_en_uso,
              -- Secadora que cobra por programa, aún sin precio (Autoservicio).
              -- Una cancelada ya no se cobra: nada queda por definir.
              n.estado <> 'CANCELADA' AND EXISTS (SELECT 1 FROM nota_cargas nc
                       WHERE nc.nota_id = n.id AND nc.secadora_por_definir) AS secadora_por_definir,
              -- ¿Corre ahora alguna lavadora / secadora arrancada por la nota?
              -- Con varias cargas pueden ser las dos.
              EXISTS (SELECT 1 FROM nota_cargas nc JOIN maquinas ml ON ml.id = nc.lavadora_id
                       WHERE nc.nota_id = n.id AND ml.estado = 'en_uso'
                         AND nc.lavadora_iniciada_at IS NOT NULL) AS hay_lavadora_activa,
              EXISTS (SELECT 1 FROM nota_cargas nc JOIN maquinas ms ON ms.id = nc.secadora_id
                       WHERE nc.nota_id = n.id AND ms.estado = 'en_uso'
                         AND nc.secadora_iniciada_at IS NOT NULL) AS hay_secadora_activa,
              -- Autoservicio: lavadoras cuya carga pidió secado y aún no tiene
              -- secadora. Al terminar, la tarjeta pide elegirla ("Iniciar secado").
              -- En Por Encargo la secadora se asigna aparte en Salidas.
              (SELECT COALESCE(json_agg(nc.lavadora_id), '[]'::json)
                 FROM nota_cargas nc
                WHERE nc.nota_id = n.id
                  AND n.tipo_servicio = 'AUTOSERVICIO'
                  AND nc.lavadora_id IS NOT NULL
                  AND nc.secadora_tipo IS NOT NULL
                  AND nc.secadora_id IS NULL
              ) AS lavadoras_con_secado_ids,
              -- ¿Le queda trabajo que no está corriendo? Una máquina pedida y sin
              -- poner, o una puesta que no corre (sin arrancar, esperando o
              -- detenida). Dice si al finalizar la máquina en marcha queda trabajo.
              EXISTS (
                SELECT 1 FROM nota_cargas nc
                 WHERE nc.nota_id = n.id
                   AND (
                     (nc.lavadora_tipo IS NOT NULL AND nc.lavadora_id IS NULL
                      AND nc.lavadora_iniciada_at IS NULL
                      AND nc.lavadora_usada_id IS NULL)
                     OR (nc.secadora_tipo IS NOT NULL AND nc.secadora_id IS NULL
                         AND nc.secadora_iniciada_at IS NULL
                         AND nc.secadora_usada_id IS NULL)
                     -- Puesta y sin correr (iniciada_at no basta: un ciclo
                     -- detenido la deja marcada).
                     OR EXISTS (SELECT 1 FROM maquinas ml2 WHERE ml2.id = nc.lavadora_id
                                 AND NOT (ml2.estado = 'en_uso' AND ml2.en_uso_desde IS NOT NULL))
                     OR EXISTS (SELECT 1 FROM maquinas ms2 WHERE ms2.id = nc.secadora_id
                                 AND NOT (ms2.estado = 'en_uso' AND ms2.en_uso_desde IS NOT NULL))
                   )
              ) AS trabajo_pendiente
       FROM notas n
       LEFT JOIN clientes   c  ON c.id = n.cliente_id
       JOIN      usuarios   u  ON u.id = n.usuario_id
       LEFT JOIN sucursales su ON su.slug = n.sucursal
       WHERE n.sucursal = $1
         AND ($2::int IS NULL OR n.cliente_id = $2)
       ORDER BY n.created_at DESC`,
      [req.sucursal, clienteId]
    );
    res.json(rows);
  } catch (err) {
    console.error('getNotas error:', err);
    res.status(500).json({ message: 'No se pudieron cargar las notas. Intenta de nuevo.' });
  }
};

// ── GET /notas/:id ──────────────────────────────────────────
export const getNotaById = async (req, res) => {
  const { id } = req.params;
  try {
    const { rows } = await pool.query(
      `SELECT n.*,
              c.nombre   AS cliente_nombre,
              c.apellido AS cliente_apellido,
              c.telefono AS cliente_telefono,
              TRIM(u.nombre || ' ' || COALESCE(u.apellido, '')) AS usuario_nombre,
              su.nombre  AS sucursal_nombre,
              su.direccion AS sucursal_direccion,
              -- Para el comodín *Horario* de WhatsApp.
              su.horario_semana AS sucursal_horario_semana,
              -- Mismas máquinas que en la lista: puestas, usadas y del historial.
              (SELECT COALESCE(json_agg(mm.nombre ORDER BY mm.nombre), '[]'::json)
                 FROM (
                   SELECT nc.lavadora_id       AS mid FROM nota_cargas nc WHERE nc.nota_id = n.id
                   UNION SELECT nc.secadora_id        FROM nota_cargas nc WHERE nc.nota_id = n.id
                   UNION SELECT nc.lavadora_usada_id  FROM nota_cargas nc WHERE nc.nota_id = n.id
                   UNION SELECT nc.secadora_usada_id  FROM nota_cargas nc WHERE nc.nota_id = n.id
                   UNION SELECT ncm.maquina_id
                           FROM nota_carga_maquinas ncm
                           JOIN nota_cargas nc ON nc.id = ncm.carga_id
                          WHERE nc.nota_id = n.id
                 ) xm
                 JOIN maquinas mm ON mm.id = xm.mid) AS maquinas_nombres,
              -- Máquinas que esta nota arrancó y siguen corriendo.
              (SELECT COALESCE(json_agg(DISTINCT mm.nombre), '[]'::json)
                 FROM nota_cargas nc
                 JOIN maquinas mm
                   ON (mm.id = nc.lavadora_id AND nc.lavadora_iniciada_at IS NOT NULL)
                   OR (mm.id = nc.secadora_id AND nc.secadora_iniciada_at IS NOT NULL)
                WHERE nc.nota_id = n.id AND mm.estado = 'en_uso') AS maquinas_en_uso,
              -- La forma de pago se corrige solo mientras su caja siga abierta;
              -- un corte cerrado tiene sus cifras congeladas.
              (n.estado_pago = 'PAGADO' AND n.estado <> 'CANCELADA' AND EXISTS (
                 SELECT 1 FROM cajas cj WHERE cj.id = n.caja_id AND cj.estado = 'abierta'
              )) AS forma_pago_editable,
              -- El cobro se revierte si su caja sigue abierta o si se cobró sin
              -- caja (no está en ningún corte).
              (n.estado_pago = 'PAGADO' AND n.estado <> 'CANCELADA' AND (
                 n.caja_id IS NULL
                 OR EXISTS (SELECT 1 FROM cajas cj WHERE cj.id = n.caja_id AND cj.estado = 'abierta')
              )) AS pago_reversible,
              -- Cobro en un corte cerrado: nada que mueva el total se permite
              -- (CorteCerradoError); la pantalla esconde esas acciones.
              (n.estado_pago = 'PAGADO' AND n.caja_id IS NOT NULL AND NOT EXISTS (
                 SELECT 1 FROM cajas cj WHERE cj.id = n.caja_id AND cj.estado = 'abierta'
              )) AS cobro_congelado
       FROM notas n
       LEFT JOIN clientes   c  ON c.id = n.cliente_id
       JOIN      usuarios   u  ON u.id = n.usuario_id
       LEFT JOIN sucursales su ON su.slug = n.sucursal
       WHERE n.id = $1 AND n.sucursal = $2`,
      [id, req.sucursal]
    );
    if (rows.length === 0) {
      return res.status(404).json({ message: 'Nota no encontrada.' });
    }

    const { rows: productos } = await pool.query(
      `SELECT np.id, np.producto_id, a.nombre, np.cantidad, np.unidad, np.precio_unitario,
              a.es_por_medida, a.tipo_liquido, a.forma, a.se_vende_por_unidad, a.clase, a.tamano_bolsa, a.marca,
              (np.cantidad * np.precio_unitario) AS subtotal
       FROM nota_productos np
       JOIN productos a ON a.id = np.producto_id
       WHERE np.nota_id = $1 AND np.carga_id IS NULL
       ORDER BY np.created_at ASC`,
      [id]
    );

    const { rows: movs } = await pool.query(
      `SELECT mi.*, i.nombre AS insumo_nombre, i.unidad
       FROM movimientos_insumos mi
       JOIN insumos i ON i.id = mi.insumo_id
       WHERE mi.nota_id = $1`,
      [id]
    );

    const { rows: historial } = await pool.query(
      `SELECT estado, MIN(created_at) AS created_at
       FROM nota_estado_historial
       WHERE nota_id = $1
       GROUP BY estado
       ORDER BY created_at ASC`,
      [id]
    );

    // Correcciones de forma de pago, con quién y cuándo.
    const { rows: historialPago } = await pool.query(
      `SELECT h.forma_anterior, h.forma_nueva, h.created_at,
              TRIM(u.nombre || ' ' || COALESCE(u.apellido, '')) AS usuario_nombre
         FROM nota_forma_pago_historial h
         LEFT JOIN usuarios u ON u.id = h.usuario_id
        WHERE h.nota_id = $1
        ORDER BY h.created_at ASC`,
      [id]
    );

    const cargas = await cargasDeNota(pool, id);

    // Abonos: los revertidos se muestran pero no suman.
    const { rows: abonos } = await pool.query(
      `SELECT ab.id, ab.monto, ab.forma_pago, ab.created_at, ab.caja_id,
              ab.revertido_at, ab.motivo_reversion,
              TRIM(u.nombre || ' ' || COALESCE(u.apellido, '')) AS usuario_nombre,
              -- Se revierte solo mientras la caja de ese abono siga abierta.
              (ab.revertido_at IS NULL AND (
                 ab.caja_id IS NULL
                 OR EXISTS (SELECT 1 FROM cajas cj WHERE cj.id = ab.caja_id AND cj.estado = 'abierta')
               )) AS reversible
         FROM nota_abonos ab
         LEFT JOIN usuarios u ON u.id = ab.usuario_id
        WHERE ab.nota_id = $1
        ORDER BY ab.created_at ASC`,
      [id]
    );
    const abonado = abonos
      .filter(a => a.revertido_at == null)
      .reduce((s, a) => s + Number(a.monto), 0);

    res.json({
      ...rows[0], productos, cargas, insumos_consumidos: movs,
      historial_estados: historial, historial_forma_pago: historialPago,
      abonos,
      abonado,
      lavadora_terminada: await algunaLavadoraTermino(pool, id),
      saldo: rows[0].estado_pago === 'PAGADO'
        ? 0
        : Math.max(0, Number(rows[0].precio_total) - abonado),
    });
  } catch (err) {
    console.error('getNotaById error:', err);
    res.status(500).json({ message: 'No se pudo cargar la nota. Intenta de nuevo.' });
  }
};

// ── POST /notas ─────────────────────────────────────────────
// Ninguna nota se crea con la caja cerrada (notaRequiereCaja en middleware/cajaAbierta.js).
export const createNota = async (req, res) => {
  const {
    cliente_id,
    tipo_servicio = 'POR_ENCARGO',
    tipo_prenda = 'ROPA',
    estado_pago,
    forma_pago,
    peso_kg,
    fecha_entrega,
    tiempo_entrega,
    instrucciones,
    referencia,     // nombre libre del cliente (Autoservicio)
    tamano,
    tipo_tela,
    tamano_edredon,
    ajuste = 0,
    cargas,         // [{ lavadora_id, secadora_id, activar, ... }] por carga
    insumos   = [], // [{ insumo_id, cantidad }]  → movimientos_insumos
    productos = [], // [{ producto_id, cantidad }] → nota_productos
    abono_inicial,  // { monto, forma_pago }: pago anticipado PARCIAL (Por Encargo)
  } = req.body;

  if (notaRequiereCaja()) {
    const { rows: cajaRows } = await pool.query(
      `SELECT 1 FROM cajas WHERE estado = 'abierta' AND sucursal = $1 LIMIT 1`,
      [req.sucursal]
    );
    if (cajaRows.length === 0) {
      return res.status(409).json({
        code: 'CAJA_CERRADA',
        message: 'La caja está cerrada. Ábrela para poder crear la nota.',
      });
    }
  }

  if (!TIPOS_SERVICIO_VALIDOS.includes(tipo_servicio)) {
    return res.status(400).json({
      message: `Elige un tipo de servicio válido: ${enPalabras(TIPOS_SERVICIO_VALIDOS)}.`,
    });
  }
  if (!TIPOS_PRENDA_VALIDOS.includes(String(tipo_prenda).toUpperCase())) {
    return res.status(400).json({
      message: `Elige qué se recibe: ${enPalabras(TIPOS_PRENDA_VALIDOS)}.`,
    });
  }
  if (!estado_pago || !ESTADOS_PAGO_VALIDOS.includes(estado_pago)) {
    return res.status(400).json({
      message: `Indica si la nota queda ${enPalabras(ESTADOS_PAGO_VALIDOS)}.`,
    });
  }
  // Pago anticipado parcial: la nota nace debiendo y con su primer abono, en la
  // misma transacción. Si cubre todo, la nota llega como PAGADO.
  let abonoInicial = null;
  if (abono_inicial != null) {
    const importe = Number(abono_inicial.monto);
    const forma = normalizarFormaPago(abono_inicial.forma_pago);
    if (estado_pago !== 'PENDIENTE' || tipo_servicio !== 'POR_ENCARGO') {
      return res.status(400).json({ message: 'El abono al crear solo aplica a una nota Por Encargo que queda debiendo.' });
    }
    if (!Number.isFinite(importe) || importe <= 0) {
      return res.status(400).json({ message: 'El abono tiene que ser mayor a $0.' });
    }
    if (!forma) {
      return res.status(400).json({ message: `Indica la forma de pago: ${enPalabras(FORMAS_PAGO_VALIDAS)}.` });
    }
    abonoInicial = { importe, forma };
  }
  // El cliente es opcional en todos los servicios: sin él la nota queda a
  // nombre de Mostrador (el teléfono se guarda en la nota si hace falta).
  // La venta de productos no lleva cargas.
  if (esVenta(tipo_servicio)) {
    if (Array.isArray(cargas) && cargas.length > 0) {
      return res.status(400).json({ message: 'Una venta de productos no lleva cargas: no hay lavado ni secado que cobrar.' });
    }
    if (!Array.isArray(productos) || productos.length === 0) {
      return res.status(400).json({ message: 'Agrega al menos un producto: una venta sin productos no es nota.' });
    }
    // Se cobra en el acto: nace pagada y finalizada.
    if (estado_pago !== 'PAGADO' || !normalizarFormaPago(forma_pago)) {
      return res.status(400).json({
        message: `La venta de productos se cobra al momento: indica la forma de pago (${enPalabras(FORMAS_PAGO_VALIDAS)}).`,
      });
    }
  } else if (!Array.isArray(cargas) || cargas.length === 0) {
    return res.status(400).json({ message: 'La nota necesita al menos una carga.' });
  }
  if (tiempo_entrega && !TIEMPOS_ENTREGA_VALIDOS.includes(String(tiempo_entrega).toUpperCase())) {
    return res.status(400).json({
      message: `Elige cuándo se entrega: ${enPalabras(TIEMPOS_ENTREGA_VALIDOS)}.`,
    });
  }
  // El ajuste puede ser negativo; el total no (se revisa al recalcularlo).
  if (ajuste != null && ajuste !== '' && !Number.isFinite(Number(ajuste))) {
    return res.status(400).json({ message: 'El ajuste debe ser un número.' });
  }

  // Las máquinas se validan por carga en prepararCargas.
  if (cliente_id && !(await perteneceASucursal('clientes', cliente_id, req.sucursal))) {
    return res.status(400).json({ message: 'El cliente seleccionado no existe en esta sucursal.' });
  }
  // Un cliente eliminado con historial queda oculto (activo = FALSE).
  if (cliente_id) {
    const { rows: act } = await pool.query('SELECT activo FROM clientes WHERE id = $1', [cliente_id]);
    if (act[0] && act[0].activo === false) {
      return res.status(400).json({ message: 'Ese cliente se eliminó. Elige otro o regístralo de nuevo.' });
    }
  }

  const ajusteNum = Number(ajuste) || 0;

  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    // La venta de productos no tiene cargas.
    let filasCargas;
    try {
      filasCargas = esVenta(tipo_servicio)
        ? []
        : await prepararCargas(client, cargas, tipo_prenda, req.sucursal, tipo_servicio);
    } catch (e) {
      await client.query('ROLLBACK');
      return res.status(400).json({ message: e.message });
    }
    const cargasSum = filasCargas.reduce((s, f) => s + f.precio_lavadora + f.precio_secadora, 0);
    // No nace pagada con la secadora por definir (su precio sale al iniciarla).
    if (estado_pago === 'PAGADO' && filasCargas.some(f => f.secadora_por_definir)) {
      await client.query('ROLLBACK');
      return res.status(409).json({
        message: 'Inicia la secadora para saber cuánto cobrar: su precio depende del tiempo que se elija.',
      });
    }

    const idsMaquinasNota = [...new Set(filasCargas.flatMap(f => [f.lavadora_id, f.secadora_id]).filter(Boolean))];

    // Solo las cargas que se activan toman su máquina; si ninguna, la nota
    // nace En Espera con las máquinas asignadas pero libres.
    const idsActivar = [...new Set(filasCargas.filter(f => f.activar).flatMap(f => [f.lavadora_id, f.secadora_id]).filter(Boolean))];
    const estadoNota = esVenta(tipo_servicio)
      ? 'FINALIZADA'
      : idsActivar.length > 0
        ? (filasCargas.some(f => f.activar && f.lavadora_id) ? 'LAVANDO' : 'SECANDO')
        : 'EN_ESPERA';

    const { rows: notaRows } = await client.query(
      `INSERT INTO notas
         (cliente_id, usuario_id, tipo_servicio, tipo_prenda, estado, estado_pago, sucursal,
          peso_kg, precio_total, fecha_entrega, tiempo_entrega, instrucciones,
          tamano, tipo_tela, tamano_edredon, ajuste, forma_pago, referencia)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18)
       RETURNING *`,
      [
        cliente_id   || null,
        req.user.id,
        tipo_servicio,
        String(tipo_prenda).toUpperCase(),
        estadoNota,
        estado_pago,
        req.sucursal,
        peso_kg      || null,
        cargasSum + ajusteNum,
        fecha_entrega || null,
        tiempo_entrega ? String(tiempo_entrega).toUpperCase() : null,
        instrucciones || null,
        tamano ? String(tamano).toLowerCase() : null,
        tipo_tela ? String(tipo_tela).trim() : null,
        tamano_edredon ? String(tamano_edredon).trim() : null,
        ajusteNum,
        // Forma de pago solo si nace PAGADO.
        estado_pago === 'PAGADO' ? normalizarFormaPago(forma_pago) : null,
        String(referencia ?? '').trim().slice(0, 80) || null,
      ]
    );
    const nota = notaRows[0];

    const folio = generarFolio(await tomarNumeroFolio(client, req.sucursal), nota.created_at);
    await client.query('UPDATE notas SET folio = $1 WHERE id = $2', [folio, nota.id]);
    nota.folio = folio;

    // Apartar productos puede fallar por existencia: se responde 400 con el motivo.
    let cargasInsertadas;
    try {
      cargasInsertadas = await insertarCargas(client, nota.id, filasCargas, req.sucursal, tipo_servicio);
    } catch (e) {
      await client.query('ROLLBACK');
      return res.status(400).json({ message: e.message });
    }
    if (idsActivar.length > 0) {
      const { rows: maqs } = await client.query(
        'SELECT id, nombre, estado FROM maquinas WHERE id = ANY($1) FOR UPDATE',
        [idsActivar]
      );
      const ocupada = maqs.find(m => m.estado !== 'disponible');
      if (ocupada) {
        await client.query('ROLLBACK');
        return res.status(400).json({ message: `La máquina ${ocupada.nombre} no está disponible.` });
      }
      await client.query(
        `UPDATE maquinas SET estado = 'en_uso', en_uso_desde = NOW() WHERE id = ANY($1)`,
        [idsActivar]
      );
      await marcarMaquinasIniciadas(client, nota.id, idsActivar);
      await sellarCicloMaquinas(client, nota.id);
    }

    if (tipo_servicio === 'POR_ENCARGO' || tipo_servicio === 'AUTOSERVICIO') {
      for (const { insumo_id, cantidad } of insumos) {
        if (!insumo_id || !cantidad || cantidad <= 0) continue;

        const { rows: stockRows } = await client.query(
          'SELECT stock_actual FROM insumos WHERE id = $1 AND sucursal = $2 FOR UPDATE',
          [insumo_id, req.sucursal]
        );
        if (stockRows.length === 0) {
          await client.query('ROLLBACK');
          return res.status(404).json({ message: 'El insumo seleccionado no existe en esta sucursal.' });
        }
        if (Number(stockRows[0].stock_actual) < cantidad) {
          await client.query('ROLLBACK');
          return res.status(400).json({ message: 'No hay existencia suficiente de ese insumo.' });
        }

        await client.query(
          `INSERT INTO movimientos_insumos (insumo_id, usuario_id, nota_id, tipo, cantidad)
           VALUES ($1, $2, $3, 'salida', $4)`,
          [insumo_id, req.user.id, nota.id, cantidad]
        );
        await client.query(
          'UPDATE insumos SET stock_actual = stock_actual - $1 WHERE id = $2',
          [cantidad, insumo_id]
        );
      }
    }

    // Productos sueltos de la nota (sin carga).
    const productosInsertados = [];
    for (const { producto_id, cantidad } of productos) {
      if (!producto_id || !cantidad || Number(cantidad) <= 0) continue;
      try {
        productosInsertados.push(
          await reservarProducto(client, nota.id, null, producto_id, cantidad, req.sucursal, tipo_servicio)
        );
      } catch (e) {
        await client.query('ROLLBACK');
        return res.status(400).json({ message: e.message });
      }
    }

    if (productosInsertados.length > 0 || filasCargas) {
      nota.precio_total = await recalcularPrecioTotal(client, nota.id);
    }

    if (nota.precio_total != null && Number(nota.precio_total) < 0) {
      await client.query('ROLLBACK');
      return res.status(400).json({ message: 'El total de la nota no puede ser negativo. Revisa el ajuste.' });
    }

    const errTope = await validarTopesCargas(client, nota.id);
    if (errTope) {
      await client.query('ROLLBACK');
      return res.status(400).json({ message: errTope });
    }

    // La venta nace finalizada: sus productos salen del inventario ya.
    if (esVenta(tipo_servicio)) {
      await consumirProductosDeNota(client, nota.id, req.sucursal, req.user.id);
    }

    // El pago anticipado parcial es el primer abono, en la caja abierta.
    if (abonoInicial) {
      const total = Number(nota.precio_total ?? 0);
      if (abonoInicial.importe >= total - 1e-9) {
        await client.query('ROLLBACK');
        return res.status(400).json({
          message: `El abono cubre todo ($${total.toFixed(2)}): cobra la nota completa en lugar de abonar.`,
        });
      }
      const { rows: cajaRows } = await client.query(
        `SELECT id FROM cajas WHERE estado = 'abierta' AND sucursal = $1 LIMIT 1`,
        [req.sucursal]
      );
      await client.query(
        `INSERT INTO nota_abonos (nota_id, caja_id, usuario_id, monto, forma_pago)
         VALUES ($1, $2, $3, $4, $5)`,
        [nota.id, cajaRows[0]?.id ?? null, req.user?.id ?? null, abonoInicial.importe, abonoInicial.forma]
      );
    }

    await client.query('COMMIT');
    res.status(201).json({ ...nota, cargas: cargasInsertadas, productos: productosInsertados });
  } catch (err) {
    await client.query('ROLLBACK');
    if (respondioCorteCerrado(res, err)) return;
    console.error('createNota error:', err);
    if (err.code === '23503') {
      return res.status(400).json({ message: 'El cliente o la máquina seleccionada no existe en esta sucursal.' });
    }
    res.status(500).json({ message: 'No se pudo crear la nota. Intenta de nuevo.' });
  } finally {
    client.release();
  }
};

// ── DELETE /notas/:id/cargas/:cargaId ───────────────────────
/**
 * Quita una carga que nunca arrancó (las que ya corrieron son historial). Deja
 * de cobrarse y, si la nota ya no tiene nada pendiente, se cierra. No se puede
 * quitar la última carga.
 */
export const quitarCarga = async (req, res) => {
  const { id, cargaId } = req.params;
  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    const { rows: notaRows } = await client.query(
      'SELECT estado, estado_pago FROM notas WHERE id = $1 AND sucursal = $2 FOR UPDATE',
      [id, req.sucursal]
    );
    if (notaRows.length === 0) {
      await client.query('ROLLBACK');
      return res.status(404).json({ message: 'Nota no encontrada.' });
    }
    if (['FINALIZADA', 'CANCELADA'].includes(notaRows[0].estado)) {
      await client.query('ROLLBACK');
      return res.status(409).json({ message: `No se puede cambiar una nota ${palabra(notaRows[0].estado)}.` });
    }

    const { rows: cargaRows } = await client.query(
      `SELECT id, lavadora_id, secadora_id, lavadora_iniciada_at, secadora_iniciada_at
         FROM nota_cargas WHERE id = $1 AND nota_id = $2 FOR UPDATE`,
      [cargaId, id]
    );
    if (cargaRows.length === 0) {
      await client.query('ROLLBACK');
      return res.status(404).json({ message: 'Esa carga no es de esta nota.' });
    }
    const carga = cargaRows[0];

    // Ya corrió si la vuelta en curso arrancó o si tiene vueltas anteriores
    // (un relavado pendiente limpia la marca de arranque).
    const { rows: [{ corrio }] } = await client.query(
      `SELECT EXISTS (SELECT 1 FROM nota_carga_maquinas
                       WHERE carga_id = $1
                         AND (encendida_at IS NOT NULL OR finalizada_at IS NOT NULL)) AS corrio`,
      [cargaId]
    );
    if (carga.lavadora_iniciada_at || carga.secadora_iniciada_at || corrio) {
      await client.query('ROLLBACK');
      return res.status(409).json({
        message: 'Esa carga ya se procesó y no se puede quitar. Solo se quitan las que nunca arrancaron.',
      });
    }

    const { rows: [{ total }] } = await client.query(
      'SELECT COUNT(*)::int AS total FROM nota_cargas WHERE nota_id = $1', [id]
    );
    if (total <= 1) {
      await client.query('ROLLBACK');
      return res.status(409).json({
        message: 'La nota se quedaría sin cargas. Si ya no aplica, cancélala.',
      });
    }

    // Sus productos vuelven al inventario (el CASCADE los borra sin hacerlo).
    {
      const { rows: deLaCarga } = await client.query(
        'SELECT id FROM nota_productos WHERE carga_id = $1', [cargaId]
      );
      if (deLaCarga.length > 0) {
        await devolverProductosDeNota(client, id, req.sucursal, req.user?.id, { ids: deLaCarga.map(r => r.id) });
      }
    }

    // Solo se apaga la máquina que esta nota encendió sin arrancar; si una está
    // en uso, la arrancó otra nota y no se toca.
    const asignadas = [carga.lavadora_id, carga.secadora_id].filter(Boolean);
    if (asignadas.length > 0) {
      await client.query(
        `UPDATE maquinas
            SET encendida_sin_iniciar_at = NULL,
                encendida_para_nota_id   = NULL,
                estado = CASE WHEN estado = 'en_uso' AND en_uso_desde IS NULL
                              THEN 'disponible'::estado_maquina ELSE estado END
          WHERE id = ANY($1) AND encendida_para_nota_id = $2`,
        [asignadas, id]
      );
    }

    await client.query('DELETE FROM nota_cargas WHERE id = $1', [cargaId]);

    await recalcularPrecioTotal(client, id, {
      desmarcarPagoSiCambia: true, usuarioId: req.user?.id, sucursal: req.sucursal,
    });

    // Quitar la última carga pendiente puede dejar la nota terminada.
    if (['EN_ESPERA', 'LAVANDO', 'SECANDO'].includes(notaRows[0].estado)
        && !(await hayCargasPendientes(client, id))) {
      await cerrarNotaSinCargasPendientes(client, id, {
        sucursal: req.sucursal, usuarioId: req.user?.id,
      });
    }

    await client.query('COMMIT');

    const { rows } = await pool.query('SELECT * FROM notas WHERE id = $1', [id]);
    res.json({ ...rows[0], cargas: await cargasDeNota(pool, id) });
  } catch (err) {
    await client.query('ROLLBACK');
    if (respondioCorteCerrado(res, err)) return;
    console.error('quitarCarga error:', err);
    res.status(500).json({ message: 'No se pudo quitar la carga. Intenta de nuevo.' });
  } finally {
    client.release();
  }
};

// En true los empleados también cancelan (se usó en capacitaciones); va junto con DetalleNota.jsx.
const EMPLEADOS_CANCELAN = false;

// ── DELETE /notas/:id ───────────────────────────────────────
export const eliminarNota = async (req, res) => {
  if (!esAdminMain(req.user.rol)) {
    return res.status(403).json({ message: 'Solo el Admin Main puede eliminar notas.' });
  }
  const { id } = req.params;
  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    const { rows: notaRows } = await client.query(
      `SELECT estado, tipo_servicio, folio, estado_pago, caja_id
         FROM notas WHERE id = $1 AND sucursal = $2 FOR UPDATE`,
      [id, req.sucursal]
    );
    if (notaRows.length === 0) {
      await client.query('ROLLBACK');
      return res.status(404).json({ message: 'Nota no encontrada.' });
    }
    const { estado: estadoNota } = notaRows[0];

    // No se borra una nota cuyo cobro o algún abono vivo esté en un corte
    // cerrado: el corte conserva ese dinero y Ventas lo perdería. Sin caja, o
    // con la caja abierta, sí se borra.
    if (notaRows[0].estado_pago === 'PAGADO' && notaRows[0].caja_id) {
      const { rows: cj } = await client.query(
        'SELECT estado FROM cajas WHERE id = $1 FOR SHARE', [notaRows[0].caja_id]
      );
      if (cj[0]?.estado !== 'abierta') {
        await client.query('ROLLBACK');
        return res.status(409).json({
          message: `El cobro de la nota ${notaRows[0].folio} ya quedó en un corte cerrado, así que `
                 + 'la nota no se puede eliminar: ese dinero está contado ahí y el corte no se '
                 + 'reabre. Si hay que devolverlo, regístralo como salida de caja.',
        });
      }
    }

    const { rows: abonoCerrado } = await client.query(
      `SELECT 1 FROM nota_abonos ab
         JOIN cajas c ON c.id = ab.caja_id
        WHERE ab.nota_id = $1 AND ab.revertido_at IS NULL AND c.estado <> 'abierta'
        LIMIT 1`,
      [id]
    );
    if (abonoCerrado.length > 0) {
      await client.query('ROLLBACK');
      return res.status(409).json({
        message: `Un abono de la nota ${notaRows[0].folio} ya quedó en un corte cerrado, así que `
               + 'la nota no se puede eliminar: ese dinero está contado ahí y el corte no se '
               + 'reabre. Si hay que devolverlo, regístralo como salida de caja.',
      });
    }

    // No se borra con una máquina corriendo (hay ropa dentro). La encendida sin
    // arrancar (`en_uso_desde` NULL) sí: se apaga más abajo.
    const { rows: corriendo } = await client.query(
      `SELECT DISTINCT m.nombre, m.tipo
         FROM maquinas m
         JOIN (
           SELECT lavadora_id AS mid FROM nota_cargas
            WHERE nota_id = $1 AND lavadora_iniciada_at IS NOT NULL
           UNION
           SELECT secadora_id FROM nota_cargas
            WHERE nota_id = $1 AND secadora_iniciada_at IS NOT NULL
         ) x ON x.mid = m.id
        WHERE m.estado = 'en_uso' AND m.en_uso_desde IS NOT NULL
        ORDER BY m.nombre`,
      [id]
    );
    if (corriendo.length > 0) {
      await client.query('ROLLBACK');
      const nombres = listaY(corriendo.map(m => m.nombre));
      const una = corriendo.length === 1;
      const haciendo = una
        ? (corriendo[0].tipo === 'secadora' ? 'está secando' : 'está lavando')
        : 'siguen en uso';
      return res.status(409).json({
        message: `No se puede eliminar la nota: ${una ? 'la máquina' : 'las máquinas'} ${nombres} ${haciendo}. `
               + `Termina o detén ${una ? 'su ciclo' : 'sus ciclos'} antes de eliminarla.`,
      });
    }

    // ANTES del DELETE: el ON DELETE SET NULL dejaría media marca de encendido y
    // fallaría el CHECK que exige las dos juntas.
    await apagarEncendidasSinArrancar(client, id);
    // Antes del DELETE, que borra las cargas. Solo las que esta nota arrancó.
    const { rows: iniciadasRows } = await client.query(
      `SELECT DISTINCT mid FROM (
         SELECT lavadora_id AS mid FROM nota_cargas
          WHERE nota_id = $1 AND lavadora_iniciada_at IS NOT NULL
         UNION
         SELECT secadora_id FROM nota_cargas
          WHERE nota_id = $1 AND secadora_iniciada_at IS NOT NULL
       ) x WHERE mid IS NOT NULL`,
      [id]
    );
    const maquinasNota = iniciadasRows.map(r => r.mid);

    // Lo descontado vuelve al inventario y lo apartado se suelta. Una nota
    // cancelada ya lo hizo al cancelarse.
    if (estadoNota !== 'CANCELADA') {
      await devolverProductosDeNota(client, id, req.sucursal, req.user.id);
    }

    await client.query('DELETE FROM notas WHERE id = $1', [id]);

    if (maquinasNota.length > 0) {
      await client.query(
        `UPDATE maquinas
           SET estado = 'disponible',
               en_uso_desde = NULL
         WHERE id = ANY($1) AND estado = 'en_uso'`,
        [maquinasNota]
      );
    }

    await registrarEliminacionNota(client, { id, folio: notaRows[0].folio }, req.user.id, req.sucursal);

    await client.query('COMMIT');
    res.status(204).send();
  } catch (err) {
    await client.query('ROLLBACK');
    console.error('eliminarNota error:', err);
    res.status(500).json({ message: 'No se pudo eliminar la nota. Intenta de nuevo.' });
  } finally {
    client.release();
  }
};

// ── PATCH /notas/:id/estado ─────────────────────────────────
export const cambiarEstadoNota = async (req, res) => {
  const { id } = req.params;
  const { estado } = req.body;

  if (!estado || !ESTADOS_VALIDOS.includes(estado)) {
    return res.status(400).json({
      message: `Ese estado no es válido. Los estados son: ${enPalabras(ESTADOS_VALIDOS)}.`,
    });
  }

  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    const { rows: notaRows } = await client.query(
      'SELECT estado, estado_pago, tipo_servicio FROM notas WHERE id = $1 AND sucursal = $2 FOR UPDATE',
      [id, req.sucursal]
    );
    if (notaRows.length === 0) {
      await client.query('ROLLBACK');
      return res.status(404).json({ message: 'Nota no encontrada.' });
    }

    const estadoActual = notaRows[0].estado;

    // Cancelar es de administrador (por ahora también de empleados).
    if (estado === 'CANCELADA' && !esAdmin(req.user?.rol) && !EMPLEADOS_CANCELAN) {
      await client.query('ROLLBACK');
      return res.status(403).json({ message: 'Solo un administrador puede cancelar una nota.' });
    }

    // Una nota cobrada o con abonos vivos no se cancela: el corte esperaría un
    // dinero que se devolvió. Primero se revierte el pago o los abonos.
    if (estado === 'CANCELADA'
        && (notaRows[0].estado_pago === 'PAGADO' || estadoActual === 'PAGADA')) {
      await client.query('ROLLBACK');
      return res.status(409).json({
        message: 'La nota ya está pagada. Para cancelarla, primero revierte el pago.',
      });
    }

    if (estado === 'CANCELADA') {
      const abonado = await totalAbonado(client, id);
      if (abonado > 0) {
        await client.query('ROLLBACK');
        return res.status(409).json({
          message: `La nota tiene $${abonado.toFixed(2)} abonados. Para cancelarla, primero revierte los abonos.`,
        });
      }
    }

    if (['FINALIZADA', 'CANCELADA'].includes(estadoActual)) {
      await client.query('ROLLBACK');
      return res.status(400).json({
        message: `No se puede cambiar el estado de una nota ${palabra(estadoActual)}.`,
      });
    }

    const permitidos = TRANSICIONES_VALIDAS[estadoActual] || [];
    if (!permitidos.includes(estado)) {
      await client.query('ROLLBACK');
      return res.status(400).json({
        message: `Una nota ${palabra(estadoActual)} no puede pasar a ${palabra(estado)}. Desde aquí solo puede pasar a: ${permitidos.map(palabra).join(', ') || 'ningún otro estado'}.`,
      });
    }

    // "Procesado" (Por Encargo → Por Entregar) exige que haya terminado al
    // menos una lavadora. La pantalla ya esconde el botón; esto cubre el resto.
    if (estado === 'LISTA' && notaRows[0].tipo_servicio === 'POR_ENCARGO'
        && !(await algunaLavadoraTermino(client, id))) {
      await client.query('ROLLBACK');
      return res.status(409).json({
        message: 'Todavía no termina ninguna lavadora de esta nota: no se puede marcar como procesada.',
      });
    }

    // No se entrega una nota que debe: primero se liquida.
    if (estado === 'FINALIZADA' && notaRows[0].estado_pago === 'PENDIENTE') {
      await client.query('ROLLBACK');
      return res.status(400).json({
        message: 'No se puede finalizar una nota pendiente de pago. Liquídala primero.',
      });
    }

    if (estado === 'CANCELADA') {
      await devolverProductosDeNota(client, id, req.sucursal, req.user.id);
    } else if (estado === 'PAGADA' || estado === 'FINALIZADA') {
      // Al cobrar o entregar sale del inventario lo que seguía apartado.
      await consumirProductosDeNota(client, id, req.sucursal, req.user.id);
    }

    // Motivo opcional de la cancelación.
    const motivoCancel = estado === 'CANCELADA'
      ? (typeof req.body?.motivo === 'string' ? req.body.motivo.trim() || null : null)
      : null;
    const { rows } = await client.query(
      `UPDATE notas SET estado = $1${estado === 'CANCELADA' ? ', motivo_cancelacion = $3' : ''} WHERE id = $2 RETURNING *`,
      estado === 'CANCELADA' ? [estado, id, motivoCancel] : [estado, id]
    );

    // Al pasar a Por Entregar o cancelar, la nota suelta sus máquinas.
    if (estado === 'LISTA' || estado === 'CANCELADA') {
      await liberarMaquinasDeNota(client, id);
    }

    if (estado === 'CANCELADA') {
      await registrarCancelacionNota(client, rows[0], req.user.id, req.sucursal, motivoCancel);
    }

    await client.query('COMMIT');
    res.json(rows[0]);
  } catch (err) {
    await client.query('ROLLBACK');
    console.error('cambiarEstadoNota error:', err);
    res.status(500).json({ message: 'No se pudo cambiar el estado de la nota. Intenta de nuevo.' });
  } finally {
    client.release();
  }
};

/**
 * ¿A la carga de esta nota en esta máquina le quedan ciclos? Distingue
 * "encenderla para otra vuelta" de "la carga terminó, hay que cerrarla".
 */
async function cargaConCiclosDisponibles(client, notaId, maquinaId) {
  const { rows } = await client.query(
    `SELECT CASE WHEN nc.lavadora_id = $2 THEN nc.lavadora_ciclos
                 ELSE nc.secadora_ciclos END AS ciclos,
            m.tipo,
            -- La vuelta extra corre un solo ciclo.
            COALESCE((
              SELECT ncm.ciclo_unico FROM nota_carga_maquinas ncm
               WHERE ncm.carga_id = nc.id
                 AND ncm.slot = CASE WHEN nc.lavadora_id = $2 THEN 'lavadora' ELSE 'secadora' END
               ORDER BY ncm.asignada_at DESC, ncm.id DESC LIMIT 1
            ), FALSE) AS ciclo_unico,
            ${MINUTOS_CONFIGURADOS} AS minutos_ciclo,
            -- Un modelo de ciclo único no ofrece otra vuelta.
            ${OPCIONES_DE_MARCA} AS marca_opciones
       FROM nota_cargas nc
       -- Para el tope de ciclos de la máquina (sin tiempo configurado corre uno).
       JOIN maquinas m ON m.id = $2
      WHERE nc.nota_id = $1
        AND ((nc.lavadora_id = $2 AND nc.lavadora_iniciada_at IS NOT NULL)
          OR (nc.secadora_id = $2 AND nc.secadora_iniciada_at IS NOT NULL))
      LIMIT 1`,
    [notaId, maquinaId]
  );
  return rows.length > 0 && rows[0].ciclos < maxCiclosDeMaquina(rows[0]);
}

// ── PATCH /notas/:id/encender-maquina ───────────────────────
/**
 * Da corriente a la máquina sin arrancar su ciclo, para meter la ropa antes de
 * "Iniciar". Queda 'en_uso' pero sin `en_uso_desde` (encendida esperando) y la
 * espera caduca sola (ESPERA_ARRANQUE_MINUTOS).
 *
 * Con cronómetro y sin botón Iniciar, encender ya arranca la carga. Las de solo
 * fichas no se encienden. Si a la carga le queda otro ciclo, vuelve a la espera.
 */
export const encenderMaquinaDeNota = async (req, res) => {
  const { id } = req.params;
  const { maquina_id } = req.body ?? {};
  if (maquina_id == null) {
    return res.status(400).json({ message: 'Falta indicar la máquina.' });
  }
  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    const { rows: notaRows } = await client.query(
      'SELECT estado, tipo_servicio, estado_pago FROM notas WHERE id = $1 AND sucursal = $2 FOR UPDATE',
      [id, req.sucursal]
    );
    if (notaRows.length === 0) {
      await client.query('ROLLBACK');
      return res.status(404).json({ message: 'Nota no encontrada.' });
    }
    if (['LISTA', 'PAGADA', 'FINALIZADA', 'CANCELADA'].includes(notaRows[0].estado)) {
      await client.query('ROLLBACK');
      return res.status(400).json({ message: `No se pueden encender máquinas de una nota ${palabra(notaRows[0].estado)}.` });
    }
    const ids = await maquinasDeNota(client, id);
    if (!ids.some(x => String(x) === String(maquina_id))) {
      await client.query('ROLLBACK');
      return res.status(400).json({ message: 'La máquina no está asignada a esta nota.' });
    }
    const faltaGranel = await granelSinElegir(client, id, [maquina_id]);
    if (faltaGranel) {
      await client.query('ROLLBACK');
      return res.status(409).json({ message: faltaGranel });
    }

    // FOR UPDATE: dos clics simultáneos sobre la misma máquina se serializan.
    const { rows: maqRows } = await client.query(
      `SELECT m.id, m.nombre, m.tipo, m.marca, m.estado, m.en_uso_desde, m.encendida_para_nota_id,
              ${esCronometroSql('m')} AS cronometro,
              ${conIniciarSql('m')} AS con_iniciar,
              ${soloFichasSql('m')} AS solo_fichas
         FROM maquinas m WHERE m.id = $1 AND m.sucursal = $2 FOR UPDATE OF m`,
      [maquina_id, req.sucursal]
    );
    if (maqRows.length === 0) {
      await client.query('ROLLBACK');
      return res.status(404).json({ message: 'Máquina no encontrada.' });
    }
    const maq = maqRows[0];

    // Solo fichas: no tiene Sonoff; su único paso es "Iniciar".
    if (maq.solo_fichas) {
      await client.query('ROLLBACK');
      return res.status(400).json({
        message: `${maq.nombre} trabaja con fichas: no se enciende. Arráncala con su ficha y dale a Iniciar.`,
      });
    }

    // Ya encendida por esta nota (doble clic): se responde ok.
    if (maq.estado === 'en_uso' && maq.en_uso_desde == null
        && String(maq.encendida_para_nota_id) === String(id)) {
      await client.query('ROLLBACK');
      return res.json({ message: `${maq.nombre} ya está encendida.`, maquina: maq });
    }

    // Otro ciclo de la misma carga: la máquina terminó su ciclo y vuelve a
    // "encendida esperando", igual que la primera vez.
    const listaParaOtroCiclo =
      maq.estado === 'en_uso' && maq.en_uso_desde != null && await cargaConCiclosDisponibles(client, id, maq.id);

    if (listaParaOtroCiclo) {
      const { rows: reUpd } = await client.query(
        `UPDATE maquinas
            SET encendida_sin_iniciar_at = NOW(),
                encendida_para_nota_id   = $2,
                -- Sin ciclo hasta que arranque el siguiente.
                en_uso_desde  = NULL,
                ciclo_minutos = NULL
          WHERE id = $1 RETURNING *`,
        [maquina_id, id]
      );
      await client.query('COMMIT');
      await sincronizarSonoff(Number(maquina_id));
      return res.json({
        message: `${maq.nombre} encendida. Arráncala otra vez y dale a Iniciar ciclo.`,
        maquina: reUpd[0],
      });
    }

    // Cronómetro ya corriendo para esta nota (doble clic).
    const cronometro = Boolean(maq.cronometro);
    if (cronometro && maq.estado === 'en_uso' && maq.en_uso_desde != null) {
      const { rowCount: yaEsDeEstaNota } = await client.query(
        `SELECT 1 FROM nota_cargas
          WHERE nota_id = $1
            AND ((lavadora_id = $2 AND lavadora_iniciada_at IS NOT NULL)
              OR (secadora_id = $2 AND secadora_iniciada_at IS NOT NULL))`,
        [id, maquina_id]
      );
      if (yaEsDeEstaNota > 0) {
        await client.query('ROLLBACK');
        return res.json({ message: `${maq.nombre} ya está encendida.`, maquina: maq });
      }
    }

    if (maq.estado !== 'disponible') {
      const duena = maq.estado === 'en_uso'
        ? await notaQueUsaMaquina(client, Number(maquina_id), Number(id))
        : null;
      await client.query('ROLLBACK');
      return res.status(409).json({
        message: duena
          ? `${maq.nombre} ya la está usando la nota ${duena.folio ?? `#${duena.id}`}. Cámbiala por otra en esta carga.`
          : `${maq.nombre} no está disponible.`,
      });
    }

    // Cronómetro sin botón Iniciar: encender arranca la carga, como
    // activar-pendientes. Las que tienen botón Iniciar siguen abajo.
    if (cronometro && !maq.con_iniciar) {
      // Si es la secadora de una carga cuya lavadora sigue puesta, la lavadora
      // ya terminó y se suelta (queda en lavadora_usada_id).
      const { rows: lavASoltar } = await client.query(
        `SELECT nc.id AS carga_id, nc.lavadora_id
           FROM nota_cargas nc
           JOIN maquinas ml ON ml.id = nc.lavadora_id
          WHERE nc.nota_id = $1 AND nc.secadora_id = $2 AND ml.estado = 'en_uso'
            AND nc.lavadora_iniciada_at IS NOT NULL`,
        [id, maquina_id]
      );
      const { rows: arr } = await client.query(
        `UPDATE maquinas
            SET estado = 'en_uso',
                en_uso_desde = NOW(),
                encendida_sin_iniciar_at = NULL,
                encendida_para_nota_id   = NULL
          WHERE id = $1 RETURNING *`,
        [maquina_id]
      );
      await marcarMaquinasIniciadas(client, id, [Number(maquina_id)]);
      if (lavASoltar.length > 0) {
        await sellarPasadasVivas(client, lavASoltar.map(r => r.lavadora_id));
        await client.query(
          `UPDATE maquinas SET estado = 'disponible', en_uso_desde = NULL WHERE id = ANY($1)`,
          [lavASoltar.map(r => r.lavadora_id)]
        );
        await client.query(
          'UPDATE nota_cargas SET lavadora_id = NULL WHERE id = ANY($1)',
          [lavASoltar.map(r => r.carga_id)]
        );
      }
      await sellarCicloMaquinas(client, id);
      const fase = await faseProcesoDeNota(client, id);
      await client.query(`UPDATE notas SET estado = $1 WHERE id = $2`, [fase, id]);
      await client.query('COMMIT');
      await sincronizarSonoff(Number(maquina_id));
      for (const r of lavASoltar) await sincronizarSonoff(Number(r.lavadora_id));
      return res.json({
        message: `${maq.nombre} encendida. Carga la ropa y arráncala con su botón; finalízala desde su tarjeta cuando termine.`,
        maquina: arr[0],
      });
    }

    const { rows: upd } = await client.query(
      `UPDATE maquinas
          SET estado = 'en_uso',
              encendida_sin_iniciar_at = NOW(),
              encendida_para_nota_id   = $2,
              -- Sin ciclo hasta que arranque el lavado.
              en_uso_desde  = NULL,
              ciclo_minutos = NULL
        WHERE id = $1 RETURNING *`,
      [maquina_id, id]
    );

    await client.query('COMMIT');

    // Directo, sin esperar al trigger (ver el import).
    await sincronizarSonoff(Number(maquina_id));

    res.json({
      message: `${maq.nombre} encendida. Carga la ropa y arráncala; después dale a Iniciar.`,
      maquina: upd[0],
    });
  } catch (err) {
    await client.query('ROLLBACK').catch(() => {});
    console.error('encenderMaquinaDeNota error:', err);
    res.status(500).json({ message: 'No se pudo encender la máquina. Intenta de nuevo.' });
  } finally {
    client.release();
  }
};

// ── PATCH /notas/:id/activar-pendientes ─────────────────────
/**
 * "Iniciar": arranca las máquinas asignadas a la nota que estén libres o
 * encendidas esperando por ella. Sin body, todas; con `maquina_id`, solo esa
 * (y `minutos` si el modelo pregunta el programa).
 */
export const activarMaquinasPendientes = async (req, res) => {
  const { id } = req.params;
  const { maquina_id, minutos } = req.body ?? {};
  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    let elegido = null;
    if (maquina_id) {
      const leido = await tiempoElegidoDeMaquina(client, maquina_id, minutos);
      if (leido?.error) {
        await client.query('ROLLBACK');
        return res.status(400).json({ message: leido.error });
      }
      if (leido) elegido = { maquinaId: maquina_id, minutos: leido.minutos };
    }

    const { rows: notaRows } = await client.query(
      'SELECT estado, tipo_servicio, estado_pago FROM notas WHERE id = $1 AND sucursal = $2 FOR UPDATE',
      [id, req.sucursal]
    );
    if (notaRows.length === 0) {
      await client.query('ROLLBACK');
      return res.status(404).json({ message: 'Nota no encontrada.' });
    }
    if (['LISTA', 'PAGADA', 'FINALIZADA', 'CANCELADA'].includes(notaRows[0].estado)) {
      await client.query('ROLLBACK');
      return res.status(400).json({ message: `No se pueden activar máquinas de una nota ${palabra(notaRows[0].estado)}.` });
    }
    const ids = await maquinasDeNota(client, id);
    if (ids.length === 0) {
      await client.query('ROLLBACK');
      return res.status(400).json({ message: 'La nota no tiene máquinas asignadas.' });
    }
    const faltaGranel = await granelSinElegir(client, id, maquina_id ? [maquina_id] : ids);
    if (faltaGranel) {
      await client.query('ROLLBACK');
      return res.status(409).json({ message: faltaGranel });
    }
    const { rows: maqs } = await client.query(
      `SELECT id, estado, en_uso_desde, encendida_para_nota_id
         FROM maquinas WHERE id = ANY($1) AND sucursal = $2 FOR UPDATE`,
      [ids, req.sucursal]
    );
    // Arrancable = libre, o encendida por esta nota esperando su arranque.
    const esperandoDeEstaNota = (m) =>
      m.estado === 'en_uso'
      && m.en_uso_desde == null
      && String(m.encendida_para_nota_id) === String(id);
    let libres = maqs
      .filter(m => m.estado === 'disponible' || esperandoDeEstaNota(m))
      .map(m => m.id);

    // Con maquina_id, solo esa. Aquí se decide quién se queda con una máquina
    // asignada a varias notas: la primera en iniciar (el FOR UPDATE serializa).
    if (maquina_id != null) {
      if (!libres.some(x => String(x) === String(maquina_id))) {
        const asignada = maqs.some(m => String(m.id) === String(maquina_id));
        const ocupada = maqs.find(m => String(m.id) === String(maquina_id)
                                       && m.estado === 'en_uso' && !esperandoDeEstaNota(m));
        let mensaje = 'La máquina no está asignada a la nota o no está disponible.';
        if (ocupada) {
          const duena = await notaQueUsaMaquina(client, Number(maquina_id), Number(id));
          const { rows: nomRows } = await client.query('SELECT nombre FROM maquinas WHERE id = $1', [maquina_id]);
          const nombre = nomRows[0]?.nombre ?? 'La máquina';
          mensaje = duena
            ? `${nombre} ya la está usando la nota ${duena.folio ?? `#${duena.id}`}. Cámbiala por otra en esta carga.`
            : `${nombre} ya está en uso. Cámbiala por otra en esta carga.`;
        } else if (!asignada) {
          mensaje = 'La máquina no está asignada a esta nota.';
        }
        await client.query('ROLLBACK');
        return res.status(409).json({ message: mensaje });
      }
      libres = [Number(maquina_id)];
    }

    if (libres.length === 0) {
      await client.query('ROLLBACK');
      return res.status(400).json({ message: 'No hay máquinas pendientes por activar.' });
    }

    // La secadora por definir no arranca sin su programa: de él sale el precio.
    const { rows: porDefinir } = await client.query(
      `SELECT DISTINCT m.id, m.nombre
         FROM nota_cargas nc JOIN maquinas m ON m.id = nc.secadora_id
        WHERE nc.nota_id = $1 AND nc.secadora_por_definir AND nc.secadora_id = ANY($2)`,
      [id, libres]
    );
    const sinPrograma = porDefinir.find(m => !elegido || String(elegido.maquinaId) !== String(m.id));
    if (sinPrograma) {
      await client.query('ROLLBACK');
      return res.status(400).json({
        message: `Elige el tiempo de ${sinPrograma.nombre}: de él depende cuánto se cobra.`,
      });
    }

    // Al iniciar la secadora de una carga cuya lavadora sigue en uso, esa
    // lavadora ya terminó: se suelta después (queda en lavadora_usada_id).
    const { rows: lavASoltar } = await client.query(
      `SELECT nc.id AS carga_id, nc.lavadora_id
         FROM nota_cargas nc
         JOIN maquinas ml ON ml.id = nc.lavadora_id
        WHERE nc.nota_id = $1 AND nc.secadora_id = ANY($2) AND ml.estado = 'en_uso'
          AND nc.lavadora_iniciada_at IS NOT NULL`,
      [id, libres]
    );

    await client.query(
      `UPDATE maquinas
          SET estado = 'en_uso',
              en_uso_desde = NOW(),
              encendida_sin_iniciar_at = NULL,
              encendida_para_nota_id   = NULL
        WHERE id = ANY($1)`,
      [libres]
    );
    await marcarMaquinasIniciadas(client, id, libres);

    if (lavASoltar.length > 0) {
      const lavIds   = lavASoltar.map(r => r.lavadora_id);
      const cargaIds = lavASoltar.map(r => r.carga_id);
      await sellarPasadasVivas(client, lavIds);
      await client.query(
        `UPDATE maquinas SET estado = 'disponible', en_uso_desde = NULL WHERE id = ANY($1)`,
        [lavIds]
      );
      await client.query(
        'UPDATE nota_cargas SET lavadora_id = NULL WHERE id = ANY($1)',
        [cargaIds]
      );
    }

    await sellarCicloMaquinas(client, id, elegido);
    const fase = await faseProcesoDeNota(client, id);
    await client.query(`UPDATE notas SET estado = $1 WHERE id = $2`, [fase, id]);

    // El programa elegido le pone precio a la secadora por definir.
    if (porDefinir.length > 0) {
      await cobrarProgramaDeSecadora(client, id, elegido.maquinaId, elegido.minutos, await tarifasCarga(client));
      await recalcularPrecioTotal(client, id, {
        desmarcarPagoSiCambia: true, usuarioId: req.user?.id, sucursal: req.sucursal,
      });
    }

    await client.query('COMMIT');

    const { rows } = await pool.query(
      `SELECT n.* FROM notas n WHERE n.id = $1`,
      [id]
    );
    res.json({ ...rows[0], cargas: await cargasDeNota(pool, id) });
  } catch (err) {
    await client.query('ROLLBACK');
    if (respondioCorteCerrado(res, err)) return;
    console.error('activarMaquinasPendientes error:', err);
    res.status(500).json({ message: 'No se pudieron activar las máquinas. Intenta de nuevo.' });
  } finally {
    client.release();
  }
};

// ── PATCH /notas/:id/asignar-carga-maquina ──────────────────
/**
 * Pone una máquina física en el hueco de una carga que solo tenía el tipo. Debe
 * ser del tipo del hueco y estar libre; el tamaño no importa. Queda asignada
 * sin arrancar. En Autoservicio aquí se cobra la máquina; en Por Encargo el
 * precio no cambia.
 */
export const asignarCargaMaquina = async (req, res) => {
  const { id } = req.params;
  const { carga_id, slot, maquina_id } = req.body; // slot: 'lavadora' | 'secadora'

  if (!['lavadora', 'secadora'].includes(slot)) {
    return res.status(400).json({ message: "slot inválido: usa 'lavadora' o 'secadora'." });
  }
  if (!carga_id || !maquina_id) {
    return res.status(400).json({ message: 'Elige la carga y la máquina.' });
  }

  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    const { rows: notaRows } = await client.query(
      'SELECT estado, tipo_servicio FROM notas WHERE id = $1 AND sucursal = $2 FOR UPDATE',
      [id, req.sucursal]
    );
    if (notaRows.length === 0) {
      await client.query('ROLLBACK');
      return res.status(404).json({ message: 'Nota no encontrada.' });
    }
    if (['FINALIZADA', 'CANCELADA'].includes(notaRows[0].estado)) {
      await client.query('ROLLBACK');
      return res.status(400).json({ message: 'No se puede asignar una máquina a una nota finalizada o cancelada.' });
    }

    const { rows: cargaRows } = await client.query(
      `SELECT id, lavadora_id, secadora_id, lavadora_tipo, secadora_tipo, tipo_prenda
         FROM nota_cargas WHERE id = $1 AND nota_id = $2 FOR UPDATE`,
      [carga_id, id]
    );
    if (cargaRows.length === 0) {
      await client.query('ROLLBACK');
      return res.status(404).json({ message: 'La carga no pertenece a la nota.' });
    }
    const carga = cargaRows[0];
    const tarifaAlAsignar = notaRows[0].tipo_servicio === 'AUTOSERVICIO';
    const tipoPrevisto = slot === 'lavadora' ? carga.lavadora_tipo : carga.secadora_tipo;
    const yaAsignada   = slot === 'lavadora' ? carga.lavadora_id   : carga.secadora_id;
    if (!tipoPrevisto) {
      await client.query('ROLLBACK');
      return res.status(400).json({ message: `La carga no tiene ${slot} por asignar.` });
    }
    if (yaAsignada) {
      await client.query('ROLLBACK');
      return res.status(400).json({ message: `La carga ya tiene ${slot} asignada.` });
    }

    const { rows: maqRows } = await client.query(
      'SELECT id, nombre, tipo, tamano, estado FROM maquinas WHERE id = $1 AND sucursal = $2 FOR UPDATE',
      [maquina_id, req.sucursal]
    );
    if (maqRows.length === 0) {
      await client.query('ROLLBACK');
      return res.status(404).json({ message: 'Máquina no encontrada.' });
    }
    const maq = maqRows[0];
    if (maq.estado !== 'disponible') {
      await client.query('ROLLBACK');
      return res.status(400).json({ message: `La máquina ${maq.nombre} no está disponible.` });
    }
    // Cualquier lavadora o secadora libre sirve: el tamaño no se valida.
    if (slot === 'lavadora') {
      if (maq.tipo === 'secadora') {
        await client.query('ROLLBACK');
        return res.status(400).json({ message: `${maq.nombre} es una secadora, no una lavadora.` });
      }
    } else {
      if (maq.tipo !== 'secadora') {
        await client.query('ROLLBACK');
        return res.status(400).json({ message: `${maq.nombre} no es una secadora.` });
      }
    }

    const col = slot === 'lavadora' ? 'lavadora_id' : 'secadora_id';
    const colUsada = slot === 'lavadora' ? 'lavadora_usada_id' : 'secadora_usada_id';
    await registrarMaquinaEnCarga(client, carga_id, slot, maquina_id);
    // Autoservicio: se cobra con la tarifa de esta máquina (mediana o jumbo).
    if (tarifaAlAsignar) {
      const t = await tarifasCarga(client);
      if (slot === 'lavadora') {
        await client.query(
          `UPDATE nota_cargas SET ${col} = $1, ${colUsada} = $1, precio_lavadora = $2 WHERE id = $3`,
          [maquina_id, tarifaLavadora(maq.tipo, carga.tipo_prenda, t), carga_id]
        );
      } else {
        // La que cobra por programa queda por definir hasta iniciarla.
        const { precio, porDefinir } = await precioSecadoraAutoservicio(client, maq, carga.tipo_prenda, t);
        await client.query(
          `UPDATE nota_cargas SET ${col} = $1, ${colUsada} = $1, precio_secadora = $2,
                  secadora_por_definir = $3 WHERE id = $4`,
          [maquina_id, precio, porDefinir, carga_id]
        );
      }
      await recalcularPrecioTotal(client, id, {
        desmarcarPagoSiCambia: true, usuarioId: req.user?.id, sucursal: req.sucursal,
      });
    } else {
      await client.query(
        `UPDATE nota_cargas SET ${col} = $1, ${colUsada} = $1 WHERE id = $2`,
        [maquina_id, carga_id]
      );
    }

    await client.query('COMMIT');
    const { rows } = await pool.query('SELECT n.* FROM notas n WHERE n.id = $1', [id]);
    res.json({ ...rows[0], cargas: await cargasDeNota(pool, id) });
  } catch (err) {
    await client.query('ROLLBACK');
    if (respondioCorteCerrado(res, err)) return;
    console.error('asignarCargaMaquina error:', err);
    res.status(500).json({ message: 'No se pudo asignar la máquina a la carga. Intenta de nuevo.' });
  } finally {
    client.release();
  }
};

// ── PATCH /notas/:id/asignar-maquina ────────────────────────
/**
 * Agrega una o varias máquinas a la nota. Con `carga_id` la primera pareja
 * llena los huecos de esa carga (otra vuelta de la misma ropa); lo demás crea
 * cargas nuevas. Quedan asignadas sin arrancar. `cobrar` decide si suman su
 * tarifa o van sin costo.
 */
export const asignarMaquina = async (req, res) => {
  const { id } = req.params;
  const { maquina_id, maquina_ids, cobrar, carga_id } = req.body;

  // Una máquina (maquina_id) o varias (maquina_ids), sin repetir.
  const idsRaw = Array.isArray(maquina_ids) ? maquina_ids
    : (maquina_id != null ? [maquina_id] : []);
  const ids = [...new Set(idsRaw.map(Number).filter(n => Number.isInteger(n)))];

  if (ids.length === 0) {
    return res.status(400).json({ message: 'Selecciona al menos una máquina.' });
  }
  if (typeof cobrar !== 'boolean') {
    return res.status(400).json({ message: 'Indica si la carga se cobra o va sin cobro.' });
  }

  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    const { rows: notaRows } = await client.query(
      'SELECT estado, tipo_prenda, tipo_servicio FROM notas WHERE id = $1 AND sucursal = $2 FOR UPDATE',
      [id, req.sucursal]
    );
    if (notaRows.length === 0) {
      await client.query('ROLLBACK');
      return res.status(404).json({ message: 'Nota no encontrada.' });
    }
    if (['FINALIZADA', 'CANCELADA'].includes(notaRows[0].estado)) {
      await client.query('ROLLBACK');
      return res.status(400).json({ message: 'No se puede asignar una máquina a una nota finalizada o cancelada.' });
    }

    const { rows: maqRows } = await client.query(
      'SELECT id, nombre, tipo, tamano, estado FROM maquinas WHERE id = ANY($1) AND sucursal = $2 FOR UPDATE',
      [ids, req.sucursal]
    );
    if (maqRows.length !== ids.length) {
      await client.query('ROLLBACK');
      return res.status(400).json({ message: 'Alguna de las máquinas seleccionadas no existe.' });
    }
    const noDisp = maqRows.find(m => m.estado !== 'disponible');
    if (noDisp) {
      await client.query('ROLLBACK');
      return res.status(400).json({ message: `La máquina ${noDisp.nombre} no está disponible.` });
    }

    // Las cargas nuevas heredan la prenda de la nota.
    const tipoPrenda = notaRows[0].tipo_prenda ?? null;
    const esEdredon  = String(tipoPrenda).toUpperCase() === 'EDREDON';
    const lavadoras  = maqRows.filter(m => m.tipo !== 'secadora');
    const secadoras  = maqRows.filter(m => m.tipo === 'secadora');

    const { rows: [{ max_orden }] } = await client.query(
      'SELECT COALESCE(MAX(orden), 0)::int AS max_orden FROM nota_cargas WHERE nota_id = $1',
      [id]
    );

    const t = await tarifasCarga(client);
    const esAutoservicio = notaRows[0].tipo_servicio === 'AUTOSERVICIO';
    const precioLav = m => cobrar ? tarifaLavadora(m.tipo, tipoPrenda, t) : 0;
    // Secadora cobrada: en Autoservicio la que cobra por programa queda por definir.
    const precioSec = async (m, prenda) => {
      if (!cobrar) return { precio: 0, porDefinir: false };
      if (esAutoservicio) return precioSecadoraAutoservicio(client, m, prenda, t);
      return { precio: tarifaSecadora(m.tamano, prenda, t), porDefinir: false };
    };

    // Con carga_id, la primera pareja va a esa carga. Un hueco está ocupado
    // solo si tiene máquina puesta (no la ya usada y soltada); la carga admite
    // una lavadora y una secadora a la vez.
    let cargaObjetivo = null;
    if (carga_id != null) {
      const { rows: cRows } = await client.query(
        `SELECT id, orden, tipo_prenda, lavadora_id, secadora_id,
                lavadora_usada_id, secadora_usada_id
           FROM nota_cargas WHERE id = $1 AND nota_id = $2 FOR UPDATE`,
        [Number(carga_id), id]
      );
      if (cRows.length === 0) {
        await client.query('ROLLBACK');
        return res.status(400).json({ message: 'La carga indicada no existe en esta nota.' });
      }
      const c = cRows[0];
      if (c.lavadora_id && lavadoras.length > 0) {
        await client.query('ROLLBACK');
        return res.status(400).json({ message: `La carga ${c.orden} ya tiene una lavadora puesta.` });
      }
      if (c.secadora_id && secadoras.length > 0) {
        await client.query('ROLLBACK');
        return res.status(400).json({ message: `La carga ${c.orden} ya tiene una secadora puesta.` });
      }
      // Relavado y Más secado (otra vuelta sin costo) solo en Por Encargo. En
      // Autoservicio el tiempo de más se paga: Otra ficha u otra máquina.
      if (esAutoservicio && ((c.lavadora_usada_id && lavadoras.length > 0)
                          || (c.secadora_usada_id && secadoras.length > 0))) {
        await client.query('ROLLBACK');
        return res.status(400).json({
          message: c.secadora_usada_id && secadoras.length > 0
            ? 'En Autoservicio no hay Más secado: para más tiempo usa Otra ficha o agrega otra secadora a la nota.'
            : 'En Autoservicio no hay Relavado: agrega otra lavadora a la nota.',
        });
      }
      cargaObjetivo = c;
    }

    // Empareja lavadora + secadora por carga; las que sobran van solas.
    const nuevas = [];
    const n = Math.max(lavadoras.length, secadoras.length);
    for (let i = 0; i < n; i++) {
      nuevas.push({ lavadora: lavadoras[i] ?? null, secadora: secadoras[i] ?? null });
    }

    let nuevoOrden = max_orden;
    for (let i = 0; i < nuevas.length; i++) {
      const { lavadora, secadora } = nuevas[i];
      // La primera pareja llena los huecos de la carga objetivo.
      if (cargaObjetivo && i === 0) {
        const prendaCarga = cargaObjetivo.tipo_prenda ?? tipoPrenda;
        // Solo se toca el hueco que se llena. Si ese hueco ya se había usado
        // (relavado, más secado), es una repetición: corre un solo ciclo y
        // conserva su precio (la vuelta extra va sin cobro).
        const repiteLav = Boolean(cargaObjetivo.lavadora_usada_id);
        const repiteSec = Boolean(cargaObjetivo.secadora_usada_id);
        const sec = secadora && !repiteSec ? await precioSec(secadora, prendaCarga) : null;
        await registrarMaquinaEnCarga(client, cargaObjetivo.id, 'lavadora',
          lavadora ? lavadora.id : null, 'pasada', repiteLav);
        await registrarMaquinaEnCarga(client, cargaObjetivo.id, 'secadora',
          secadora ? secadora.id : null, 'pasada', repiteSec);
        await client.query(
          `UPDATE nota_cargas
              SET lavadora_id       = COALESCE($1::int, lavadora_id),
                  secadora_id       = COALESCE($2::int, secadora_id),
                  lavadora_usada_id = COALESCE($1::int, lavadora_usada_id),
                  secadora_usada_id = COALESCE($2::int, secadora_usada_id),
                  precio_lavadora   = CASE WHEN $3::numeric IS NULL THEN precio_lavadora ELSE $3 END,
                  precio_secadora   = CASE WHEN $4::numeric IS NULL THEN precio_secadora ELSE $4 END,
                  secadora_por_definir = COALESCE($6::boolean, secadora_por_definir)
            WHERE id = $5`,
          [
            lavadora ? lavadora.id : null,
            secadora ? secadora.id : null,
            // null = conservar el precio que ya tenía el hueco.
            !lavadora || cargaObjetivo.lavadora_usada_id
              ? null
              : (cobrar ? tarifaLavadora(lavadora.tipo, prendaCarga, t) : 0),
            sec ? sec.precio : null,
            cargaObjetivo.id,
            sec ? sec.porDefinir : null,
          ]
        );
        continue;
      }
      nuevoOrden += 1;
      const sec = secadora ? await precioSec(secadora, tipoPrenda) : { precio: 0, porDefinir: false };
      const { rows: nuevaCarga } = await client.query(
        `INSERT INTO nota_cargas
           (nota_id, orden, lavadora_id, secadora_id, lavadora_usada_id, secadora_usada_id,
            precio_lavadora, precio_secadora, tipo_prenda, es_adicional, secadora_por_definir)
         VALUES ($1, $2, $3, $4, $3, $4, $5, $6, $7, TRUE, $8) RETURNING id`,
        [
          id, nuevoOrden,
          lavadora ? lavadora.id : null,
          secadora ? secadora.id : null,
          lavadora ? precioLav(lavadora) : 0,
          sec.precio,
          tipoPrenda,
          sec.porDefinir,
        ]
      );
      // Carga nueva: no es repetición, corre los ciclos que diga su modelo
      // aunque vaya sin cobro (así llegan todas las de Por Encargo).
      await registrarMaquinaEnCarga(client, nuevaCarga[0].id, 'lavadora',
        lavadora ? lavadora.id : null, 'pasada', false);
      await registrarMaquinaEnCarga(client, nuevaCarga[0].id, 'secadora',
        secadora ? secadora.id : null, 'pasada', false);
    }

    // Las nuevas no arrancan, así que una nota LISTA vuelve a En Espera.
    const nuevoEstado = await faseProcesoDeNota(client, id);
    await client.query('UPDATE notas SET estado = $1 WHERE id = $2', [nuevoEstado, id]);
    await recalcularPrecioTotal(client, id, {
      desmarcarPagoSiCambia: true, usuarioId: req.user?.id, sucursal: req.sucursal,
    });

    const errTope = await validarTopesCargas(client, id);
    if (errTope) {
      await client.query('ROLLBACK');
      return res.status(400).json({ message: errTope });
    }

    await client.query('COMMIT');

    const { rows } = await pool.query(
      `SELECT n.*,
              c.nombre   AS cliente_nombre,
              c.apellido AS cliente_apellido,
              c.telefono AS cliente_telefono,
              TRIM(u.nombre || ' ' || COALESCE(u.apellido, '')) AS usuario_nombre
       FROM notas n
       LEFT JOIN clientes  c ON c.id = n.cliente_id
       JOIN      usuarios  u ON u.id = n.usuario_id
       WHERE n.id = $1`,
      [id]
    );
    res.json({ ...rows[0], cargas: await cargasDeNota(pool, id) });
  } catch (err) {
    await client.query('ROLLBACK');
    if (respondioCorteCerrado(res, err)) return;
    console.error('asignarMaquina error:', err);
    res.status(500).json({ message: 'No se pudo asignar la máquina. Intenta de nuevo.' });
  } finally {
    client.release();
  }
};

// ── PATCH /notas/:id/cambiar-maquina ────────────────────────
/**
 * Cambia la máquina de una carga, sin iniciar, por otra libre del mismo tipo.
 * También sirve cuando otra nota se adelantó y ya la está usando. Si el hueco
 * se cobraba, se cobra con la tarifa de la nueva.
 */
export const cambiarMaquina = async (req, res) => {
  const { id } = req.params;
  const { maquina_actual_id, maquina_nueva_id } = req.body;

  if (!maquina_actual_id || !maquina_nueva_id) {
    return res.status(400).json({ message: 'Elige la máquina actual y la máquina nueva.' });
  }
  if (String(maquina_actual_id) === String(maquina_nueva_id)) {
    return res.status(400).json({ message: 'Selecciona una máquina distinta.' });
  }

  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    const { rows: notaRows } = await client.query(
      'SELECT estado, tipo_servicio FROM notas WHERE id = $1 AND sucursal = $2 FOR UPDATE',
      [id, req.sucursal]
    );
    if (notaRows.length === 0) {
      await client.query('ROLLBACK');
      return res.status(404).json({ message: 'Nota no encontrada.' });
    }
    if (['FINALIZADA', 'CANCELADA'].includes(notaRows[0].estado)) {
      await client.query('ROLLBACK');
      return res.status(400).json({ message: 'No se puede cambiar una máquina de una nota finalizada o cancelada.' });
    }

    const { rows: actRows } = await client.query(
      'SELECT id, nombre, tipo, estado FROM maquinas WHERE id = $1 AND sucursal = $2 FOR UPDATE',
      [maquina_actual_id, req.sucursal]
    );
    if (actRows.length === 0) {
      await client.query('ROLLBACK');
      return res.status(400).json({ message: 'La máquina actual no existe.' });
    }
    // En uso por esta nota: hay que detenerla antes. En uso por otra nota: se
    // puede cambiar (es lo que pide el aviso de Salidas).
    if (actRows[0].estado !== 'disponible') {
      const otra = await notaQueUsaMaquina(client, Number(maquina_actual_id), Number(id));
      if (!otra) {
        await client.query('ROLLBACK');
        return res.status(400).json({ message: 'Solo puedes cambiar una máquina que aún no ha iniciado. Detén su ciclo primero.' });
      }
    }
    const esSecadora = actRows[0].tipo === 'secadora';
    const cargaCol   = esSecadora ? 'secadora_id'        : 'lavadora_id';
    const usadaCol   = esSecadora ? 'secadora_usada_id'  : 'lavadora_usada_id';
    const precioCol  = esSecadora ? 'precio_secadora'    : 'precio_lavadora';

    const { rows: cargaRows } = await client.query(
      `SELECT id, tipo_prenda, ${precioCol} AS precio_actual, secadora_por_definir
         FROM nota_cargas WHERE nota_id = $1 AND ${cargaCol} = $2 FOR UPDATE`,
      [id, maquina_actual_id]
    );
    if (cargaRows.length === 0) {
      await client.query('ROLLBACK');
      return res.status(400).json({ message: 'La máquina no está asignada a esta nota.' });
    }
    const carga = cargaRows[0];

    const { rows: nueRows } = await client.query(
      'SELECT id, nombre, tipo, tamano, estado FROM maquinas WHERE id = $1 AND sucursal = $2 FOR UPDATE',
      [maquina_nueva_id, req.sucursal]
    );
    if (nueRows.length === 0) {
      await client.query('ROLLBACK');
      return res.status(400).json({ message: 'La máquina seleccionada no existe.' });
    }
    const nueva = nueRows[0];
    if (nueva.estado !== 'disponible') {
      await client.query('ROLLBACK');
      return res.status(400).json({ message: `La máquina ${nueva.nombre} no está disponible.` });
    }
    if ((nueva.tipo === 'secadora') !== esSecadora) {
      await client.query('ROLLBACK');
      return res.status(400).json({ message: 'Debes elegir una máquina del mismo tipo.' });
    }

    // Solo se re-tarifa si el hueco se cobraba (o esperaba su programa); uno
    // sin cobro sigue sin cobro.
    const t = await tarifasCarga(client);
    const seCobraba = Number(carga.precio_actual) > 0 || (esSecadora && Boolean(carga.secadora_por_definir));
    let precio = carga.precio_actual;
    let porDefinir = Boolean(carga.secadora_por_definir);
    if (seCobraba && esSecadora && notaRows[0].tipo_servicio === 'AUTOSERVICIO') {
      ({ precio, porDefinir } = await precioSecadoraAutoservicio(client, nueva, carga.tipo_prenda, t));
    } else if (seCobraba) {
      precio = esSecadora
        ? tarifaSecadora(nueva.tamano, carga.tipo_prenda, t)
        : tarifaLavadora(nueva.tipo, carga.tipo_prenda, t);
    }

    await registrarMaquinaEnCarga(client, carga.id, esSecadora ? 'secadora' : 'lavadora',
      maquina_nueva_id, 'reemplazo');
    await client.query(
      `UPDATE nota_cargas SET ${cargaCol} = $1, ${usadaCol} = $1, ${precioCol} = $2,
              secadora_por_definir = $3 WHERE id = $4`,
      [maquina_nueva_id, precio, esSecadora ? porDefinir : Boolean(carga.secadora_por_definir), carga.id]
    );
    await recalcularPrecioTotal(client, id, {
      desmarcarPagoSiCambia: true, usuarioId: req.user?.id, sucursal: req.sucursal,
    });

    const errTope = await validarTopesCargas(client, id);
    if (errTope) {
      await client.query('ROLLBACK');
      return res.status(400).json({ message: errTope });
    }

    await client.query('COMMIT');

    const { rows } = await pool.query(
      `SELECT n.*,
              c.nombre   AS cliente_nombre,
              c.apellido AS cliente_apellido,
              c.telefono AS cliente_telefono,
              TRIM(u.nombre || ' ' || COALESCE(u.apellido, '')) AS usuario_nombre
       FROM notas n
       LEFT JOIN clientes  c ON c.id = n.cliente_id
       JOIN      usuarios  u ON u.id = n.usuario_id
       WHERE n.id = $1`,
      [id]
    );
    res.json({ ...rows[0], cargas: await cargasDeNota(pool, id) });
  } catch (err) {
    await client.query('ROLLBACK');
    if (respondioCorteCerrado(res, err)) return;
    console.error('cambiarMaquina error:', err);
    res.status(500).json({ message: 'No se pudo cambiar la máquina. Intenta de nuevo.' });
  } finally {
    client.release();
  }
};

// ── PATCH /notas/:id/terminar-lavado ────────────────────────
/**
 * Termina el lavado de una lavadora y arranca el secado de sus cargas en la
 * secadora elegida (Autoservicio, "Iniciar secado"). Cobra el secado, así que
 * el total sube. Las demás lavadoras de la nota no se tocan.
 */
export const terminarLavado = async (req, res) => {
  const { id } = req.params;
  const { lavadora_id, secadora_id, minutos } = req.body;

  if (!lavadora_id || !secadora_id) {
    return res.status(400).json({ message: 'Elige la lavadora y la secadora.' });
  }

  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    const { rows: notaRows } = await client.query(
      'SELECT estado, tipo_servicio FROM notas WHERE id = $1 AND sucursal = $2 FOR UPDATE',
      [id, req.sucursal]
    );
    if (notaRows.length === 0) {
      await client.query('ROLLBACK');
      return res.status(404).json({ message: 'Nota no encontrada.' });
    }
    if (notaRows[0].estado !== 'LAVANDO') {
      await client.query('ROLLBACK');
      return res.status(400).json({ message: 'Solo se puede terminar el lavado de una nota que está Lavando.' });
    }

    const { rows: maqRows } = await client.query(
      `SELECT m.tipo, m.tamano, m.estado
         FROM maquinas m WHERE m.id = $1 AND m.sucursal = $2 FOR UPDATE OF m`,
      [secadora_id, req.sucursal]
    );
    if (maqRows.length === 0) {
      await client.query('ROLLBACK');
      return res.status(400).json({ message: 'La secadora seleccionada no existe.' });
    }
    if (maqRows[0].tipo !== 'secadora') {
      await client.query('ROLLBACK');
      return res.status(400).json({ message: 'La máquina seleccionada no es una secadora.' });
    }
    if (maqRows[0].estado !== 'disponible') {
      await client.query('ROLLBACK');
      return res.status(400).json({ message: 'La secadora seleccionada no está disponible.' });
    }
    const secadoraTamano = maqRows[0].tamano;

    const { rows: cargasLav } = await client.query(
      'SELECT id FROM nota_cargas WHERE nota_id = $1 AND lavadora_id = $2 FOR UPDATE',
      [id, lavadora_id]
    );
    if (cargasLav.length === 0) {
      await client.query('ROLLBACK');
      return res.status(400).json({ message: 'La lavadora no está asignada a esta nota.' });
    }

    // Acepta el programa elegido si el modelo lo pregunta.
    const leido = await tiempoElegidoDeMaquina(client, secadora_id, minutos);
    if (leido?.error) {
      await client.query('ROLLBACK');
      return res.status(400).json({ message: leido.error });
    }
    // En Autoservicio, la que cobra por programa se cobra por el elegido.
    const t = await tarifasCarga(client);
    const precios = notaRows[0].tipo_servicio === 'AUTOSERVICIO'
      ? await preciosDePrograma(client, secadora_id) : null;
    if (precios && !leido) {
      await client.query('ROLLBACK');
      return res.status(400).json({ message: 'Elige el tiempo de la secadora: de él depende cuánto se cobra.' });
    }
    const precioPrograma = precios ? precios.get(leido.minutos) ?? null : null;

    await sellarFinDePasada(client, id, 'lavadora', lavadora_id);

    const { rows: cargasMover } = await client.query(
      `SELECT nc.id, nc.tipo_prenda
         FROM nota_cargas nc
        WHERE nc.nota_id = $1 AND nc.lavadora_id = $2 AND nc.secadora_id IS NULL
        FOR UPDATE OF nc`,
      [id, lavadora_id]
    );
    // La secadora toma las cargas de esa lavadora y cobra el secado según su
    // tamaño (el edredón tiene tarifa propia).
    for (const c of cargasMover) {
      await registrarMaquinaEnCarga(client, c.id, 'secadora', secadora_id);
      await client.query(
        `UPDATE nota_cargas SET secadora_id = $1, secadora_usada_id = $1, precio_secadora = $2 WHERE id = $3`,
        [secadora_id, precioPrograma ?? tarifaSecadora(secadoraTamano, c.tipo_prenda, t), c.id]
      );
    }
    // La lavadora se suelta; su cobro queda en precio_lavadora.
    await client.query(
      'UPDATE nota_cargas SET lavadora_id = NULL WHERE nota_id = $1 AND lavadora_id = $2',
      [id, lavadora_id]
    );
    await client.query(
      `UPDATE maquinas SET estado = 'disponible', en_uso_desde = NULL
        WHERE id = $1 AND estado = 'en_uso'`,
      [lavadora_id]
    );

    // La secadora arranca ya: este botón es su "Iniciar".
    await client.query(
      `UPDATE maquinas SET estado = 'en_uso', en_uso_desde = NOW() WHERE id = $1`,
      [secadora_id]
    );
    await marcarMaquinasIniciadas(client, id, [secadora_id]);
    await sellarCicloMaquinas(client, id, leido ? { maquinaId: secadora_id, minutos: leido.minutos } : null);
    // Terminó una lavadora: el granel de los servicios sale del inventario.
    await consumirProductosDeNota(client, id, req.sucursal, req.user?.id, { soloGranel: true });
    const fase = await faseProcesoDeNota(client, id);
    await client.query('UPDATE notas SET estado = $1 WHERE id = $2', [fase, id]);

    await recalcularPrecioTotal(client, id);
    const errTope = await validarTopesCargas(client, id);
    if (errTope) {
      await client.query('ROLLBACK');
      return res.status(400).json({ message: errTope });
    }

    await client.query('COMMIT');

    const { rows } = await pool.query(
      `SELECT n.*,
              c.nombre   AS cliente_nombre,
              c.apellido AS cliente_apellido,
              c.telefono AS cliente_telefono,
              TRIM(u.nombre || ' ' || COALESCE(u.apellido, '')) AS usuario_nombre
       FROM notas n
       LEFT JOIN clientes  c ON c.id = n.cliente_id
       JOIN      usuarios  u ON u.id = n.usuario_id
       WHERE n.id = $1`,
      [id]
    );
    res.json({ ...rows[0], cargas: await cargasDeNota(pool, id) });
  } catch (err) {
    await client.query('ROLLBACK');
    if (respondioCorteCerrado(res, err)) return;
    console.error('terminarLavado error:', err);
    res.status(500).json({ message: 'No se pudo terminar el lavado. Intenta de nuevo.' });
  } finally {
    client.release();
  }
};

// ── PATCH /notas/:id/terminar-secado ────────────────────────
/**
 * "Finalizar" una secadora: la suelta y, si a la nota ya no le queda nada
 * pendiente, la cierra (ver estadoAlTerminarCargas).
 */
export const terminarSecado = async (req, res) => {
  const { id } = req.params;
  const { secadora_id } = req.body;

  if (!secadora_id) {
    return res.status(400).json({ message: 'Elige la secadora.' });
  }

  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    const { rows: notaRows } = await client.query(
      'SELECT estado FROM notas WHERE id = $1 AND sucursal = $2 FOR UPDATE',
      [id, req.sucursal]
    );
    if (notaRows.length === 0) {
      await client.query('ROLLBACK');
      return res.status(404).json({ message: 'Nota no encontrada.' });
    }
    if (!['LAVANDO', 'SECANDO'].includes(notaRows[0].estado)) {
      await client.query('ROLLBACK');
      return res.status(400).json({ message: 'Solo se puede terminar el secado de una nota en proceso.' });
    }

    const { rowCount: cargasSec } = await client.query(
      'SELECT id FROM nota_cargas WHERE nota_id = $1 AND secadora_id = $2 FOR UPDATE',
      [id, secadora_id]
    );
    if (cargasSec === 0) {
      await client.query('ROLLBACK');
      return res.status(400).json({ message: 'La secadora no está asignada a esta nota.' });
    }

    await sellarFinDePasada(client, id, 'secadora', secadora_id);

    await client.query(
      'UPDATE nota_cargas SET secadora_id = NULL WHERE nota_id = $1 AND secadora_id = $2',
      [id, secadora_id]
    );
    await client.query(
      `UPDATE maquinas SET estado = 'disponible', en_uso_desde = NULL
        WHERE id = $1 AND estado = 'en_uso'`,
      [secadora_id]
    );

    const restantes = await maquinasDeNota(client, id);
    const { rowCount: enUso } = restantes.length === 0
      ? { rowCount: 0 }
      : await client.query(
          `SELECT id FROM maquinas WHERE id = ANY($1) AND estado = 'en_uso'`,
          [restantes]
        );
    if (enUso === 0) {
      // Sin máquinas corriendo: se cierra si no le falta nada; si no, vuelve a
      // su fase (En Espera).
      if (await hayCargasPendientes(client, id)) {
        const fase = await faseProcesoDeNota(client, id);
        await client.query(`UPDATE notas SET estado = $1 WHERE id = $2`, [fase, id]);
      } else {
        await cerrarNotaSinCargasPendientes(client, id, {
          sucursal: req.sucursal, usuarioId: req.user?.id,
        });
      }
    }

    await client.query('COMMIT');

    const { rows } = await pool.query(
      `SELECT n.*,
              c.nombre   AS cliente_nombre,
              c.apellido AS cliente_apellido,
              c.telefono AS cliente_telefono,
              TRIM(u.nombre || ' ' || COALESCE(u.apellido, '')) AS usuario_nombre
       FROM notas n
       LEFT JOIN clientes  c ON c.id = n.cliente_id
       JOIN      usuarios  u ON u.id = n.usuario_id
       WHERE n.id = $1`,
      [id]
    );
    res.json({ ...rows[0], cargas: await cargasDeNota(pool, id) });
  } catch (err) {
    await client.query('ROLLBACK');
    console.error('terminarSecado error:', err);
    res.status(500).json({ message: 'No se pudo terminar el secado. Intenta de nuevo.' });
  } finally {
    client.release();
  }
};

// ── PATCH /notas/:id/terminar-lavado-final ──────────────────
/**
 * "Finalizar" una lavadora sin pasar a secado: la suelta, descuenta el granel
 * de los servicios y, si a la nota ya no le queda nada pendiente, la cierra.
 * Espejo de terminarSecado.
 */
export const terminarLavadoFinal = async (req, res) => {
  const { id } = req.params;
  const { lavadora_id } = req.body;

  if (!lavadora_id) {
    return res.status(400).json({ message: 'Elige la lavadora.' });
  }

  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    const { rows: notaRows } = await client.query(
      'SELECT estado FROM notas WHERE id = $1 AND sucursal = $2 FOR UPDATE',
      [id, req.sucursal]
    );
    if (notaRows.length === 0) {
      await client.query('ROLLBACK');
      return res.status(404).json({ message: 'Nota no encontrada.' });
    }
    if (!['LAVANDO', 'SECANDO'].includes(notaRows[0].estado)) {
      await client.query('ROLLBACK');
      return res.status(400).json({ message: 'Solo se puede terminar el lavado de una nota en proceso.' });
    }

    const { rowCount: cargasLav } = await client.query(
      'SELECT id FROM nota_cargas WHERE nota_id = $1 AND lavadora_id = $2 FOR UPDATE',
      [id, lavadora_id]
    );
    if (cargasLav === 0) {
      await client.query('ROLLBACK');
      return res.status(400).json({ message: 'La lavadora no está asignada a esta nota.' });
    }

    await sellarFinDePasada(client, id, 'lavadora', lavadora_id);

    await client.query(
      'UPDATE nota_cargas SET lavadora_id = NULL WHERE nota_id = $1 AND lavadora_id = $2',
      [id, lavadora_id]
    );
    await client.query(
      `UPDATE maquinas SET estado = 'disponible', en_uso_desde = NULL
        WHERE id = $1 AND estado = 'en_uso'`,
      [lavadora_id]
    );

    // El granel de los servicios sale del inventario (lo ya descontado no se repite).
    await consumirProductosDeNota(client, id, req.sucursal, req.user?.id, { soloGranel: true });

    const restantes = await maquinasDeNota(client, id);
    const { rowCount: enUso } = restantes.length === 0
      ? { rowCount: 0 }
      : await client.query(
          `SELECT id FROM maquinas WHERE id = ANY($1) AND estado = 'en_uso'`,
          [restantes]
        );
    if (enUso === 0 && !(await hayCargasPendientes(client, id))) {
      await cerrarNotaSinCargasPendientes(client, id, {
        sucursal: req.sucursal, usuarioId: req.user?.id,
      });
    } else {
      const fase = await faseProcesoDeNota(client, id);
      await client.query(`UPDATE notas SET estado = $1 WHERE id = $2`, [fase, id]);
    }

    await client.query('COMMIT');

    const { rows } = await pool.query(
      `SELECT n.*,
              c.nombre   AS cliente_nombre,
              c.apellido AS cliente_apellido,
              c.telefono AS cliente_telefono,
              TRIM(u.nombre || ' ' || COALESCE(u.apellido, '')) AS usuario_nombre
       FROM notas n
       LEFT JOIN clientes  c ON c.id = n.cliente_id
       JOIN      usuarios  u ON u.id = n.usuario_id
       WHERE n.id = $1`,
      [id]
    );
    res.json({ ...rows[0], cargas: await cargasDeNota(pool, id) });
  } catch (err) {
    await client.query('ROLLBACK');
    console.error('terminarLavadoFinal error:', err);
    res.status(500).json({ message: 'No se pudo terminar el lavado. Intenta de nuevo.' });
  } finally {
    client.release();
  }
};

// ── PATCH /notas/:id/estado-pago ────────────────────────────
export const cambiarEstadoPago = async (req, res) => {
  const { id } = req.params;
  const { estado_pago, forma_pago } = req.body;

  if (!estado_pago || !ESTADOS_PAGO_VALIDOS.includes(estado_pago)) {
    return res.status(400).json({
      message: `Indica si la nota queda ${enPalabras(ESTADOS_PAGO_VALIDOS)}.`,
    });
  }

  // Cobrar exige la forma de pago: el corte solo cuenta el efectivo.
  const formaPago = normalizarFormaPago(forma_pago);
  if (estado_pago === 'PAGADO' && !formaPago) {
    return res.status(400).json({
      message: `Indica la forma de pago: ${enPalabras(FORMAS_PAGO_VALIDAS)}.`,
    });
  }

  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    const { rows: notaRows } = await client.query(
      `SELECT id, folio, estado, estado_pago, caja_id, tipo_servicio
         FROM notas WHERE id = $1 AND sucursal = $2 FOR UPDATE`,
      [id, req.sucursal]
    );
    if (notaRows.length === 0) {
      await client.query('ROLLBACK');
      return res.status(404).json({ message: 'Nota no encontrada.' });
    }
    const actual = notaRows[0];

    if (actual.estado === 'CANCELADA') {
      await client.query('ROLLBACK');
      return res.status(400).json({ message: 'No se puede cambiar el pago de una nota cancelada.' });
    }

    // Autoservicio con cargas sin máquina no se cobra: aún no tienen precio.
    if (estado_pago === 'PAGADO' && actual.tipo_servicio === 'AUTOSERVICIO') {
      const { rows: sinMaquina } = await client.query(
        `SELECT COUNT(*)::int AS faltan
           FROM nota_cargas
          WHERE nota_id = $1
            AND ((lavadora_tipo IS NOT NULL AND lavadora_usada_id IS NULL)
              OR (secadora_tipo IS NOT NULL AND secadora_usada_id IS NULL))`,
        [id]
      );
      if (sinMaquina[0].faltan > 0) {
        await client.query('ROLLBACK');
        return res.status(409).json({
          message: 'Asigna la máquina en Salidas antes de cobrar: hasta entonces la nota no '
                 + 'tiene nada que cobrar.',
        });
      }
      // Secadora por definir: su precio sale del programa al iniciarla.
      const porDefinir = await secadoraPorDefinir(client, id);
      if (porDefinir) {
        await client.query('ROLLBACK');
        return res.status(409).json({ message: porDefinir });
      }
    }

    // Recibir dinero exige caja abierta; con saldo $0 no entra dinero y se permite.
    if (estado_pago === 'PAGADO' && actual.estado_pago !== 'PAGADO' && notaRequiereCaja()) {
      const { rows: [{ total }] } = await client.query(
        'SELECT precio_total AS total FROM notas WHERE id = $1', [id]
      );
      const saldo = Number(total) - await totalAbonado(client, id);
      if (saldo > 1e-9) {
        const { rows: abierta } = await client.query(
          `SELECT 1 FROM cajas WHERE estado = 'abierta' AND sucursal = $1 LIMIT 1`,
          [req.sucursal]
        );
        if (abierta.length === 0) {
          await client.query('ROLLBACK');
          return res.status(409).json({
            code: 'CAJA_CERRADA',
            message: 'La caja está cerrada. Ábrela para poder recibir el pago.',
          });
        }
      }
    }

    const esReversion = actual.estado_pago === 'PAGADO' && estado_pago === 'PENDIENTE';
    if (esReversion && !esAdmin(req.user.rol)) {
      await client.query('ROLLBACK');
      return res.status(403).json({ message: 'Solo un administrador puede revertir un pago.' });
    }
    // Revertir un cobro exige motivo, que va al aviso de la campana.
    const motivoReversion = String(req.body?.motivo ?? '').trim().slice(0, 200);
    if (esReversion && !motivoReversion) {
      await client.query('ROLLBACK');
      return res.status(400).json({ message: 'Escribe por qué se revierte el pago.' });
    }
    // Solo con su caja abierta (o si se cobró sin caja): un corte cerrado ya
    // contó esa venta.
    if (esReversion && actual.caja_id) {
      const { rows: cajaRows } = await client.query(
        'SELECT estado FROM cajas WHERE id = $1', [actual.caja_id]
      );
      if (cajaRows[0]?.estado !== 'abierta') {
        await client.query('ROLLBACK');
        return res.status(409).json({
          message: 'El corte de caja de esta nota ya se cerró: el pago solo se puede revertir '
                 + 'mientras esa caja siga abierta.',
        });
      }
    }

    // Revertir el pago revierte también TODOS sus abonos vivos: la nota deja de
    // estar cobrada. Para deshacer solo uno está el botón de cada abono.
    let abonosRevertidos = [];
    if (esReversion) {
      const { rows: vivos } = await client.query(
        `SELECT ab.id, ab.monto, ab.caja_id, cj.estado AS caja_estado
           FROM nota_abonos ab
           LEFT JOIN cajas cj ON cj.id = ab.caja_id
          WHERE ab.nota_id = $1 AND ab.revertido_at IS NULL
          FOR UPDATE OF ab`,
        [id]
      );
      // Ni si un abono está en un corte cerrado (no deja `notas.caja_id`, por
      // eso se revisa aparte).
      const congelado = vivos.find(a => a.caja_id && a.caja_estado !== 'abierta');
      if (congelado) {
        await client.query('ROLLBACK');
        return res.status(409).json({
          message: 'Un abono de esta nota ya quedó en un corte de caja cerrado: el pago solo se '
                 + 'puede revertir mientras esa caja siga abierta.',
        });
      }
      if (vivos.length > 0) {
        await client.query(
          `UPDATE nota_abonos
              SET revertido_at = NOW(), revertido_por = $2, motivo_reversion = $3
            WHERE id = ANY($1)`,
          [vivos.map(a => a.id), req.user?.id ?? null, `Reversión del cobro: ${motivoReversion}`]
        );
        abonosRevertidos = vivos;
      }
    }

    // Al revertir, la forma de pago se limpia.
    const { rows } = await client.query(
      'UPDATE notas SET estado_pago = $1, forma_pago = $2, caja_id = $4 WHERE id = $3 RETURNING *',
      [estado_pago, estado_pago === 'PAGADO' ? formaPago : null, id,
       estado_pago === 'PAGADO' ? actual.caja_id : null]
    );
    if (esReversion) {
      await registrarReversionPago(client, actual, req.user.id, req.sucursal, motivoReversion, abonosRevertidos);
    }

    // Un Autoservicio en Por Entregar sin pendientes se cierra al liquidarlo:
    // el cliente ya se llevó su ropa.
    let notaFinal = rows[0];
    if (estado_pago === 'PAGADO'
        && actual.tipo_servicio === 'AUTOSERVICIO'
        && actual.estado === 'LISTA'
        && !(await hayCargasPendientes(client, id))) {
      const estadoNuevo = await cerrarNotaSinCargasPendientes(client, id, {
        sucursal: req.sucursal, usuarioId: req.user?.id,
      });
      notaFinal = { ...notaFinal, estado: estadoNuevo };
    }

    await client.query('COMMIT');
    res.json(notaFinal);
  } catch (err) {
    await client.query('ROLLBACK');
    console.error('cambiarEstadoPago error:', err);
    res.status(500).json({ message: 'No se pudo registrar el pago. Intenta de nuevo.' });
  } finally {
    client.release();
  }
};

// ── PATCH /notas/:id/forma-pago ─────────────────────────────
/**
 * Corrige la forma de pago de una nota cobrada, mientras su caja siga abierta
 * (el corte se calcula en vivo). Revertir y volver a cobrar no sirve: movería
 * la venta a la caja de hoy.
 */
export const corregirFormaPago = async (req, res) => {
  const { id } = req.params;
  const formaPago = normalizarFormaPago(req.body?.forma_pago);

  if (!formaPago) {
    return res.status(400).json({
      message: `Indica la forma de pago: ${enPalabras(FORMAS_PAGO_VALIDAS)}.`,
    });
  }

  try {
    const { rows } = await pool.query(
      `SELECT n.id, n.folio, n.estado, n.estado_pago, n.forma_pago, n.caja_id,
              cj.estado AS caja_estado
         FROM notas n
         LEFT JOIN cajas cj ON cj.id = n.caja_id
        WHERE n.id = $1 AND n.sucursal = $2`,
      [id, req.sucursal]
    );
    if (rows.length === 0) {
      return res.status(404).json({ message: 'Nota no encontrada.' });
    }
    const nota = rows[0];

    if (nota.estado === 'CANCELADA') {
      return res.status(400).json({ message: 'No se puede cambiar el pago de una nota cancelada.' });
    }
    if (nota.estado_pago !== 'PAGADO') {
      return res.status(400).json({ message: 'La nota todavía no está cobrada.' });
    }
    if (!nota.caja_id || nota.caja_estado !== 'abierta') {
      return res.status(409).json({
        message: 'El corte de caja de esta nota ya se cerró: la forma de pago solo se puede corregir '
               + 'mientras esa caja siga abierta.',
      });
    }
    if (nota.forma_pago === formaPago) {
      return res.status(400).json({ message: `La nota ya está registrada como ${palabra(formaPago)}.` });
    }

    // El cambio y su historial van en la misma transacción.
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      const { rows: upd } = await client.query(
        'UPDATE notas SET forma_pago = $1 WHERE id = $2 RETURNING *',
        [formaPago, id]
      );
      await client.query(
        `INSERT INTO nota_forma_pago_historial (nota_id, forma_anterior, forma_nueva, usuario_id)
         VALUES ($1, $2, $3, $4)`,
        [id, nota.forma_pago, formaPago, req.user?.id ?? null]
      );
      await client.query('COMMIT');
      console.log(
        `[notas] forma de pago corregida en ${nota.folio}: ${nota.forma_pago} → ${formaPago} ` +
        `(usuario ${req.user?.id ?? '?'})`
      );
      res.json(upd[0]);
    } catch (err) {
      await client.query('ROLLBACK');
      throw err;
    } finally {
      client.release();
    }
  } catch (err) {
    console.error('corregirFormaPago error:', err);
    res.status(500).json({ message: 'No se pudo corregir la forma de pago. Intenta de nuevo.' });
  }
};

// ── PATCH /notas/:id/telefono ───────────────────────────────
/** Teléfono de contacto de la nota (sin cliente): solo dígitos; vacío lo borra. */
export const guardarTelefono = async (req, res) => {
  const { id } = req.params;
  const { telefono } = req.body;
  const digits = String(telefono ?? '').replace(/\D/g, '');
  const valor = digits.length > 0 ? digits : null;
  try {
    const { rows } = await pool.query(
      'UPDATE notas SET telefono = $1 WHERE id = $2 AND sucursal = $3 RETURNING id, telefono',
      [valor, id, req.sucursal]
    );
    if (rows.length === 0) {
      return res.status(404).json({ message: 'Nota no encontrada.' });
    }
    res.json(rows[0]);
  } catch (err) {
    console.error('guardarTelefono error:', err);
    res.status(500).json({ message: 'No se pudo guardar el teléfono. Intenta de nuevo.' });
  }
};

// ── PATCH /notas/:id/referencia ─────────────────────────────
/** Nombre libre del cliente en una nota de Autoservicio; vacío = "Mostrador". */
export const guardarReferencia = async (req, res) => {
  const { id } = req.params;
  const valor = String(req.body?.referencia ?? '').trim().slice(0, 80) || null;
  try {
    const { rows } = await pool.query(
      'SELECT tipo_servicio FROM notas WHERE id = $1 AND sucursal = $2',
      [id, req.sucursal]
    );
    if (rows.length === 0) {
      return res.status(404).json({ message: 'Nota no encontrada.' });
    }
    if (rows[0].tipo_servicio !== 'AUTOSERVICIO') {
      return res.status(400).json({ message: 'Solo las notas de Autoservicio llevan referencia.' });
    }
    const { rows: upd } = await pool.query(
      'UPDATE notas SET referencia = $1 WHERE id = $2 RETURNING id, referencia',
      [valor, id]
    );
    res.json(upd[0]);
  } catch (err) {
    console.error('guardarReferencia error:', err);
    res.status(500).json({ message: 'No se pudo guardar el nombre. Intenta de nuevo.' });
  }
};

// ── GET /notas/:id/productos ────────────────────────────────
export const getNotaProductos = async (req, res) => {
  const { id } = req.params;
  try {
    const { rows } = await pool.query(
      `SELECT np.id, np.producto_id, a.nombre, np.cantidad, np.precio_unitario,
              a.tipo_liquido, a.forma, a.se_vende_por_unidad, a.clase, a.tamano_bolsa, a.marca,
              (np.cantidad * np.precio_unitario) AS subtotal
       FROM nota_productos np
       JOIN productos a ON a.id = np.producto_id
       JOIN notas n ON n.id = np.nota_id AND n.sucursal = $2
       WHERE np.nota_id = $1
       ORDER BY np.created_at ASC`,
      [id, req.sucursal]
    );
    res.json(rows);
  } catch (err) {
    console.error('getNotaProductos error:', err);
    res.status(500).json({ message: 'No se pudieron cargar los productos de la nota. Intenta de nuevo.' });
  }
};

// ── POST /notas/:id/productos ───────────────────────────────
export const addProductoToNota = async (req, res) => {
  const { id } = req.params;
  const { producto_id, cantidad } = req.body;

  if (!producto_id || !cantidad || Number(cantidad) <= 0) {
    return res.status(400).json({ message: 'Elige el producto y una cantidad mayor a 0.' });
  }

  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    const { rows: notaRows } = await client.query(
      'SELECT estado, tipo_servicio FROM notas WHERE id = $1 AND sucursal = $2 FOR UPDATE',
      [id, req.sucursal]
    );
    if (notaRows.length === 0) {
      await client.query('ROLLBACK');
      return res.status(404).json({ message: 'Nota no encontrada.' });
    }
    if (['PAGADA', 'FINALIZADA', 'CANCELADA'].includes(notaRows[0].estado)) {
      await client.query('ROLLBACK');
      return res.status(400).json({
        message: `No se pueden agregar productos a una nota ${palabra(notaRows[0].estado)}.`,
      });
    }

    // Si ya estaba y se había entregado (nota reabierta), vuelve a apartado
    // antes de sumarle unidades.
    const { rows: yaEsta } = await client.query(
      'SELECT id FROM nota_productos WHERE nota_id = $1 AND producto_id = $2 AND carga_id IS NULL',
      [id, producto_id]
    );
    for (const r of yaEsta) {
      await reabrirRenglonProducto(client, id, r.id, req.sucursal, req.user?.id);
    }

    let fila;
    try {
      fila = await reservarProducto(client, id, null, producto_id, cantidad, req.sucursal, notaRows[0].tipo_servicio);
    } catch (e) {
      await client.query('ROLLBACK');
      return res.status(400).json({ message: e.message });
    }

    await recalcularPrecioTotal(client, id, {
      desmarcarPagoSiCambia: true, usuarioId: req.user?.id, sucursal: req.sucursal,
    });

    // En Por Encargo el granel y las bolsas gastan del precio del servicio.
    const errTope = await validarTopesCargas(client, id);
    if (errTope) {
      await client.query('ROLLBACK');
      return res.status(400).json({ message: errTope });
    }

    await client.query('COMMIT');
    res.status(201).json(fila);
  } catch (err) {
    await client.query('ROLLBACK');
    if (respondioCorteCerrado(res, err)) return;
    console.error('addProductoToNota error:', err);
    res.status(500).json({ message: 'No se pudo agregar el producto a la nota. Intenta de nuevo.' });
  } finally {
    client.release();
  }
};

// ── PUT /notas/:id/cargas/:cargaId/granel/:tipoId ───────────
/**
 * Elige (o cambia) el granel de un tipo —Jabón, Suavizante…— en un servicio Por
 * Encargo: qué producto y cuántas medidas. Lo que había de ese tipo se suelta y
 * se pone lo nuevo. Sin producto queda por elegir; con `del_cliente: true` el
 * cliente trajo el suyo (sin inventario y sin bloquear la lavadora).
 */
export const elegirGranelDeCarga = async (req, res) => {
  const { id, cargaId, tipoId } = req.params;
  const { producto_id } = req.body ?? {};
  const delCliente = req.body?.del_cliente === true;
  const cantidad = Number(req.body?.cantidad);
  if (![id, cargaId, tipoId].every(v => /^\d+$/.test(String(v)))) {
    return res.status(404).json({ message: 'No se encontró el servicio.' });
  }
  if (!Number.isInteger(cantidad) || cantidad < 1) {
    return res.status(400).json({ message: 'Las medidas deben ser un número entero de 1 o más.' });
  }

  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const { rows: notaRows } = await client.query(
      'SELECT estado, tipo_servicio FROM notas WHERE id = $1 AND sucursal = $2 FOR UPDATE',
      [id, req.sucursal]
    );
    if (notaRows.length === 0) {
      await client.query('ROLLBACK');
      return res.status(404).json({ message: 'Nota no encontrada.' });
    }
    if (['PAGADA', 'FINALIZADA', 'CANCELADA'].includes(notaRows[0].estado)) {
      await client.query('ROLLBACK');
      return res.status(400).json({ message: `No se pueden cambiar productos de una nota ${palabra(notaRows[0].estado)}.` });
    }
    const { rows: cargaRows } = await client.query(
      'SELECT id FROM nota_cargas WHERE id = $1 AND nota_id = $2',
      [cargaId, id]
    );
    if (cargaRows.length === 0) {
      await client.query('ROLLBACK');
      return res.status(404).json({ message: 'No se encontró el servicio.' });
    }
    const { rows: tipoRows } = await client.query('SELECT nombre FROM tipos_granel WHERE id = $1', [tipoId]);
    if (tipoRows.length === 0) {
      await client.query('ROLLBACK');
      return res.status(404).json({ message: 'No se encontró el tipo de granel.' });
    }

    // Lo que el servicio ya tenía de este tipo: se suelta.
    const { rows: previos } = await client.query(
      `SELECT np.id, np.producto_id, np.cantidad_medidas
         FROM nota_productos np
         JOIN productos p ON p.id = np.producto_id
        WHERE np.nota_id = $1 AND np.carga_id = $2 AND p.tipo_granel_id = $3
          AND p.tipo_liquido = 'granel' AND COALESCE(p.forma, 'liquido') = 'liquido'
        FOR UPDATE OF np`,
      [id, cargaId, tipoId]
    );
    if (previos.length > 0) {
      await devolverProductosDeNota(client, id, req.sucursal, req.user?.id, { ids: previos.map(np => np.id) });
      await client.query('DELETE FROM nota_productos WHERE id = ANY($1::int[])', [previos.map(np => np.id)]);
    }
    await client.query(
      'DELETE FROM nota_carga_pendientes WHERE carga_id = $1 AND tipo_granel_id = $2',
      [cargaId, tipoId]
    );

    let fila = null;
    if (delCliente) {
      await client.query(
        `INSERT INTO nota_carga_pendientes (nota_id, carga_id, tipo_granel_id, cantidad, del_cliente)
         VALUES ($1, $2, $3, $4, TRUE)`,
        [id, cargaId, tipoId, cantidad]
      );
    } else if (producto_id) {
      // Tiene que ser un granel líquido de ese tipo.
      const { rows: ok } = await client.query(
        `SELECT 1 FROM productos p
          WHERE p.id = $1 AND p.sucursal = $2 AND p.archivado = FALSE AND p.tipo_granel_id = $3
            AND p.tipo_liquido = 'granel' AND COALESCE(p.forma, 'liquido') = 'liquido'`,
        [producto_id, req.sucursal, tipoId]
      );
      if (ok.length === 0) {
        await client.query('ROLLBACK');
        return res.status(400).json({ message: `Elige un ${tipoRows[0].nombre.toLowerCase()} de la lista.` });
      }
      try {
        fila = await reservarProducto(client, id, Number(cargaId), Number(producto_id), cantidad, req.sucursal, notaRows[0].tipo_servicio);
      } catch (e) {
        await client.query('ROLLBACK');
        return res.status(400).json({ message: e.message });
      }
      // Si ya terminó una lavadora, ya se usó: sale del inventario ahora.
      if (await algunaLavadoraTermino(client, id)) {
        await consumirProductosDeNota(client, id, req.sucursal, req.user?.id, { soloGranel: true });
      }
    } else {
      await client.query(
        `INSERT INTO nota_carga_pendientes (nota_id, carga_id, tipo_granel_id, cantidad)
         VALUES ($1, $2, $3, $4)`,
        [id, cargaId, tipoId, cantidad]
      );
    }

    await recalcularPrecioTotal(client, id, {
      desmarcarPagoSiCambia: true, usuarioId: req.user?.id, sucursal: req.sucursal,
    });
    const errTope = await validarTopesCargas(client, id);
    if (errTope) {
      await client.query('ROLLBACK');
      return res.status(400).json({ message: errTope });
    }

    await client.query('COMMIT');
    res.json({ producto: fila, cargas: await cargasDeNota(pool, id) });
  } catch (err) {
    await client.query('ROLLBACK');
    if (respondioCorteCerrado(res, err)) return;
    console.error('elegirGranelDeCarga error:', err);
    res.status(500).json({ message: 'No se pudo guardar el granel del servicio. Intenta de nuevo.' });
  } finally {
    client.release();
  }
};

// ── DELETE /notas/:id/productos/:productoId ─────────────────
/** Quita un producto suelto de la nota (no el que va dentro de un servicio). */
export const removeProductoFromNota = async (req, res) => {
  const { id, productoId } = req.params;

  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    const { rows: npRows } = await client.query(
      `SELECT np.*, n.estado AS nota_estado FROM nota_productos np
       JOIN notas n ON n.id = np.nota_id AND n.sucursal = $3
       WHERE np.nota_id = $1 AND np.producto_id = $2
         AND np.carga_id IS NULL`,
      [id, productoId, req.sucursal]
    );
    if (npRows.length === 0) {
      await client.query('ROLLBACK');
      return res.status(404).json({ message: 'Producto no encontrado en la nota.' });
    }
    const np = npRows[0];
    if (['PAGADA', 'FINALIZADA', 'CANCELADA'].includes(np.nota_estado)) {
      await client.query('ROLLBACK');
      return res.status(400).json({
        message: `No se pueden quitar productos de una nota ${palabra(np.nota_estado)}.`,
      });
    }

    // Nota reabierta: lo ya entregado vuelve al inventario.
    await reabrirRenglonProducto(client, id, np.id, req.sucursal, req.user?.id);

    await client.query(
      'DELETE FROM nota_productos WHERE id = $1',
      [np.id]
    );

    await client.query(
      'UPDATE productos SET stock_reservado = stock_reservado - $1 WHERE id = $2',
      [np.cantidad_medidas, productoId]
    );

    await recalcularPrecioTotal(client, id, {
      desmarcarPagoSiCambia: true, usuarioId: req.user?.id, sucursal: req.sucursal,
    });

    await client.query('COMMIT');
    res.status(204).send();
  } catch (err) {
    await client.query('ROLLBACK');
    if (respondioCorteCerrado(res, err)) return;
    console.error('removeProductoFromNota error:', err);
    res.status(500).json({ message: 'No se pudo quitar el producto de la nota. Intenta de nuevo.' });
  } finally {
    client.release();
  }
};

// ── PATCH /notas/:id/productos/:productoId ──────────────────
/**
 * Cambia la cantidad de un producto suelto (botones + y − de Salidas). Llega la
 * cantidad final, no un delta, para que dos clics simultáneos no se sumen. El
 * precio unitario no cambia; se ajusta lo apartado y se valida que alcance.
 */
export const cambiarCantidadProducto = async (req, res) => {
  const { id, productoId } = req.params;
  const cantidad = Number(req.body?.cantidad);

  if (!Number.isFinite(cantidad) || cantidad <= 0) {
    return res.status(400).json({ message: 'La cantidad debe ser mayor a 0. Para quitarlo, bórralo.' });
  }

  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    const { rows: npRows } = await client.query(
      `SELECT np.*, n.estado AS nota_estado FROM nota_productos np
       JOIN notas n ON n.id = np.nota_id AND n.sucursal = $3
       WHERE np.nota_id = $1 AND np.producto_id = $2
         -- Solo el suelto, no el de un servicio.
         AND np.carga_id IS NULL`,
      [id, productoId, req.sucursal]
    );
    if (npRows.length === 0) {
      await client.query('ROLLBACK');
      return res.status(404).json({ message: 'Producto no encontrado en la nota.' });
    }
    const np = npRows[0];
    if (['PAGADA', 'FINALIZADA', 'CANCELADA'].includes(np.nota_estado)) {
      await client.query('ROLLBACK');
      return res.status(400).json({
        message: `No se pueden cambiar los productos de una nota ${palabra(np.nota_estado)}.`,
      });
    }

    // Nota reabierta: el renglón vuelve a apartado antes de cambiarlo.
    await reabrirRenglonProducto(client, id, np.id, req.sucursal, req.user?.id);

    // Medidas por unidad del renglón guardado, no del catálogo actual.
    const medidasPorPieza = Number(np.cantidad_medidas) / Number(np.cantidad);
    const medidasNuevas = cantidad * medidasPorPieza;
    const delta = medidasNuevas - Number(np.cantidad_medidas);

    const { rows: artRows } = await client.query(
      'SELECT nombre, stock_actual, stock_reservado FROM productos WHERE id = $1 AND sucursal = $2 FOR UPDATE',
      [productoId, req.sucursal]
    );
    if (artRows.length === 0) {
      await client.query('ROLLBACK');
      return res.status(404).json({ message: 'El producto ya no existe en esta sucursal.' });
    }
    const art = artRows[0];
    const disponible = Number(art.stock_actual) - Number(art.stock_reservado);
    if (delta > disponible + 1e-9) {
      await client.query('ROLLBACK');
      return res.status(400).json({
        message: `No hay suficiente existencia de "${art.nombre}" para servir esa cantidad.`,
      });
    }

    await client.query(
      'UPDATE nota_productos SET cantidad = $1, cantidad_medidas = $2 WHERE id = $3',
      [cantidad, medidasNuevas, np.id]
    );
    await client.query(
      'UPDATE productos SET stock_reservado = stock_reservado + $1 WHERE id = $2',
      [delta, productoId]
    );

    await recalcularPrecioTotal(client, id, {
      desmarcarPagoSiCambia: true, usuarioId: req.user?.id, sucursal: req.sucursal,
    });

    const errTope = await validarTopesCargas(client, id);
    if (errTope) {
      await client.query('ROLLBACK');
      return res.status(400).json({ message: errTope });
    }

    await client.query('COMMIT');
    const { rows } = await pool.query(
      `SELECT np.*, a.nombre, (np.cantidad * np.precio_unitario) AS subtotal
         FROM nota_productos np JOIN productos a ON a.id = np.producto_id
        WHERE np.nota_id = $1 AND np.producto_id = $2`,
      [id, productoId]
    );
    res.json(rows[0]);
  } catch (err) {
    await client.query('ROLLBACK');
    if (respondioCorteCerrado(res, err)) return;
    console.error('cambiarCantidadProducto error:', err);
    res.status(500).json({ message: 'No se pudo cambiar la cantidad. Intenta de nuevo.' });
  } finally {
    client.release();
  }
};

// ── Abonos (pagos parciales) ────────────────────────────────
// Cada abono entra en la caja abierta del día y su corte lo cuenta; al liquidar
// solo entra lo que faltaba. Cuando los abonos cubren el total, la nota queda
// PAGADA sola.

/** Suma de lo abonado (sin revertidos). */
async function totalAbonado(client, notaId) {
  const { rows } = await client.query(
    `SELECT COALESCE(SUM(monto), 0) AS abonado
       FROM nota_abonos WHERE nota_id = $1 AND revertido_at IS NULL`,
    [notaId]
  );
  return Number(rows[0].abonado);
}

// ── POST /notas/:id/abonos ──────────────────────────────────
/** Registra un abono: no puede pasar del saldo y exige caja abierta. */
export const abonarNota = async (req, res) => {
  const { id } = req.params;
  const { monto, forma_pago } = req.body;

  const importe = Number(monto);
  if (!Number.isFinite(importe) || importe <= 0) {
    return res.status(400).json({ message: 'El abono tiene que ser mayor a $0.' });
  }
  const formaPago = normalizarFormaPago(forma_pago);
  if (!formaPago) {
    return res.status(400).json({
      message: `Indica la forma de pago: ${enPalabras(FORMAS_PAGO_VALIDAS)}.`,
    });
  }

  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    const { rows: notaRows } = await client.query(
      `SELECT id, folio, estado, estado_pago, precio_total
         FROM notas WHERE id = $1 AND sucursal = $2 FOR UPDATE`,
      [id, req.sucursal]
    );
    if (notaRows.length === 0) {
      await client.query('ROLLBACK');
      return res.status(404).json({ message: 'Nota no encontrada.' });
    }
    const nota = notaRows[0];
    if (nota.estado === 'CANCELADA') {
      await client.query('ROLLBACK');
      return res.status(400).json({ message: 'Una nota cancelada no recibe abonos.' });
    }
    if (nota.estado_pago === 'PAGADO') {
      await client.query('ROLLBACK');
      return res.status(400).json({ message: 'Esta nota ya está pagada: no hay nada que abonar.' });
    }

    const abonado = await totalAbonado(client, id);
    const saldo = Number(nota.precio_total) - abonado;
    if (saldo <= 0) {
      await client.query('ROLLBACK');
      return res.status(409).json({ message: 'Esta nota ya está cubierta por sus abonos.' });
    }
    if (importe > saldo + 1e-9) {
      await client.query('ROLLBACK');
      return res.status(400).json({
        message: `El abono pasa de lo que falta: quedan $${saldo.toFixed(2)} por cobrar.`,
      });
    }

    // Se abona, pero no se liquida con la secadora por definir.
    if (importe >= saldo - 1e-9) {
      const porDefinir = await secadoraPorDefinir(client, id);
      if (porDefinir) {
        await client.query('ROLLBACK');
        return res.status(409).json({ message: porDefinir });
      }
    }

    // El abono entra en la caja abierta; sin caja no se recibe.
    const { rows: cajaRows } = await client.query(
      `SELECT id FROM cajas WHERE estado = 'abierta' AND sucursal = $1 LIMIT 1`,
      [req.sucursal]
    );
    const cajaId = cajaRows[0]?.id ?? null;
    if (!cajaId && notaRequiereCaja()) {
      await client.query('ROLLBACK');
      return res.status(409).json({
        code: 'CAJA_CERRADA',
        message: 'La caja está cerrada. Ábrela para poder recibir el pago.',
      });
    }

    const { rows: abonoRows } = await client.query(
      `INSERT INTO nota_abonos (nota_id, caja_id, usuario_id, monto, forma_pago)
       VALUES ($1, $2, $3, $4, $5) RETURNING *`,
      [id, cajaId, req.user?.id ?? null, importe, formaPago]
    );

    // Si quedó cubierta, la nota se cobra con la forma de este último abono.
    const cubierta = importe >= saldo - 1e-9;
    if (cubierta) {
      await client.query(
        `UPDATE notas SET estado_pago = 'PAGADO', forma_pago = $2 WHERE id = $1`,
        [id, formaPago]
      );
      // Igual que al liquidar: un Autoservicio sin pendientes se cierra.
      const { rows: estadoRows } = await client.query(
        'SELECT tipo_servicio, estado FROM notas WHERE id = $1', [id]
      );
      if (estadoRows[0]?.tipo_servicio === 'AUTOSERVICIO'
          && estadoRows[0]?.estado === 'LISTA'
          && !(await hayCargasPendientes(client, id))) {
        await cerrarNotaSinCargasPendientes(client, id, {
          sucursal: req.sucursal, usuarioId: req.user?.id,
        });
      }
    }

    await client.query('COMMIT');
    res.status(201).json({ ...abonoRows[0], nota_pagada: cubierta });
  } catch (err) {
    await client.query('ROLLBACK');
    console.error('abonarNota error:', err);
    res.status(500).json({ message: 'No se pudo registrar el abono. Intenta de nuevo.' });
  } finally {
    client.release();
  }
};

// ── PATCH /notas/:id/abonos/:abonoId/revertir ───────────────
/**
 * Revierte un abono mal capturado (admin, con motivo). No se borra: queda
 * marcado con quién y por qué. Solo mientras su caja siga abierta y la nota no
 * se haya liquidado en un corte cerrado. Si la nota estaba pagada, vuelve a deber.
 */
export const revertirAbono = async (req, res) => {
  const { id, abonoId } = req.params;
  const motivo = String(req.body?.motivo ?? '').trim().slice(0, 200);
  if (!motivo) {
    return res.status(400).json({ message: 'Escribe por qué se revierte el abono.' });
  }

  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    const { rows } = await client.query(
      `SELECT ab.id, ab.monto, ab.caja_id, ab.revertido_at, n.estado_pago, n.id AS nota_id,
              n.caja_id AS nota_caja_id
         FROM nota_abonos ab
         JOIN notas n ON n.id = ab.nota_id
        WHERE ab.id = $1 AND ab.nota_id = $2 AND n.sucursal = $3
        FOR UPDATE OF ab`,
      [abonoId, id, req.sucursal]
    );
    if (rows.length === 0) {
      await client.query('ROLLBACK');
      return res.status(404).json({ message: 'Ese abono no es de esta nota.' });
    }
    const abono = rows[0];
    if (abono.revertido_at) {
      await client.query('ROLLBACK');
      return res.status(409).json({ message: 'Ese abono ya estaba revertido.' });
    }
    if (abono.caja_id) {
      const { rows: cj } = await client.query(
        'SELECT estado FROM cajas WHERE id = $1', [abono.caja_id]
      );
      if (cj[0]?.estado !== 'abierta') {
        await client.query('ROLLBACK');
        return res.status(409).json({
          message: 'El corte de caja de ese abono ya se cerró: solo se puede revertir '
                 + 'mientras esa caja siga abierta.',
        });
      }
    }

    // Liquidada en un corte cerrado: volver a cobrarla contaría dos veces.
    if (abono.estado_pago === 'PAGADO' && abono.nota_caja_id) {
      const { rows: cjNota } = await client.query(
        'SELECT estado FROM cajas WHERE id = $1', [abono.nota_caja_id]
      );
      if (cjNota[0]?.estado !== 'abierta') {
        await client.query('ROLLBACK');
        return res.status(409).json({
          message: 'Esta nota se terminó de cobrar en un corte de caja que ya se cerró: '
                 + 'sus abonos ya no se pueden revertir.',
        });
      }
    }

    await client.query(
      `UPDATE nota_abonos
          SET revertido_at = NOW(), revertido_por = $2, motivo_reversion = $3
        WHERE id = $1`,
      [abonoId, req.user?.id ?? null, motivo]
    );

    // Si con este abono la nota había quedado pagada, vuelve a deber.
    if (abono.estado_pago === 'PAGADO') {
      await client.query(
        `UPDATE notas SET estado_pago = 'PENDIENTE', forma_pago = NULL WHERE id = $1`,
        [id]
      );
    }

    await client.query('COMMIT');
    res.json({ ok: true });
  } catch (err) {
    await client.query('ROLLBACK');
    console.error('revertirAbono error:', err);
    res.status(500).json({ message: 'No se pudo revertir el abono. Intenta de nuevo.' });
  } finally {
    client.release();
  }
};

// ── PATCH /notas/:id/reabrir ────────────────────────────────
/**
 * Deshace la entrega (admin): la nota FINALIZADA vuelve a Por Entregar. No toca
 * el cobro ni el inventario; lo ya descontado no se repite al entregarla de
 * nuevo, y si se cambia un producto, ver reabrirRenglonProducto.
 */
export const reabrirNota = async (req, res) => {
  const { id } = req.params;
  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    const { rows } = await client.query(
      `SELECT id, estado, estado_pago FROM notas
        WHERE id = $1 AND sucursal = $2 FOR UPDATE`,
      [id, req.sucursal]
    );
    if (rows.length === 0) {
      await client.query('ROLLBACK');
      return res.status(404).json({ message: 'Nota no encontrada.' });
    }
    const nota = rows[0];
    if (nota.estado === 'CANCELADA') {
      await client.query('ROLLBACK');
      return res.status(400).json({ message: 'Una nota cancelada no se reabre.' });
    }
    if (nota.estado !== 'FINALIZADA') {
      await client.query('ROLLBACK');
      return res.status(400).json({
        message: 'Solo se reabre una nota ya entregada: esta sigue abierta.',
      });
    }

    const { rows: actualizada } = await client.query(
      `UPDATE notas SET estado = 'LISTA' WHERE id = $1 RETURNING *`,
      [id]
    );

    await client.query('COMMIT');
    res.json({ ...actualizada[0], cargas: await cargasDeNota(pool, id) });
  } catch (err) {
    await client.query('ROLLBACK');
    console.error('reabrirNota error:', err);
    res.status(500).json({ message: 'No se pudo reabrir la nota. Intenta de nuevo.' });
  } finally {
    client.release();
  }
};

// ── PATCH /notas/:id/ajuste ─────────────────────────────────
/**
 * Ajuste de la nota desde Salidas: descuento (negativo) o cargo extra
 * (positivo); sale en el ticket. Si la nota estaba cobrada vuelve a PENDIENTE
 * por el importe nuevo; con el cobro en un corte cerrado no se permite.
 */
export const ajustarNota = async (req, res) => {
  const { id } = req.params;
  const { ajuste } = req.body;

  if (ajuste == null || ajuste === '' || !Number.isFinite(Number(ajuste))) {
    return res.status(400).json({ message: 'El ajuste debe ser un número.' });
  }
  const ajusteNum = Number(ajuste);

  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    const { rows } = await client.query(
      'SELECT id, estado FROM notas WHERE id = $1 AND sucursal = $2 FOR UPDATE',
      [id, req.sucursal]
    );
    if (rows.length === 0) {
      await client.query('ROLLBACK');
      return res.status(404).json({ message: 'Nota no encontrada.' });
    }
    if (['FINALIZADA', 'CANCELADA'].includes(rows[0].estado)) {
      await client.query('ROLLBACK');
      return res.status(400).json({
        message: `No se puede ajustar una nota ${palabra(rows[0].estado)}.`,
      });
    }

    await client.query('UPDATE notas SET ajuste = $1 WHERE id = $2', [ajusteNum, id]);
    const total = await recalcularPrecioTotal(client, id, {
      desmarcarPagoSiCambia: true, usuarioId: req.user?.id, sucursal: req.sucursal,
    });
    if (Number(total) < 0) {
      await client.query('ROLLBACK');
      return res.status(400).json({
        message: 'El total de la nota no puede ser negativo. Revisa el ajuste.',
      });
    }

    const { rows: fresca } = await client.query('SELECT * FROM notas WHERE id = $1', [id]);
    await client.query('COMMIT');
    res.json({ ...fresca[0], cargas: await cargasDeNota(pool, id) });
  } catch (err) {
    await client.query('ROLLBACK');
    if (respondioCorteCerrado(res, err)) return;
    console.error('ajustarNota error:', err);
    res.status(500).json({ message: 'No se pudo guardar el ajuste. Intenta de nuevo.' });
  } finally {
    client.release();
  }
};
