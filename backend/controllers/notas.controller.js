import pool from '../db/pool.js';
import { esAdmin } from '../middleware/roles.js';
import { tarifaSecadora, precioProductoEnNota, unidadDeVenta, medidasPorUnidad, generarFolio } from '../utils/calculosNotas.js';
// El resto del archivo se apoya en el trigger de LISTEN/NOTIFY (mig. 075) para
// encender y apagar. Aquí se llama directo porque "Encender máquina" es la
// acción que el empleado está mirando: no debe depender de que el listener esté
// vivo. Es idempotente, así que el aviso del trigger llegando después no molesta.
import { sincronizarSonoff, maxCiclosDeMaquina } from '../services/sincronizarSonoff.js';
import { MINUTOS_CONFIGURADOS, OPCIONES_DE_MARCA, esCronometroSql } from '../db/sqlMaquina.js';

const ESTADOS_VALIDOS     = ['EN_ESPERA', 'LAVANDO', 'SECANDO', 'LISTA', 'PAGADA', 'FINALIZADA', 'CANCELADA'];
// PRODUCTOS es la venta de mostrador (mig. 112): productos sueltos, sin lavado
// ni secado. No lleva cargas, y por eso varias reglas de abajo la tratan aparte.
const TIPOS_SERVICIO_VALIDOS = ['AUTOSERVICIO', 'EDREDON', 'POR_ENCARGO', 'PRODUCTOS'];

// ¿Es una venta de mostrador? Se pregunta lo bastante seguido como para tener
// nombre propio.
const esVenta = (tipo_servicio) => tipo_servicio === 'PRODUCTOS';
const ESTADOS_PAGO_VALIDOS = ['PENDIENTE', 'PAGADO'];
// Formas de pago (mig. 078/090). Para el corte de caja solo EFECTIVO es dinero
// en el cajón; transferencia y tarjeta son cobros reales que no lo engrosan.
const FORMAS_PAGO_VALIDAS = ['EFECTIVO', 'TRANSFERENCIA', 'TARJETA'];

// Normaliza la forma de pago recibida; devuelve null si no es una válida.
const normalizarFormaPago = (v) => {
  if (v == null) return null;
  const s = String(v).trim().toUpperCase();
  return FORMAS_PAGO_VALIDAS.includes(s) ? s : null;
};
const TAMANOS_VALIDOS     = ['chico', 'mediano', 'grande', 'jumbo'];
const TIPOS_PRENDA_VALIDOS = ['ROPA', 'EDREDON'];
// Tipo de máquina previsto por carga en Por Encargo (define el precio; la
// máquina física real se asigna después en Salidas).
const TIPOS_MAQUINA_VALIDOS = ['mediana', 'jumbo', 'edredon'];
// Cuándo estará lista la ropa: mañana, en dos días, u OTRA fecha —que entonces
// va en `fecha_entrega` (2026-09-25)—. Antes eran horarios del día
// (mañana/tarde/noche), pero lo que el mostrador promete es el DÍA. Es
// opcional: una nota puede no prometer nada.
const TIEMPOS_ENTREGA_VALIDOS = ['MANANA', 'DOS_DIAS', 'OTRA'];

// Los estados y catálogos se guardan en MAYÚSCULAS, pero nadie los lee así en
// pantalla: los mensajes hablan de "por encargo" y "en espera", no de
// POR_ENCARGO ni EN_ESPERA.
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

// ['L1', 'S2'] → "L1 y S2". Hermano de enPalabras, pero para enumerar cosas
// que pasan a la vez, no opciones entre las que se elige.
const listaY = (valores) => {
  if (valores.length <= 1) return valores.join('');
  return `${valores.slice(0, -1).join(', ')} y ${valores.at(-1)}`;
};

// ['chico', 'grande', 'jumbo'] → "chico, grande o jumbo"
const enPalabras = (valores) => {
  const legibles = valores.map(palabra);
  if (legibles.length <= 1) return legibles.join('');
  return `${legibles.slice(0, -1).join(', ')} o ${legibles.at(-1)}`;
};

// Transiciones permitidas por estado actual
const TRANSICIONES_VALIDAS = {
  // EN_ESPERA → LISTA existe para poder cerrar a mano una nota cuyas cargas
  // ya no se van a usar (el cliente trajo menos ropa de la prevista). Sin esa
  // salida la nota se quedaba En Espera para siempre. Ojo: cierra la nota con
  // las cargas tal como están, así que lo justo suele ser quitar antes la carga
  // que no se usó, para no cobrarla.
  EN_ESPERA:  ['LAVANDO', 'SECANDO', 'LISTA', 'CANCELADA'],
  LAVANDO:    ['SECANDO', 'LISTA',            'CANCELADA'],
  SECANDO:    ['LISTA',                       'CANCELADA'],
  LISTA:      ['PAGADA',  'FINALIZADA',       'CANCELADA'],
  PAGADA:     ['FINALIZADA',                  'CANCELADA'],
  FINALIZADA: [],
  CANCELADA:  [],
};

// Subconsulta con los IDs de todas las máquinas vinculadas a la nota `n`
// (las de sus cargas, tabla nota_cargas).
const SQL_MAQUINAS_DE_NOTA = `
  SELECT nc.lavadora_id AS mid FROM nota_cargas nc WHERE nc.nota_id = n.id
  UNION SELECT nc.secadora_id FROM nota_cargas nc WHERE nc.nota_id = n.id`;

// Fase de proceso de una nota según las máquinas EN USO ahora mismo: LAVANDO si
// alguna lavadora corre; si no, SECANDO si alguna secadora corre; y EN_ESPERA si
// no hay ninguna máquina en uso (todas asignadas pero sin iniciar, o ya
// detenidas). Solo cuentan las máquinas que ESTA nota arrancó (mig. 097): otra
// nota puede tener la misma asignada, y su ciclo no es el nuestro.
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

// ¿Alguna lavadora de la nota ya terminó? Es lo que habilita "Procesado" en el
// detalle (2026-10-02): antes de que la ropa salga de una lavadora no hay nada
// que doblar ni empacar. Una lavadora que ESTA nota arrancó cuenta como
// terminada si:
//   · ya la soltó (la carga quedó sin lavadora), o ya no está corriendo, o
//   · sigue puesta con temporizador y su tiempo ya se cumplió.
// La de cronómetro (todas desde el 2026-10-02) no tiene tiempo que cumplir: cuenta
// solo cuando alguien la finaliza.
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

// ¿A la nota le falta trabajo por hacer? Una carga cuenta como PENDIENTE si:
//   · tiene una máquina asignada o corriendo, o
//   · se pidió lavado (lavadora_tipo) que nunca arrancó, o
//   · se pidió secado (secadora_tipo) que nunca arrancó.
// Haber usado ya la máquina no cuenta.
//
// Sin esto bastaba con que NINGUNA máquina estuviera en uso para dar la nota
// por terminada, y una carga que todavía no arrancaba no tiene máquina en uso:
// una nota de dos cargas pasaba a "Por entregar" —y se dejaba liquidar— con la
// segunda carga sin lavar.
//
// Lo que NO cuenta es un SERVICIO de Por Encargo sin máquina. Ahí la nota
// captura lo que se cobra —dos servicios Chico, un Edredón— y las máquinas se
// manejan aparte, en Salidas: son independientes de lo que se vendió, así que
// un servicio no es una máquina esperando turno. Lo que dice que a la nota le
// falta trabajo son sus MÁQUINAS, puestas o corriendo.
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

// Estado en el que queda una nota a la que ya no le falta ninguna carga.
//
// Autoservicio PAGADO: el cliente está en el local y se lleva su ropa él mismo,
// así que no hay nada "por entregar" — la nota se cierra sola. En Por Encargo y
// Edredón sí pasa por Por Entregar: el negocio guarda la ropa hasta que la
// recogen.
//
// Un autoservicio que todavía DEBE se queda en Por Entregar, porque FINALIZADA
// es terminal y cerrarla ahí dejaría el cobro sin registrar y sin forma de
// hacerlo desde la nota. Desde el 2026-09-23 ese es el caso normal —el cobro
// dejó de ser obligatorio para arrancar—, y al liquidarla desde el detalle se
// cierra sola (ver `cambiarEstadoPago`).
//
// POR ENCARGO ya no pasa sola a Por Entregar (2026-09-28). Que las máquinas
// terminen no quiere decir que la ropa esté lista: falta doblarla, empacarla y
// revisarla, y eso lo dice una persona con el botón **"Procesado"** del detalle
// —que además es el que avisa al cliente—. Mientras tanto la nota se queda En
// Espera, que es donde de verdad está. Es el ÚNICO camino a Por Entregar en
// este servicio: ni terminar la última máquina ni el cierre del día la mueven.
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

// Cierra la nota que ya no tiene cargas pendientes y devuelve el estado en que
// quedó. Si se finaliza sola, consume el stock de sus productos igual que lo
// haría el cierre a mano (cambiarEstadoNota): sin esto el producto se quedaría
// reservado para siempre y el inventario descuadrado.
async function cerrarNotaSinCargasPendientes(client, notaId, { sucursal, usuarioId }) {
  const estado = await estadoAlTerminarCargas(client, notaId);
  if (estado === 'FINALIZADA') {
    await registrarMovimientosProductosNota(client, notaId, sucursal, usuarioId, 'venta');
    await client.query(
      `UPDATE productos a
          SET stock_actual    = stock_actual    - np.cantidad_medidas,
              stock_reservado = stock_reservado - np.cantidad_medidas
        FROM nota_productos np
        WHERE np.nota_id = $1 AND np.producto_id = a.id`,
      [notaId]
    );
  }
  await client.query('UPDATE notas SET estado = $1 WHERE id = $2', [estado, notaId]);
  return estado;
}

// ¿El producto de esta nota ya se dio por VENDIDO? Se sabe por su movimiento de
// inventario: entregar (o cobrar) lo saca del estante y deja la marca. Importa
// porque una nota entregada se puede reabrir (2026-09-25) y volver a entregar:
// sin esto, la segunda entrega descontaría el mismo producto otra vez.
async function stockYaConsumido(client, notaId) {
  const { rows } = await client.query(
    `SELECT 1 FROM producto_movimientos
      WHERE nota_id = $1 AND tipo = 'venta' LIMIT 1`,
    [notaId]
  );
  return rows.length > 0;
}

// IDs (sin repetir) de todas las máquinas vinculadas a una nota.
async function maquinasDeNota(client, notaId) {
  const { rows } = await client.query(
    `SELECT DISTINCT x.mid
       FROM notas n, LATERAL (${SQL_MAQUINAS_DE_NOTA}) x
      WHERE n.id = $1 AND x.mid IS NOT NULL`,
    [notaId]
  );
  return rows.map(r => r.mid);
}

// De la lista `ids`, devuelve las máquinas (id, nombre) que ya tiene apartadas
// OTRA nota abierta (En Espera / Lavando / Secando): asignadas a una carga o en
// las cargas de otra nota abierta. `notaIdExcluir` omite la nota en curso
// (edición/asignar). Se espera haber bloqueado antes las filas de maquinas
// (FOR UPDATE) para que dos asignaciones simultáneas de la misma máquina no se
// pisen.
// Nota que tiene una máquina EN USO ahora mismo, si no es la que se indica.
// Asignar una máquina no la aparta: varias notas pueden tenerla asignada
// mientras nadie la arranque. La primera que le da a "Iniciar" se la queda, y
// a partir de ahí las demás tienen que cambiarla. Sirve para decir en el aviso
// quién la está usando.
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

// Marca en la carga que SUS máquinas arrancaron de verdad (mig. 097). Tener
// una máquina asignada ya no implica usarla: varias notas pueden tener la
// misma y solo la que le da a Iniciar la usa. Esta marca es la que distingue
// una cosa de la otra para liberar máquinas y para el reporte de uso.
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

// Libera (pasa a disponible) las máquinas que ESTA nota arrancó y siguen en
// uso. Las que solo tiene asignadas no se tocan: pueden estar corriendo para
// otra nota que se le adelantó al iniciar, y apagarlas la dejaría a medias.
async function liberarMaquinasDeNota(client, notaId) {
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
  await client.query(
    `UPDATE maquinas SET estado = 'disponible', en_uso_desde = NULL
      WHERE id = ANY($1) AND estado = 'en_uso'`,
    [ids]
  );
}

// Recalcula precio_total de una nota.
//
// Precio cobrado por carga:
//   - Por Encargo CON tope: el precio ES el tope (precio fijo de la carga),
//     aunque el costo interno (máquinas + productos) sea menor. El granel y la
//     bolsa quedan absorbidos en el tope; los productos de MARCA no: esos son
//     un producto que el cliente compra y se cobran aparte, encima del tope
//     (2026-09-25).
//   - Por Encargo SIN tope, o Autoservicio: suma real = máquinas + productos
//     de la carga.
//   + el ajuste por carga (nota_cargas.ajuste), que va aparte del tope.
// Más: productos a nivel nota (carga_id NULL, Autoservicio) + ajuste de nota.
// Cambiar algo que mueve el total de una nota cobrada en un corte YA CERRADO
// devolvería el pago a PENDIENTE, y eso descuadra: el corte cerrado tiene sus
// cifras congeladas (mig. 101), así que seguiría contando esa venta y al volver
// a cobrar la nota el mismo dinero entraría otra vez en la caja de hoy. Es el
// mismo motivo por el que la reversión manual solo se permite con la caja
// abierta; aquí lo medida por el lado automático (2026-09-22).
class CorteCerradoError extends Error {
  constructor(folio) {
    // Ojo con lo que se promete: un corte cerrado NO se reabre (caja solo pasa
    // a 'cerrada', nunca al revés), así que mandar a "abrir esa caja" sería
    // mandar a la nada. Lo que sí se puede hacer es cobrar o devolver aparte.
    super(`El cobro de la nota ${folio} ya quedó en un corte cerrado, así que no se puede `
        + 'cambiar lo que cuesta: la nota volvería a pendiente y ese dinero ya está contado '
        + 'en aquel corte. Si falta cobrar algo, hazlo en una nota nueva; si hay que devolver, '
        + 'regístralo como salida de caja.');
    this.name = 'CorteCerradoError';
  }
}

// Convierte ese tropiezo en un 409 con su motivo en vez del 500 genérico de
// "intenta de nuevo": es una regla de negocio, no una falla, y reintentar no
// la va a arreglar. Devuelve true si ya respondió.
function respondioCorteCerrado(res, err) {
  if (!(err instanceof CorteCerradoError)) return false;
  res.status(409).json({ message: err.message });
  return true;
}

// Con `desmarcarPagoSiCambia`, una nota que ya estaba PAGADA vuelve a
// PENDIENTE si el cambio movió su total: lo que se cobró ya no corresponde a lo
// que cuesta la nota, así que el cobro se rehace por el importe nuevo. El
// trigger de la migración 037 limpia `pagado_en` al salir de PAGADO, con lo que
// la venta también sale del corte de caja hasta que se vuelva a cobrar.
// Si el total no se movió (por ejemplo, una máquina asignada "sin cobro"), el
// pago se respeta tal cual.
async function recalcularPrecioTotal(client, notaId, opciones = {}) {
  const { desmarcarPagoSiCambia = false, usuarioId = null, sucursal = null } = opciones;
  const { rows: previas } = desmarcarPagoSiCambia
    ? await client.query(
        'SELECT id, folio, precio_total, estado_pago, caja_id FROM notas WHERE id = $1',
        [notaId]
      )
    : { rows: [] };

  // El estado de su caja se lee APARTE y con candado: `cerrarCaja` toma esa
  // fila con FOR UPDATE y congela las cifras desde su propia foto, así que un
  // cierre que corra entre esta lectura y el COMMIT contaría la venta mientras
  // aquí se deja la nota en PENDIENTE — justo el descuadre que esto evita.
  // (Va en su propia consulta porque Postgres no deja bloquear el lado nulo de
  // un LEFT JOIN.)
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
                -- Por Encargo cobra el PRECIO DEL SERVICIO, que ya paga lo que
                -- se sirve dentro: el granel (por medida) y la bolsa. Los de
                -- MARCA no: esos se venden por unidad, así que van encima.
                WHEN n.tipo_servicio = 'POR_ENCARGO' AND carga.tope IS NOT NULL
                  THEN carga.tope + carga.productos_marca
                ELSE carga.maquinas + carga.productos
              END
              + carga.ajuste)
            FROM (
              -- El tope es el que se congeló en la carga (mig. 096), no el
              -- vigente en Ajustes: cambiar los precios no re-tarifa notas
              -- viejas ni descuadra lo que ya se cobró.
              SELECT nc.ajuste, nc.precio_tope AS tope,
                     nc.precio_lavadora + nc.precio_secadora AS maquinas,
                     COALESCE((SELECT SUM(np.cantidad * np.precio_unitario)
                                 FROM nota_productos np WHERE np.carga_id = nc.id), 0) AS productos,
                     -- Lo que se vende por unidad (marca y polvo) va encima
                     -- del tope; lo servido por medidas ya lo paga el servicio.
                     COALESCE((SELECT SUM(np.cantidad * np.precio_unitario)
                                 FROM nota_productos np
                                 JOIN productos a ON a.id = np.producto_id
                                WHERE np.carga_id = nc.id
                                  AND a.se_vende_por_unidad), 0) AS productos_marca
                FROM nota_cargas nc
               WHERE nc.nota_id = n.id
            ) carga
          ), 0)
          -- Productos a nivel nota. En POR ENCARGO solo se cobra lo que se
          -- vende POR UNIDAD (marca y polvo): el granel líquido y las bolsas son
          -- material del servicio —el jabón con el que se lava— y su precio ya
          -- los paga; lo que impide servirlos sin medida es el tope
          -- (validarTopesCargas).
          -- En los demás servicios el producto es una venta y se cobra todo.
          + COALESCE((SELECT SUM(np.cantidad * np.precio_unitario)
                        FROM nota_productos np
                        JOIN productos a ON a.id = np.producto_id
                       WHERE np.nota_id = n.id AND np.carga_id IS NULL
                         AND (n.tipo_servicio <> 'POR_ENCARGO' OR a.se_vende_por_unidad)), 0)
          + n.ajuste
      WHERE n.id = $1
      RETURNING precio_total`,
    [notaId]
  );
  const nuevo = rows[0]?.precio_total ?? null;

  const antes = previas[0];
  if (antes && antes.estado_pago === 'PAGADO' && Number(nuevo) !== Number(antes.precio_total)) {
    // Un cobro sin caja (caja_id NULL) no entró en ningún corte: ese sí se puede
    // deshacer. Lo que no se toca es el que quedó congelado en un corte cerrado.
    if (antes.caja_id && antes.caja_estado !== 'abierta') {
      throw new CorteCerradoError(antes.folio ?? `#${antes.id}`);
    }
    await desmarcarPagoPorCambio(client, antes, Number(antes.precio_total), Number(nuevo), usuarioId, sucursal);
  }
  return nuevo;
}

// Devuelve la nota a PENDIENTE porque su costo cambió: lo cobrado ya no
// corresponde. Limpia la forma de pago (el trigger de la mig. 037 limpia
// `pagado_en`) y deja aviso en la campana con los dos importes, para que se vea
// cuánto falta cobrar o devolver.
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


// Tarifas por carga desde ajustes (con los defaults de siempre).
async function tarifasCarga(client) {
  const { rows } = await client.query(
    `SELECT precio_carga_mediana, precio_carga_jumbo,
            precio_carga_secadora, precio_secadora_jumbo,
            tope_carga_chico, tope_carga_mediano, tope_carga_grande, tope_carga_jumbo, tope_carga_edredon
       FROM ajustes WHERE id = 1`
  );
  const c = rows[0] ?? {};
  return {
    mediana:         c.precio_carga_mediana    != null ? Number(c.precio_carga_mediana)    : 70,
    jumbo:           c.precio_carga_jumbo      != null ? Number(c.precio_carga_jumbo)      : 70,
    // Secado por categoría. La columna plana precio_carga_secadora es la Mediana.
    secadora:        c.precio_carga_secadora   != null ? Number(c.precio_carga_secadora)   : 45,
    secadoraJumbo:   c.precio_secadora_jumbo   != null ? Number(c.precio_secadora_jumbo)   : 45,
    // Topes por tamaño de carga (Por Encargo). NULL = sin tope configurado.
    topeChico:       c.tope_carga_chico   != null ? Number(c.tope_carga_chico)   : null,
    topeMediano:     c.tope_carga_mediano != null ? Number(c.tope_carga_mediano) : null,
    topeGrande:      c.tope_carga_grande  != null ? Number(c.tope_carga_grande)  : null,
    topeJumbo:       c.tope_carga_jumbo   != null ? Number(c.tope_carga_jumbo)   : null,
    topeEdredon:     c.tope_carga_edredon != null ? Number(c.tope_carga_edredon) : null,
    // Precio de cada tamaño de edredón (mig. 130), por nombre en minúsculas.
    preciosEdredon:  await preciosEdredon(client),
  };
}

// El precio de cada tamaño de edredón sale de su catálogo (mig. 130). Se
// incluyen los inactivos: editar una nota que ya lo usa no debe quedarse sin
// precio. NULL = el tamaño no tiene precio todavía.
async function preciosEdredon(client) {
  const { rows } = await client.query('SELECT nombre, precio FROM tamanos_edredon');
  return new Map(rows.map(r => [
    String(r.nombre).trim().toLowerCase(),
    r.precio != null ? Number(r.precio) : null,
  ]));
}

// Tope vigente de una carga según su prenda y tamaño. En Por Encargo este tope
// ES el precio de la carga, así que se congela en `nota_cargas.precio_tope` al
// crearla (mig. 096): si el negocio cambia sus precios, las notas que ya
// existen conservan el suyo. NULL = sin tope (se cobra la suma de lo que lleva).
// El edredón se cobra según su tamaño (mig. 130); el de una carga vieja sin
// tamaño conserva el precio único de antes.
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

// Los servicios que Por Encargo vende hoy: Chico, Mediano, Grande y Edredón
// (uno por tamaño: Individual, Matrimonial, King, Cubre Colchón). El
// edredón viaja como prenda EDREDON en tamaño jumbo (es lo que lo ata a la
// lavadora jumbo), así que se reconoce por la prenda. Jumbo de ropa ya no se
// vende: sigue siendo válido para las notas que lo eligieron cuando existía.
const esServicioQueSeVende = (prenda, tamano) =>
  String(prenda ?? '').toUpperCase() === 'EDREDON' || ['chico', 'mediano', 'grande'].includes(tamano);

// Lo que le cuesta al negocio la MÁQUINA de un servicio Por Encargo.
//
// La nota ya no elige tipo de máquina, pero el servicio sí sabe cuál le toca:
// Chico, Mediano y Grande van en lavadora y secadora medianas, y el Edredón en la
// lavadora jumbo —secarlo es una decisión aparte, así que no cuenta—. Ese costo
// es parte de lo que el precio del servicio tiene que cubrir, así que gasta de
// su tope igual que el jabón: si no, el tope solo cuidaba el material y se
// podía servir hasta el último peso como si la lavadora fuera gratis.
//
// Jumbo de ropa ya no se vende; se conserva para las notas que lo eligieron.
function costoMaquinasDeServicio(prenda, tamano, t) {
  if (String(prenda ?? '').toUpperCase() === 'EDREDON') return Number(t.jumbo) || 0;
  if (tamano === 'jumbo')  return (Number(t.jumbo)   || 0) + (Number(t.secadora) || 0);
  if (['chico', 'mediano', 'grande'].includes(tamano)) {
    return (Number(t.mediana) || 0) + (Number(t.secadora) || 0);
  }
  return 0;
}

// Cómo se llama el servicio en la pantalla, para los mensajes de error.
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

// Tiempos de ciclo (minutos) de RESPALDO, por tamaño de carga.
//
// Desde la mig. 107 el tiempo bueno sale de la marca de la máquina (una LG
// mediana tarda 45 y una Speed Queen jumbo 35, al revés de lo que suponía el
// eje del tamaño). Estos números solo se usan cuando la máquina no tiene marca
// o esa combinación marca+tamaño no está configurada, para que nada se quede
// sin temporizador.
//
// El edredón ya no aparece: dejó de tener tiempo propio y usa el de su tamaño
// (decisión del negocio, 2026-09-11). Conserva su precio, que es lo que
// distingue el servicio.
async function tiemposCarga(client) {
  const { rows } = await client.query(
    `SELECT tiempo_carga_mediana, tiempo_carga_jumbo,
            tiempo_carga_secadora, tiempo_secadora_jumbo
       FROM ajustes WHERE id = 1`
  );
  const c = rows[0] ?? {};
  // La columna plana `tiempo_carga_secadora` es la secadora MEDIANA (mig. 051);
  // la jumbo tiene la suya y cae en la mediana mientras no se configure.
  const secMediana = c.tiempo_carga_secadora != null ? Number(c.tiempo_carga_secadora) : 30;
  return {
    mediana:    c.tiempo_carga_mediana  != null ? Number(c.tiempo_carga_mediana)  : 30,
    jumbo:      c.tiempo_carga_jumbo    != null ? Number(c.tiempo_carga_jumbo)    : 45,
    secMediana,
    secJumbo:   c.tiempo_secadora_jumbo != null ? Number(c.tiempo_secadora_jumbo) : secMediana,
  };
}

function tarifaLavadora(tipoMaquina, tipoPrenda, t) {
  // El edredón se cobra como cualquier carga jumbo: ya no tiene tarifa propia
  // de máquina (2026-10-02); su precio Por Encargo es el del servicio.
  if (tipoMaquina === 'lavadora_jumbo') return t.jumbo;
  return t.mediana;
}

// Sella maquinas.ciclo_minutos de TODAS las máquinas EN USO de la nota
// (lavadoras y secadoras).
//
// La duración es de la MÁQUINA, no de la carga (mig. 107): sale de su marca y
// su tamaño, porque una LG mediana tarda 45 min y una Speed Queen jumbo 35 —
// al revés de lo que suponía el eje del tamaño, que daba por hecho que una
// jumbo tarda más. Si la máquina no tiene marca, o esa combinación no está
// configurada, cae al tiempo por tamaño de Ajustes: el comportamiento de
// antes, para que ninguna máquina se quede sin temporizador.
//
// El edredón ya no se distingue: usa el tiempo de su tamaño como cualquier
// otra carga de esa máquina.
//
// Idempotente; se llama tras poner máquinas en uso en cualquier flujo.
// Solo se sella el ciclo de las máquinas que ESTA nota arrancó: otra nota
// puede tener la misma máquina asignada, y resellarle el ciclo le movería el
// temporizador a media lavada (mig. 097).
// `elegido` es `{ maquinaId, minutos }` cuando el empleado escogió la duración
// en el modal del modelo que pregunta (mig. 120): se escribe encima de lo que
// resolvió la cadena, y solo para esa máquina.
//
// En la máquina con cronómetro (2026-10-02) estos minutos son su TOPE: el mismo
// corte por fin de ciclo es el que la apaga si nadie la finaliza.
async function sellarCicloMaquinas(client, notaId, elegido = null) {
  const ti = await tiemposCarga(client);
  await client.query(
    `UPDATE maquinas m
        SET ciclo_minutos = ciclos.minutos
       FROM (
         -- Lavadoras de la nota
         SELECT nc.lavadora_id AS mid,
                COALESCE(
                  COALESCE(mo.minutos_3, mo.minutos_2, mo.minutos),
                  tm.minutos,
                  CASE WHEN ml.tipo = 'lavadora_jumbo' THEN $2::int ELSE $3::int END
                ) AS minutos
           FROM nota_cargas nc
           JOIN maquinas ml ON ml.id = nc.lavadora_id
           -- La máquina guarda el NOMBRE de la marca y del modelo (migs. 106 y
           -- 117), así que los catálogos se alcanzan por nombre y no por id.
           LEFT JOIN marcas_maquina mm ON mm.nombre = ml.marca
           -- Misma cadena que MINUTOS_CONFIGURADOS: manda el modelo, y si no
           -- tiene tiempo propio manda su marca.
           LEFT JOIN modelos_maquina mo
                  ON mo.marca_id = mm.id AND mo.nombre = ml.modelo
           LEFT JOIN tiempos_marca tm
                  ON tm.marca_id = mm.id AND tm.tipo = 'lavadora' AND tm.tamano = ml.tamano
          WHERE nc.nota_id = $1 AND nc.lavadora_id IS NOT NULL
            AND nc.lavadora_iniciada_at IS NOT NULL
         UNION ALL
         -- Secadoras de la nota. Mismo criterio, y el respaldo también va por
         -- tamaño desde que la secadora se da de alta como mediana o jumbo.
         SELECT nc.secadora_id AS mid,
                COALESCE(
                  COALESCE(mo.minutos_3, mo.minutos_2, mo.minutos), tm.minutos,
                  CASE WHEN ms.tamano = 'jumbo' THEN $5::int ELSE $4::int END
                ) AS minutos
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
      `UPDATE maquinas SET ciclo_minutos = $2 WHERE id = $1 AND estado = 'en_uso'`,
      [elegido.maquinaId, elegido.minutos]
    );
  }
}

// El tiempo que llega del modal tiene que ser UNO DE LOS QUE OFRECE el modelo
// de esa máquina: es lo que decide cuándo se le corta la corriente, así que no
// se acepta un número cualquiera del cliente. Devuelve `{ minutos }` si vale,
// `{ error }` si no, y `null` si no llegó ninguno (el caso normal).
async function tiempoElegidoDeMaquina(client, maquinaId, minutos) {
  if (minutos === undefined || minutos === null || minutos === '') return null;
  const n = Number(minutos);
  if (!Number.isInteger(n) || n <= 0) {
    return { error: 'El tiempo elegido no es válido.' };
  }
  const { rows } = await client.query(
    `SELECT mo.pregunta_tiempo,
            ARRAY_REMOVE(ARRAY[mo.minutos, mo.minutos_2, mo.minutos_3], NULL) AS tiempos
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

// Tope de precio por tamaño de carga (Ajustes): ninguna carga con tamaño
// puede rebasar su tope sumando lavadora + secadora + productos. El ajuste
// manual va aparte por decisión del negocio y NO cuenta contra el tope.
// Es tope duro para todos los roles (incluido admin); NULL en Ajustes =
// sin tope. Aplica SOLO a Servicio por Encargo (tipo de servicio POR_ENCARGO): el
// Autoservicio no captura tamaño y queda fuera; el filtro por tipo de servicio lo
// hace explícito además del tamaño. Se llama antes del COMMIT en cada ruta
// que pueda encarecer una carga (crear, editar, activar, asignar secadora).
// Devuelve el mensaje de error o null si todas las cargas caben.
async function validarTopesCargas(client, notaId) {
  const { rows } = await client.query(
    `SELECT nc.orden, nc.tamano, nc.tipo_prenda,
            UPPER(COALESCE(nc.tipo_prenda, '')) = 'EDREDON' AS es_edredon,
            nc.tamano_edredon,
            nc.precio_lavadora + nc.precio_secadora AS maquinas,
            -- Contra el tope cuenta lo que se SIRVE dentro del servicio: el
            -- granel líquido (por medida) y la bolsa. Lo que se vende por unidad
            -- —marca y polvo, que el cliente se lleva entero— se cobra aparte y
            -- no gasta del presupuesto del servicio.
            COALESCE(SUM(CASE WHEN a.se_vende_por_unidad THEN 0
                              ELSE np.cantidad * np.precio_unitario END), 0) AS productos,
            -- El tope congelado en la carga (mig. 096), que es su precio.
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
  // Lo que cuesta la máquina del servicio. Las notas del modelo de servicios no
  // guardan precio de máquina (lo que se cobra es el servicio), así que se
  // deduce de lo que le toca; las viejas sí lo traen y se respeta el suyo.
  const maquinasDe = (r) => {
    const guardado = Number(r.maquinas) || 0;
    return guardado > 0 ? guardado : costoMaquinasDeServicio(r.tipo_prenda, r.tamano, t);
  };

  // Primero el servicio concreto: decir cuál se pasó y por cuánto es lo que
  // deja arreglarlo.
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

  // Y después el techo de la NOTA: todo el material junto —el de cada servicio
  // más el que se agregó a la nota— contra la suma de lo que se cobra por los
  // servicios. Cuenta el granel y las bolsas, que es lo que se sirve dentro; los
  // de marca se venden por unidad y van por su cuenta. Sin esto se podían
  // servir $200 de jabón de bidón en una nota de $150 sin que nada avisara.
  //
  // Las máquinas que se cuentan son las de los SERVICIOS. Un renglón de máquina
  // —los que abre Salidas— no trae presupuesto propio y en Por Encargo va sin
  // cobro; sumar su tarifa aquí descontaría del bolsillo de los servicios algo
  // que no salió de ahí.
  const { rows: totales } = await client.query(
    `SELECT
       -- El AJUSTE de la nota entra en el presupuesto porque cambia lo que se
       -- cobra por esos servicios: un descuento de $20 deja $20 menos para
       -- pagar el mismo lavado, y un cargo extra da más aire.
       COALESCE((SELECT SUM(nc2.precio_tope) FROM nota_cargas nc2 WHERE nc2.nota_id = $1), 0)
         + n.ajuste AS presupuesto,
       COALESCE((SELECT SUM(np.cantidad * np.precio_unitario)
                   FROM nota_productos np
                   JOIN productos a ON a.id = np.producto_id
                  WHERE np.nota_id = $1 AND NOT a.se_vende_por_unidad), 0) AS material
       FROM notas n
      WHERE n.id = $1 AND n.tipo_servicio = 'POR_ENCARGO'`,
    [notaId]
  );
  const tot = totales[0];
  // El presupuesto se mira solo si hay servicios vendidos; un ajuste que lo deja
  // en 0 o menos se trata como cualquier otro exceso.
  const hayServicios = rows.some(r => r.tope != null);
  if (tot && hayServicios) {
    // Las máquinas de los SERVICIOS (las de `rows`, que son los que traen tope);
    // un renglón de máquina de Salidas no trae presupuesto propio ni cobra.
    const maquinas = rows.reduce((a, r) => a + (r.tope == null ? 0 : maquinasDe(r)), 0);
    const usado = maquinas + Number(tot.material);
    if (usado > Number(tot.presupuesto) + 1e-9) {
      return `El material de la nota suma ${fmt(usado)} y los servicios se cobran en ${fmt(tot.presupuesto)}. `
        + `Baja $${(usado - Number(tot.presupuesto)).toFixed(2)}: quita productos o sube el precio de los servicios en Ajustes.`;
    }
  }

  return null;
}

// Reserva un producto para una nota (o una carga): valida stock disponible,
// inserta la fila en nota_productos y aumenta stock_reservado. Lanza Error con
// el mensaje para el cliente si el producto no existe o no hay stock.
async function reservarProducto(client, notaId, cargaId, productoId, cantidad, sucursal, tipo_servicio) {
  const { rows: artRows } = await client.query(
    'SELECT * FROM productos WHERE id = $1 AND sucursal = $2 FOR UPDATE',
    [productoId, sucursal]
  );
  if (artRows.length === 0) {
    throw new Error(`Producto ${productoId} no encontrado.`);
  }
  const art = artRows[0];
  // Bolsas: por pieza (precio por pieza). Granel: la unidad la define el
  // servicio — botella (Autoservicio) o medida (Por Encargo). Los de marca van
  // siempre por unidad, también dentro de una carga de Por Encargo.
  const esBolsa = art.clase === 'bolsa';
  const unidad = esBolsa ? 'pieza' : unidadDeVenta(art, tipo_servicio);
  const tpu = esBolsa ? 1 : medidasPorUnidad(art, unidad);
  const precioUnit = esBolsa ? (Number(art.precio_unitario) || 0) : precioProductoEnNota(art, tipo_servicio);
  const cantidadMedidas = Number(cantidad) * tpu;
  const disponibleMedidas = Number(art.stock_actual) - Number(art.stock_reservado);
  if (disponibleMedidas < cantidadMedidas) {
    const dispUnidad = unidad === 'botella' ? Math.floor(disponibleMedidas / tpu) : disponibleMedidas;
    // Nombre y unidad legibles para el aviso (la bolsa incluye su tamaño).
    const nombreArt = esBolsa && art.tamano_bolsa ? `Bolsa ${art.tamano_bolsa}` : art.nombre;
    const uni = esBolsa ? 'bolsa(s)' : unidad === 'botella' ? 'botella(s)' : 'medida(s)';
    throw new Error(`No hay suficiente existencia de "${nombreArt}": quedan ${dispUnidad} ${uni} y se necesitan ${cantidad}. Carga más en Inventario o quítalo de la nota.`);
  }
  // Si el producto ya está en esta nota (y en la misma carga, si aplica) se le
  // suma la cantidad en vez de abrir otro renglón igual: así se puede pedir más
  // de lo mismo desde Salidas sin que la nota muestre el producto dos veces.
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
              cantidad_medidas = cantidad_medidas + $5,
              precio_unitario = $6
        WHERE nota_id = $1 AND producto_id = $3 AND carga_id IS NOT DISTINCT FROM $2
     RETURNING *`,
      [notaId, cargaId, productoId, cantidad, cantidadMedidas, precioUnit]
    );
    npRows.push(rows[0]);
  }
  await client.query(
    'UPDATE productos SET stock_reservado = stock_reservado + $1 WHERE id = $2',
    [cantidadMedidas, productoId]
  );
  return { ...npRows[0], nombre: art.nombre, subtotal: Number(npRows[0].cantidad) * Number(npRows[0].precio_unitario) };
}

// Libera el stock reservado de los productos de una nota y los elimina.
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

// Registra en el historial de inventario los movimientos de los productos de una
// nota: 'venta' cuando se consume el stock (pago/entrega) o 'liberacion' cuando
// se devuelve al anular una venta. Una fila por producto de la nota.
async function registrarMovimientosProductosNota(client, notaId, sucursal, usuarioId, tipo) {
  await client.query(
    `INSERT INTO producto_movimientos
       (producto_id, sucursal, usuario_id, tipo, destino, cantidad_medidas, descripcion, nota_id)
     SELECT np.producto_id, $2, $3, $4,
            (CASE WHEN a.clase = 'bolsa' THEN 'piezas' ELSE 'botellas' END),
            np.cantidad_medidas,
            np.cantidad || (CASE
                              WHEN np.unidad = 'pieza' THEN ' bolsa(s)'
                              WHEN np.unidad = 'botella'
                                THEN (CASE WHEN a.se_vende_por_unidad THEN ' unidad(es)' ELSE ' botella(s)' END)
                              ELSE ' medida(s)' END),
            np.nota_id
       FROM nota_productos np
       JOIN productos a ON a.id = np.producto_id
      WHERE np.nota_id = $1`,
    [notaId, sucursal, usuarioId ?? null, tipo]
  );
}

// Valida y tarifica las cargas recibidas en el body. Cada carga puede traer:
//   { lavadora_id, secadora_id, tipo_prenda, tipo_tela, tamano_edredon,
//     tamano, ajuste, productos: [{ producto_id, cantidad }] }
// (todo opcional salvo que el tipo de servicio lo exija). Devuelve las filas listas
// para insertar o lanza un Error con el mensaje para el cliente.
async function prepararCargas(client, cargas, tipoPrendaNota, sucursal, tipo_servicio, notaIdExcluir = null) {
  if (!Array.isArray(cargas) || cargas.length === 0) {
    throw new Error('cargas debe ser una lista con al menos una carga.');
  }
  if (cargas.length > 20) {
    throw new Error('Máximo 20 cargas por nota.');
  }
  // Por Encargo vende SERVICIOS: sus cargas no traen máquina, se les asigna en
  // Salidas sin que eso cambie el precio.
  //
  // AUTOSERVICIO sí trae máquina desde el alta otra vez (2026-09-29): ahí lo que
  // se cobra ES la máquina, y elegirla en dos pasos —el tipo al hacer la nota,
  // la física en Salidas— dejaba la nota en $0 hasta el segundo. Se elige de la
  // lista de libres, se tarifa aquí y queda asignada sin arrancar. Las notas
  // viejas que se quedaron a medias (tipo sin máquina) siguen entrando por el
  // camino del tipo, para no cambiarles el precio al editarlas.
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

    // Máquinas que OTRA nota abierta ya tiene apuntadas (2026-09-29). En
    // Autoservicio no se aceptan: la nota se cobra por esa máquina desde el
    // alta, y venderla dos veces deja a un cliente esperando a que el otro
    // termine. El formulario ya no las ofrece; esto lo sostiene cuando dos
    // mostradores capturan a la vez y la lista de uno se quedó vieja.
    // En Salidas sí se pueden asignar: ahí asignar no aparta y se la queda
    // quien inicie primero, con la ropa delante.
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

    // Por Encargo: la carga elige TIPO de máquina (no máquina física). El precio
    // se deriva del tipo; lavadora_id/secadora_id quedan NULL hasta asignar en
    // Salidas. La nota nace En Espera (activar=false, no hay máquina que iniciar).
    let lavadoraId = null, secadoraId = null, lavadoraTipo = null, secadoraTipo = null;
    let precioLavadora = 0, precioSecadora = 0, activar;
    if (esPorEncargo) {
      lavadoraTipo = c.lavadora_tipo ? String(c.lavadora_tipo).toLowerCase() : null;
      secadoraTipo = c.secadora_tipo ? String(c.secadora_tipo).toLowerCase() : null;
      if (lavadoraTipo && !TIPOS_MAQUINA_VALIDOS.includes(lavadoraTipo)) {
        throw new Error(`Tipo de lavadora inválido en la carga ${i + 1}.`);
      }
      if (secadoraTipo && !TIPOS_MAQUINA_VALIDOS.includes(secadoraTipo)) {
        throw new Error(`Tipo de secadora inválido en la carga ${i + 1}.`);
      }
      if (prendaCarga === 'EDREDON' && lavadoraTipo && lavadoraTipo !== 'jumbo') {
        throw new Error(`Los edredones solo van en lavadora jumbo (carga ${i + 1}).`);
      }
      // Por Encargo ya NO elige tipo de máquina: el servicio se vende por
      // tamaño (Chico, Mediano, Grande, Edredón) y la máquina —la que sea— se le asigna
      // en Salidas, sin que eso cambie el precio. Los tipos se siguen
      // aceptando porque las notas de antes los traen y editarlas los reenvía.
      // AUTOSERVICIO: la máquina FÍSICA que eligió el mostrador (2026-09-29).
      // Se valida como en Salidas —que sea del hueco que dice ser y que esté
      // libre— y se tarifa con la tarifa de esa máquina, que es la que el
      // formulario ya le enseñó al cliente en el resumen. Queda asignada, NO
      // arrancada: la inicia una persona desde Salidas.
      if (tipo_servicio === 'AUTOSERVICIO') {
        lavadoraId = c.lavadora_id ? Number(c.lavadora_id) : null;
        secadoraId = c.secadora_id ? Number(c.secadora_id) : null;
        if (lavadoraId && tipoPorId.get(lavadoraId) === 'secadora') {
          throw new Error(`La máquina de lavado de la máquina ${i + 1} es una secadora.`);
        }
        if (secadoraId && tipoPorId.get(secadoraId) !== 'secadora') {
          throw new Error(`La máquina de secado de la máquina ${i + 1} no es una secadora.`);
        }
        // Libre ahora mismo: entre que se abrió el formulario y se guardó la
        // nota, otro compañero pudo haber arrancado esa máquina.
        for (const mid of [lavadoraId, secadoraId].filter(Boolean)) {
          const m = estadoPorId.get(mid);
          if (m && m.estado !== 'disponible') {
            throw new Error(`La máquina ${m.nombre} ya no está disponible. Elige otra.`);
          }
        }
        // El tipo se deriva de la máquina puesta: es lo que la nota pidió, y de
        // ahí sale el desglose del ticket y el trabajo pendiente de la nota.
        // Un edredón no cabe en una mediana: es física, no tarifa.
        if (prendaCarga === 'EDREDON' && lavadoraId && tipoPorId.get(lavadoraId) !== 'lavadora_jumbo') {
          throw new Error(`Los edredones solo van en lavadora jumbo (máquina ${i + 1}).`);
        }
        if (lavadoraId) lavadoraTipo = tipoPorId.get(lavadoraId) === 'lavadora_jumbo' ? 'jumbo' : 'mediana';
        if (secadoraId) secadoraTipo = 'mediana';
      }
      // Una máquina de autoservicio sin nada puesto no cobraría nada: ahí lo
      // que se cobra ES la máquina.
      if (tipo_servicio === 'AUTOSERVICIO' && !lavadoraId && !secadoraId && !lavadoraTipo && !secadoraTipo) {
        throw new Error(`La máquina ${i + 1} necesita ser una lavadora o una secadora.`);
      }
      // Con máquina puesta se tarifa AL CREAR, con la tarifa de esa máquina.
      // Sin ella —la nota vieja que se quedó en TIPO— se mantiene lo de antes:
      // vale $0 hasta que se le asigne la física en Salidas (2026-09-25). Por
      // Encargo se tarifa siempre aquí, porque lo que cobra es el precio del
      // servicio y no depende de qué máquina le toque.
      const tarifaAlCrear = tipo_servicio !== 'AUTOSERVICIO' || Boolean(lavadoraId || secadoraId);
      if (lavadoraTipo && tarifaAlCrear) {
        precioLavadora = lavadoraId
          ? tarifaLavadora(tipoPorId.get(lavadoraId), prendaCarga, t)
          : tarifaLavadora(lavadoraTipo === 'jumbo' ? 'lavadora_jumbo' : 'lavadora_mediana', prendaCarga, t);
      }
      if (secadoraTipo && tarifaAlCrear) {
        precioSecadora = tarifaSecadora(secadoraId ? tamanoPorId.get(secadoraId) : secadoraTipo, prendaCarga, t);
      }
      activar = false;
    } else {
      // Servicio legado EDREDON: es el único que sigue eligiendo la máquina
      // física al crear la nota (Autoservicio y Por Encargo eligen tipo y la
      // asignan después en Salidas).
      lavadoraId = c.lavadora_id ? Number(c.lavadora_id) : null;
      secadoraId = c.secadora_id ? Number(c.secadora_id) : null;
      if (lavadoraId && tipoPorId.get(lavadoraId) === 'secadora') {
        throw new Error(`La máquina de lavado de la carga ${i + 1} es una secadora.`);
      }
      if (secadoraId && tipoPorId.get(secadoraId) !== 'secadora') {
        throw new Error(`La máquina de secado de la carga ${i + 1} no es una secadora.`);
      }
      if (prendaCarga === 'EDREDON' && lavadoraId && tipoPorId.get(lavadoraId) !== 'lavadora_jumbo') {
        throw new Error(`Los edredones solo van en lavadora jumbo (carga ${i + 1}).`);
      }
      precioLavadora = lavadoraId ? tarifaLavadora(tipoPorId.get(lavadoraId), prendaCarga, t) : 0;
      precioSecadora = secadoraId ? tarifaSecadora(tamanoPorId.get(secadoraId), prendaCarga, t) : 0;
      // Autoservicio arranca de inmediato; cada carga puede decidir con `activar`.
      activar = c.activar !== false;
    }

    // Precio del servicio Por Encargo. Sale de Ajustes y se congela en la
    // carga (mig. 096). Desde el rediseño del alta ya no es un tope contra el
    // que se compara lo que lleva la carga: ES lo que se cobra, así que un
    // servicio de los que hoy se venden sin precio configurado no se acepta
    // —la nota quedaría en $0 sin que nadie se diera cuenta—.
    // Las cargas viejas sin tamaño no entran en esa regla: nacieron cobrando la
    // suma de sus máquinas y editar su nota no debe volverse imposible.
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
      tipo_prenda:     c.tipo_prenda ? prendaCarga : null,
      tipo_tela:       prendaCarga === 'ROPA' && c.tipo_tela ? String(c.tipo_tela).trim() : null,
      tamano_edredon:  tamanoEdredon,
      tamano:          tamanoCarga,
      ajuste:          ajusteCarga,
      // Se congela aquí (mig. 096): editar las cargas de una nota las vuelve a
      // tarifar con los precios de hoy, igual que a sus máquinas.
      precio_tope:     precioTope,
      activar,
      productos,
      // Medidas de cada tipo de granel que se capturaron al crear la nota; sin
      // ellas, las de Ajustes (ver granelDeCarga).
      granel:          tipo_servicio === 'POR_ENCARGO' ? leerGranelDeCarga(c.granel, i) : null,
    };
  });
}

// Medidas de cada tipo de granel que trae una carga desde la pantalla:
// [{ tipo_granel_id, cantidad }]. Devuelve un Map tipo → medidas (0 = no lleva
// de ese tipo), o null si no vino nada y mandan las de Ajustes.
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

// Historial de máquinas de una carga (mig. 114): UNA FILA POR PASADA.
//
// `nota_cargas` solo guarda la máquina actual de cada hueco y la última usada,
// así que una carga que repite —relavar, secar de más— perdía la pasada
// anterior, y dos pasadas en la MISMA máquina eran indistinguibles de una. El
// nombre y el tipo se copian: la máquina se puede renombrar o borrar, y una
// nota vieja tiene que seguir diciendo en qué se lavó.
//
// Se llama SIEMPRE ANTES del UPDATE que pone la máquina en la carga: así el
// hueco todavía tiene lo de antes y se puede distinguir una pasada nueva (el
// hueco estaba libre) de volver a escribir lo mismo.
//
//   modo 'pasada'   → una vuelta más de esta carga: fila nueva.
//   modo 'reemplazo'→ corregir la máquina de la pasada en curso (cambiar
//                     máquina): se pisa la última fila, no se agrega otra.
//
// `cicloUnico` (mig. 115) marca la vuelta que corre UN solo ciclo aunque la
// marca de la máquina dé para dos: es la que se agrega desde Salidas, va sin
// cobro y no debe encadenar otra vuelta encima.
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

  await client.query(
    `INSERT INTO nota_carga_maquinas
       (carga_id, slot, maquina_id, maquina_nombre, maquina_tipo, maquina_tamano, ciclo_unico)
     VALUES ($1, $2, $3, $4, $5, $6, $7)`,
    [cargaId, slot, m.id, m.nombre, m.tipo, m.tamano, cicloUnico]
  );
}

// ── Granel por elegir de un servicio Por Encargo (migs. 132-134) ──────────
// La clave con que el granel se liga a un servicio ('chico'… 'edredon'). Todos
// los tamaños de edredón comparten la suya.
function claveLigueServicio(prenda, tamano) {
  if (String(prenda ?? '').toUpperCase() === 'EDREDON') return 'edredon';
  return ['chico', 'mediano', 'grande'].includes(tamano) ? tamano : null;
}

// Cuántas medidas de CADA tipo de granel trae el servicio (Ajustes → Servicios
// Por Encargo). El edredón lo dice su tamaño; uno viejo sin tamaño, nada.
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

// Opciones de granel de un servicio, por tipo: los graneles líquidos de la
// sucursal con tipo (se elige en el producto, mig. 136). Sirven para cualquier
// servicio (mig. 135).
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

// Lo que lleva de granel un servicio recién creado: por cada tipo, N medidas.
// Si el tipo tiene un solo producto y alcanza, entra directo (no hay nada que
// elegir); si no, queda pendiente y el empleado lo elige en Salidas. Que no
// alcance no impide crear la nota: el aviso lo da la pantalla.
// `capturado` son las medidas que se pusieron al crear la nota (Map tipo →
// medidas); el tipo que no venga ahí lleva las de Ajustes.
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

// Ninguna lavadora de la nota arranca mientras algún servicio tenga granel por
// elegir (decisión del negocio, 2026-10-02): el empleado elige en Salidas qué
// jabón y qué suavizante usa, y sin eso no se sabe qué descontar. Es la nota
// entera y no "la lavadora de ese servicio" porque en Por Encargo las máquinas
// se agregan sueltas en Salidas, sin decir a qué servicio van. Devuelve el
// mensaje que lo explica, o null si nada lo impide. Las secadoras no cuentan:
// el granel se sirve al lavar.
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

// Inserta las filas de nota_cargas ya preparadas (con sus productos, que
// reservan stock). Devuelve las cargas con sus productos. En Por Encargo, además,
// el granel que lleva cada servicio (granelDeCarga).
async function insertarCargas(client, notaId, filas, sucursal, tipo_servicio) {
  const insertadas = [];
  for (const f of filas) {
    const { rows } = await client.query(
      `INSERT INTO nota_cargas
         (nota_id, orden, lavadora_id, secadora_id, lavadora_usada_id, secadora_usada_id,
          lavadora_tipo, secadora_tipo, precio_lavadora, precio_secadora,
          tipo_prenda, tipo_tela, tamano_edredon, tamano, ajuste, precio_tope)
       VALUES ($1, $2, $3, $4, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14) RETURNING *`,
      [notaId, f.orden, f.lavadora_id, f.secadora_id, f.lavadora_tipo, f.secadora_tipo,
       f.precio_lavadora, f.precio_secadora,
       f.tipo_prenda, f.tipo_tela, f.tamano_edredon, f.tamano, f.ajuste,
       f.precio_tope ?? null]
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

// Cargas de una nota con los datos de sus máquinas y sus productos (detalle).
async function cargasDeNota(client, notaId) {
  const { rows } = await client.query(
    `SELECT nc.id, nc.orden, nc.lavadora_id, nc.secadora_id,
            nc.precio_lavadora, nc.precio_secadora, nc.es_adicional,
            nc.tipo_prenda, nc.tipo_tela, nc.tamano_edredon, nc.tamano, nc.ajuste,
            -- Cuándo arrancó cada hueco: una carga que ya pasó por la máquina es
            -- historial y no se puede quitar, y con esto la pantalla lo sabe sin
            -- adivinarlo por el estado de la máquina (2026-09-25).
            nc.lavadora_iniciada_at, nc.secadora_iniciada_at,
            nc.lavadora_tipo AS lavadora_tipo_previsto,
            nc.secadora_tipo AS secadora_tipo_previsto,
            ml.nombre AS lavadora_nombre, ml.tipo AS lavadora_tipo, ml.estado AS lavadora_estado,
            ml.en_uso_desde AS lavadora_en_uso_desde,
            -- Encendida por ESTA nota y todavía sin arrancar (mig. 110): es lo
            -- que hace que el botón diga "Iniciar" en vez de "Encender".
            (ml.estado = 'en_uso' AND ml.en_uso_desde IS NULL
             AND ml.encendida_para_nota_id = nc.nota_id) AS lavadora_esperando_arranque,
            ms.nombre AS secadora_nombre, ms.tipo AS secadora_tipo, ms.estado AS secadora_estado,
            ms.tamano AS secadora_tamano, ms.en_uso_desde AS secadora_en_uso_desde,
            (ms.estado = 'en_uso' AND ms.en_uso_desde IS NULL
             AND ms.encendida_para_nota_id = nc.nota_id) AS secadora_esperando_arranque,
            nc.lavadora_usada_id, nc.secadora_usada_id,
            mlu.nombre AS lavadora_usada_nombre, mlu.tipo AS lavadora_usada_tipo,
            msu.nombre AS secadora_usada_nombre, msu.tipo AS secadora_usada_tipo,
            msu.tamano AS secadora_usada_tamano,
            -- Tope CONGELADO de la carga (mig. 096). En Por Encargo el tope ES
            -- el precio que se cobra por la carga, y es el que ve el ticket;
            -- NULL = sin tope, la carga se cobra por lo que lleva dentro.
            nc.precio_tope AS tope_carga,
            -- Historial de máquinas de la carga, en orden de uso (mig. 114):
            -- una entrada por PASADA, así que la misma máquina puede aparecer
            -- dos veces. La bandera actual marca la que el hueco tiene hoy —la
            -- que se puede encender o terminar—; las demás ya pasaron.
            (SELECT COALESCE(json_agg(x ORDER BY x.asignada_at, x.id), '[]'::json)
               FROM (
                 SELECT ncm.id, ncm.slot, ncm.maquina_id, ncm.asignada_at,
                        ncm.maquina_nombre AS nombre, ncm.maquina_tipo AS tipo,
                        ncm.maquina_tamano AS tamano,
                        -- Los tiempos que ofrece su modelo (mig. 120): con
                        -- ellos la pantalla sabe si al iniciarla hay que
                        -- preguntar con cuál correr.
                        (SELECT json_build_object(
                                  'pregunta', mo.pregunta_tiempo,
                                  'minutos', ARRAY_REMOVE(ARRAY[mo.minutos, mo.minutos_2, mo.minutos_3], NULL))
                           FROM maquinas mm2
                           JOIN marcas_maquina mmk ON mmk.nombre = mm2.marca
                           JOIN modelos_maquina mo ON mo.marca_id = mmk.id AND mo.nombre = mm2.modelo
                          WHERE mm2.id = ncm.maquina_id) AS modelo_tiempos,
                        -- Cómo se comporta: la MARCA dice si arranca sola al
                        -- recibir corriente —y entonces Salidas ofrece "Iniciar"
                        -- en un solo paso (mig. 122)— y el MODELO si la carga
                        -- corre dos ciclos (mig. 123).
                        (SELECT json_build_object(
                                  'arranca_sola', mmk2.arranca_sola,
                                  'dos_ciclos', COALESCE((
                                    SELECT mo2.dos_ciclos FROM modelos_maquina mo2
                                     WHERE mo2.marca_id = mmk2.id AND mo2.nombre = mm3.modelo
                                  ), FALSE))
                           FROM maquinas mm3
                           JOIN marcas_maquina mmk2 ON mmk2.nombre = mm3.marca
                          WHERE mm3.id = ncm.maquina_id) AS marca_opciones,
                        -- Cronómetro en vez de temporizador (2026-10-02). Va
                        -- aparte de la marca: también aplica a la máquina que
                        -- no tiene marca de catálogo.
                        (SELECT ${esCronometroSql('mm4')} FROM maquinas mm4
                          WHERE mm4.id = ncm.maquina_id) AS cronometro,
                        -- Actual = la ÚLTIMA pasada del hueco, y solo si esa
                        -- máquina sigue puesta. Con la comparación a secas, una
                        -- carga relavada en la misma lavadora marcaba las dos.
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
  // Granel por elegir de cada servicio (mig. 134): "1 medida de Jabón".
  const { rows: pendientes } = await client.query(
    `SELECT pe.id, pe.carga_id, pe.tipo_granel_id, t.nombre AS tipo_granel, pe.cantidad
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

// Verifica que un registro exista y pertenezca a la sucursal indicada.
// Solo se llama con nombres de tabla constantes (clientes / maquinas).
async function perteneceASucursal(tabla, id, sucursal) {
  const { rows } = await pool.query(
    `SELECT 1 FROM ${tabla} WHERE id = $1 AND sucursal = $2`,
    [id, sucursal]
  );
  return rows.length > 0;
}

// Deja rastro en la campana del Dashboard cuando se revierte un pago
// (PAGADO → PENDIENTE): es el vector directo para desaparecer una venta,
// así que siempre queda registrado quién lo hizo y en qué nota.
// `abonos` son los que la reversión echó atrás: van en el aviso porque es el
// dinero que sale del corte, que es justo lo que se revisa después.
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

// Deja rastro en la campana del Dashboard cuando se cancela una nota: es una
// acción fuerte (libera stock y máquinas), así que siempre queda registrado
// quién la canceló y qué nota fue.
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

// Deja rastro en la campana del Dashboard cuando se elimina una nota: borra el
// registro por completo, así que siempre queda constancia de quién la eliminó y
// qué nota era.
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

// ── GET /notas/next-folio ───────────────────────────────────
export const getNextFolio = async (req, res) => {
  try {
    const { rows } = await pool.query(
      'SELECT COALESCE(MAX(id), 0) + 1 AS next_id FROM notas'
    );
    const folio = generarFolio(rows[0].next_id, new Date());
    res.json({ folio });
  } catch (err) {
    console.error('getNextFolio error:', err);
    res.status(500).json({ message: 'No se pudo obtener el siguiente folio. Intenta de nuevo.' });
  }
};

// ── GET /notas ──────────────────────────────────────────────
export const getNotas = async (req, res) => {
  try {
    const { rows } = await pool.query(
      `SELECT n.*,
              c.nombre   AS cliente_nombre,
              c.apellido AS cliente_apellido,
              c.telefono AS cliente_telefono,
              TRIM(u.nombre || ' ' || COALESCE(u.apellido, '')) AS usuario_nombre,
              su.nombre  AS sucursal_nombre,
              su.direccion AS sucursal_direccion,
              (SELECT COALESCE(json_agg(DISTINCT x.mid), '[]'::json)
                 FROM (${SQL_MAQUINAS_DE_NOTA}) x
                WHERE x.mid IS NOT NULL) AS maquinas_ids,
              -- Nombres de todas las máquinas que la nota usa o usó: además de
              -- las vinculadas, incluye las columnas *_usada_id de las cargas,
              -- que conservan la máquina aunque ya se haya desvinculado (p. ej.
              -- tras pasar el lavado a la secadora).
              (SELECT COALESCE(json_agg(mm.nombre ORDER BY mm.nombre), '[]'::json)
                 FROM (
                   SELECT nc.lavadora_id       AS mid FROM nota_cargas nc WHERE nc.nota_id = n.id
                   UNION SELECT nc.secadora_id        FROM nota_cargas nc WHERE nc.nota_id = n.id
                   UNION SELECT nc.lavadora_usada_id  FROM nota_cargas nc WHERE nc.nota_id = n.id
                   UNION SELECT nc.secadora_usada_id  FROM nota_cargas nc WHERE nc.nota_id = n.id
                 ) xm
                 JOIN maquinas mm ON mm.id = xm.mid) AS maquinas_nombres,
              -- Fases vivas de la nota: si tiene lavadora(s) y/o secadora(s)
              -- realmente EN USO ahora mismo (no solo asignadas: una máquina
              -- asignada pero sin iniciar no cuenta). Con varias cargas puede
              -- tener ambas a la vez (una lavando, otra secando).
              EXISTS (SELECT 1 FROM nota_cargas nc JOIN maquinas ml ON ml.id = nc.lavadora_id
                       WHERE nc.nota_id = n.id AND ml.estado = 'en_uso'
                         AND nc.lavadora_iniciada_at IS NOT NULL) AS hay_lavadora_activa,
              EXISTS (SELECT 1 FROM nota_cargas nc JOIN maquinas ms ON ms.id = nc.secadora_id
                       WHERE nc.nota_id = n.id AND ms.estado = 'en_uso'
                         AND nc.secadora_iniciada_at IS NOT NULL) AS hay_secadora_activa,
              -- Lavadoras que al terminar su lavado encadenan el secado: la
              -- tarjeta pide elegir secadora ahí mismo ("Iniciar secado") en vez
              -- de cerrar la carga. Solo pasa en AUTOSERVICIO, donde el cliente
              -- está esperando su ropa y el encargado la pasa de una máquina a
              -- la otra en el momento. En Por Encargo la ropa se queda en el
              -- local: su lavadora termina la carga y la secadora se asigna y se
              -- arranca aparte, desde Salidas, con su propio botón (2026-09-22).
              -- Si la carga YA tiene secadora asignada tampoco entra aquí: no
              -- hay nada que elegir.
              (SELECT COALESCE(json_agg(nc.lavadora_id), '[]'::json)
                 FROM nota_cargas nc
                WHERE nc.nota_id = n.id
                  AND n.tipo_servicio = 'AUTOSERVICIO'
                  AND nc.lavadora_id IS NOT NULL
                  AND nc.secadora_tipo IS NOT NULL
                  AND nc.secadora_id IS NULL
              ) AS lavadoras_con_secado_ids,
              -- ¿A la nota le queda trabajo que NO está corriendo ahora mismo?
              -- Es la parte de hayCargasPendientes que sobrevive a cerrar la
              -- máquina que está en marcha, y son dos casos:
              --
              --   · una máquina que la carga compró y todavía no tiene puesta;
              --   · una máquina YA PUESTA que nadie ha arrancado — desde que
              --     la secadora se asigna desde el principio (2026-09-22) este
              --     es el caso normal, y mirarlo solo por "falta asignar"
              --     prometía "Por Entregar" en notas que se quedaban En Espera.
              --
              -- La máquina que se está cerrando no cuenta: esa ya arrancó.
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
                     -- Máquina PUESTA que no está corriendo: puede no haber
                     -- arrancado nunca, estar encendida esperando el arranque
                     -- (mig. 110) o haberse detenido a media vuelta. En los
                     -- tres casos queda trabajo. Mirar iniciada_at no basta:
                     -- un ciclo detenido la deja marcada como iniciada.
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
       ORDER BY n.created_at DESC`,
      [req.sucursal]
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
              -- ¿Todavía se puede corregir la forma de pago? Solo mientras la
              -- caja donde se cobró siga ABIERTA: ahí el corte se calcula en
              -- vivo y se corrige solo. Con la caja cerrada las cifras quedaron
              -- congeladas (mig. 101) y cambiar la forma dejaría el corte y
              -- Ventas diciendo cosas distintas, así que no se permite.
              (n.estado_pago = 'PAGADO' AND n.estado <> 'CANCELADA' AND EXISTS (
                 SELECT 1 FROM cajas cj WHERE cj.id = n.caja_id AND cj.estado = 'abierta'
              )) AS forma_pago_editable,
              -- ¿Se puede revertir el cobro? Mismo razonamiento, con una
              -- excepción: un cobro hecho SIN caja abierta (caja_id NULL) no
              -- entró en ningún corte, así que revertirlo no descuadra nada.
              -- Lo que no se permite es revertir un cobro que ya quedó
              -- congelado en un corte cerrado: ese corte seguiría contando la
              -- venta y, al volver a cobrar la nota, el mismo dinero caería
              -- también en la caja de hoy.
              (n.estado_pago = 'PAGADO' AND n.estado <> 'CANCELADA' AND (
                 n.caja_id IS NULL
                 OR EXISTS (SELECT 1 FROM cajas cj WHERE cj.id = n.caja_id AND cj.estado = 'abierta')
              )) AS pago_reversible,
              -- ¿El cobro de esta nota quedó congelado en un corte cerrado?
              -- Entonces NADA que mueva su total se puede hacer (ver
              -- CorteCerradoError): la pantalla lo usa para no ofrecer acciones
              -- que van a terminar en 409 al confirmar (2026-09-22).
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

    // Correcciones de forma de pago (mig. 102): es dinero que se movió entre
    // columnas del corte, así que el detalle enseña quién y cuándo.
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

    // Abonos (mig. 121): pagos parciales de la nota. Los revertidos se enseñan
    // igual —el rastro importa— pero no suman.
    const { rows: abonos } = await pool.query(
      `SELECT ab.id, ab.monto, ab.forma_pago, ab.created_at, ab.caja_id,
              ab.revertido_at, ab.motivo_reversion,
              TRIM(u.nombre || ' ' || COALESCE(u.apellido, '')) AS usuario_nombre,
              -- Solo se revierte mientras la caja de ESE abono siga abierta: con
              -- el corte cerrado sus cifras ya quedaron congeladas (mig. 101).
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
      // Lo que falta por cobrar. Una nota ya pagada no debe nada.
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
    tamano,
    tipo_tela,
    tamano_edredon,
    ajuste = 0,
    cargas,         // [{ lavadora_id, secadora_id, activar, ... }] por carga
    insumos   = [], // [{ insumo_id, cantidad }]  → movimientos_insumos
    productos = [], // [{ producto_id, cantidad }] → nota_productos
  } = req.body;

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
  // Por Encargo SÍ puede venir sin cliente: es la nota de mostrador, la del que
  // deja ropa de paso y no se registra (2026-09-29). Antes esto era un 400
  // —"las notas Por Encargo llevan cliente"— y la única salida era dar de alta
  // un cliente que nadie iba a volver a usar. Sin cliente la nota queda a
  // nombre de Mostrador y el teléfono, si hace falta mandarle el ticket o el
  // aviso, se captura a nivel nota (PATCH /notas/:id/telefono). El formulario
  // no manda un null por descuido: obliga a elegir entre un cliente y
  // Mostrador antes de dejar avanzar.
  // La venta de mostrador no lava nada: no lleva cargas y lo que la justifica
  // son sus productos. Es de mostrador como el autoservicio —el que viene a comprar
  // un jabón no se identifica—, así que tampoco lleva cliente.
  if (esVenta(tipo_servicio)) {
    if (Array.isArray(cargas) && cargas.length > 0) {
      return res.status(400).json({ message: 'Una venta de productos no lleva cargas: no hay lavado ni secado que cobrar.' });
    }
    if (!Array.isArray(productos) || productos.length === 0) {
      return res.status(400).json({ message: 'Agrega al menos un producto: una venta sin productos no es nota.' });
    }
    // Se cobra en el acto, como en el mostrador de cualquier tienda: la nota
    // nace pagada y finalizada, así que no hay un "después" donde cobrarla.
    if (estado_pago !== 'PAGADO' || !normalizarFormaPago(forma_pago)) {
      return res.status(400).json({
        message: `La venta de productos se cobra al momento: indica la forma de pago (${enPalabras(FORMAS_PAGO_VALIDAS)}).`,
      });
    }
  } else if (!Array.isArray(cargas) || cargas.length === 0) {
    // Modelo por cargas: toda nota de lavado trae sus cargas, cada una con sus
    // máquinas y —en encargo— su prenda, tela/tamaño, ajuste y productos.
    return res.status(400).json({ message: 'La nota necesita al menos una carga.' });
  }
  if (tiempo_entrega && !TIEMPOS_ENTREGA_VALIDOS.includes(String(tiempo_entrega).toUpperCase())) {
    return res.status(400).json({
      message: `Elige cuándo se entrega: ${enPalabras(TIEMPOS_ENTREGA_VALIDOS)}.`,
    });
  }
  // El ajuste puede ser negativo (descuento); el total final de la nota no,
  // lo que se verifica antes del COMMIT ya con los productos sumados.
  if (ajuste != null && ajuste !== '' && !Number.isFinite(Number(ajuste))) {
    return res.status(400).json({ message: 'El ajuste debe ser un número.' });
  }

  // El cliente referenciado debe pertenecer a la sucursal activa (las máquinas
  // se validan por carga en prepararCargas).
  if (cliente_id && !(await perteneceASucursal('clientes', cliente_id, req.sucursal))) {
    return res.status(400).json({ message: 'El cliente seleccionado no existe en esta sucursal.' });
  }

  const ajusteNum = Number(ajuste) || 0;

  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    // Se validan y tarifican las cargas primero; de ellas sale el total. La
    // venta de mostrador no tiene: su total son solo los productos.
    let filasCargas;
    try {
      filasCargas = esVenta(tipo_servicio)
        ? []
        : await prepararCargas(client, cargas, tipo_prenda, req.sucursal, tipo_servicio);
    } catch (e) {
      await client.query('ROLLBACK');
      return res.status(400).json({ message: e.message });
    }
    // Cada carga (Autoservicio y Por Encargo) exige al menos un tipo de lavado o
    // secado; eso lo valida prepararCargas. Aquí ya no se exige máquina física.
    const cargasSum = filasCargas.reduce((s, f) => s + f.precio_lavadora + f.precio_secadora, 0);

    // Ninguna máquina de la nota puede estar ya apartada por otra nota abierta
    // (aunque nazca En Espera). Se bloquean las filas y se valida para que dos
    // notas no tomen la misma máquina.
    const idsMaquinasNota = [...new Set(filasCargas.flatMap(f => [f.lavadora_id, f.secadora_id]).filter(Boolean))];

    // Máquinas a tomar al crear: solo las de las cargas que se activan. Si
    // ninguna se activa, la nota nace En Espera (las máquinas quedan asignadas
    // pero libres, para activarse luego desde Salidas).
    const idsActivar = [...new Set(filasCargas.filter(f => f.activar).flatMap(f => [f.lavadora_id, f.secadora_id]).filter(Boolean))];
    // La venta se entrega en el mostrador en el mismo acto en que se cobra: no
    // hay nada que esperar ni que entregar después, así que nace FINALIZADA.
    const estadoNota = esVenta(tipo_servicio)
      ? 'FINALIZADA'
      : idsActivar.length > 0
        ? (filasCargas.some(f => f.activar && f.lavadora_id) ? 'LAVANDO' : 'SECANDO')
        : 'EN_ESPERA';

    const { rows: notaRows } = await client.query(
      `INSERT INTO notas
         (cliente_id, usuario_id, tipo_servicio, tipo_prenda, estado, estado_pago, sucursal,
          peso_kg, precio_total, fecha_entrega, tiempo_entrega, instrucciones,
          tamano, tipo_tela, tamano_edredon, ajuste, forma_pago)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17)
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
        // Forma de pago solo con pago anticipado (PAGADO); si no, null.
        estado_pago === 'PAGADO' ? normalizarFormaPago(forma_pago) : null,
      ]
    );
    const nota = notaRows[0];

    const folio = generarFolio(nota.id, nota.created_at);
    await client.query('UPDATE notas SET folio = $1 WHERE id = $2', [folio, nota.id]);
    nota.folio = folio;

    // Insertar las cargas y tomar las máquinas de las cargas activadas. Reservar
    // los productos de una carga puede fallar (p. ej. sin existencia de una bolsa):
    // se responde con el mensaje claro (400), no un 500.
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

    // ── Insertar productos en nota_productos ────────────────
    // (nivel nota, carga_id NULL). La unidad/precio/medidas los resuelve
    // reservarProducto según el servicio (botella en Autoservicio, medida en Por Encargo).
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

    // Recalcular precio_total con la fórmula completa (cargas + productos + ajuste).
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

    // La venta nace finalizada: el producto se lo lleva el cliente ahora mismo,
    // así que sale del inventario aquí y no se queda reservado. Es lo mismo que
    // hace cerrarNotaSinCargasPendientes cuando una nota de autoservicio se
    // cierra sola, y lo que haría cambiarEstadoNota al cobrar.
    if (esVenta(tipo_servicio)) {
      await registrarMovimientosProductosNota(client, nota.id, req.sucursal, req.user.id, 'venta');
      await client.query(
        `UPDATE productos a
            SET stock_actual    = stock_actual    - np.cantidad_medidas,
                stock_reservado = stock_reservado - np.cantidad_medidas
          FROM nota_productos np
          WHERE np.nota_id = $1 AND np.producto_id = a.id`,
        [nota.id]
      );
    }

    await client.query('COMMIT');
    res.status(201).json({ ...nota, cargas: cargasInsertadas, productos: productosInsertados });
  } catch (err) {
    await client.query('ROLLBACK');
    console.error('createNota error:', err);
    if (err.code === '23503') {
      return res.status(400).json({ message: 'El cliente o la máquina seleccionada no existe en esta sucursal.' });
    }
    res.status(500).json({ message: 'No se pudo crear la nota. Intenta de nuevo.' });
  } finally {
    client.release();
  }
};

// ── PATCH /notas/:id ────────────────────────────────────────
export const updateNota = async (req, res) => {
  const { id } = req.params;
  const {
    cliente_id,
    estado_pago,
    forma_pago,
    fecha_entrega,
    tiempo_entrega,
    instrucciones,
    tamano,
    tipo_prenda,
    tipo_tela,
    tamano_edredon,
    ajuste,
    cargas,
    productos,
  } = req.body;

  if (productos !== undefined && !Array.isArray(productos)) {
    return res.status(400).json({ message: 'No se recibieron bien los productos de la nota.' });
  }
  if (cargas !== undefined && (!Array.isArray(cargas) || cargas.length === 0)) {
    return res.status(400).json({ message: 'La nota necesita al menos una carga.' });
  }
  if (ajuste != null && ajuste !== '' && !Number.isFinite(Number(ajuste))) {
    return res.status(400).json({ message: 'El ajuste debe ser un número.' });
  }
  if (estado_pago && !ESTADOS_PAGO_VALIDOS.includes(estado_pago)) {
    return res.status(400).json({
      message: `Indica si la nota queda ${enPalabras(ESTADOS_PAGO_VALIDOS)}.`,
    });
  }
  if (tamano && !TAMANOS_VALIDOS.includes(String(tamano).toLowerCase())) {
    return res.status(400).json({
      message: `Elige un tamaño de carga válido: ${enPalabras(TAMANOS_VALIDOS)}.`,
    });
  }
  if (tipo_prenda && !TIPOS_PRENDA_VALIDOS.includes(String(tipo_prenda).toUpperCase())) {
    return res.status(400).json({
      message: `Elige qué se recibe: ${enPalabras(TIPOS_PRENDA_VALIDOS)}.`,
    });
  }
  if (tiempo_entrega && !TIEMPOS_ENTREGA_VALIDOS.includes(String(tiempo_entrega).toUpperCase())) {
    return res.status(400).json({
      message: `Elige cuándo se entrega: ${enPalabras(TIEMPOS_ENTREGA_VALIDOS)}.`,
    });
  }

  // El cliente referenciado debe pertenecer a la sucursal activa (las máquinas
  // se validan por carga en prepararCargas).
  if (cliente_id && !(await perteneceASucursal('clientes', cliente_id, req.sucursal))) {
    return res.status(400).json({ message: 'El cliente seleccionado no existe en esta sucursal.' });
  }

  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    const { rows: currentRows } = await client.query(
      'SELECT * FROM notas WHERE id = $1 AND sucursal = $2 FOR UPDATE',
      [id, req.sucursal]
    );
    if (currentRows.length === 0) {
      await client.query('ROLLBACK');
      return res.status(404).json({ message: 'Nota no encontrada.' });
    }
    const actual = currentRows[0];

    if (['PAGADA', 'FINALIZADA', 'CANCELADA'].includes(actual.estado)) {
      await client.query('ROLLBACK');
      return res.status(400).json({
        message: `No se puede editar una nota ${palabra(actual.estado)}.`,
      });
    }

    // Deshacer un cobro NO se hace desde aquí (2026-09-22). Editar la nota es
    // para corregir lo que la nota dice; descobrar es una decisión de dinero y
    // tiene su propia puerta —"Revertir pago" en el detalle—, que exige motivo
    // y solo funciona con la caja de ese cobro abierta. Tenerlo en dos sitios
    // obligaba a escribir la misma regla dos veces, y la de aquí ya se había
    // quedado corta: revertía sin motivo.
    const esReversionPago = estado_pago === 'PENDIENTE' && actual.estado_pago === 'PAGADO';
    if (esReversionPago) {
      await client.query('ROLLBACK');
      return res.status(409).json({
        message: 'El cobro de esta nota no se deshace desde la edición. Usa "Revertir pago" '
               + 'en el detalle de la nota, que pide el motivo y lo deja anotado.',
      });
    }

    // Cobrar desde la edición exige la forma de pago igual que el endpoint
    // dedicado; si no, la nota quedaría cobrada sin saber si el dinero entró
    // al cajón. Editar una nota YA pagada sin mandarla conserva la que tenía.
    const esCobroNuevo = estado_pago === 'PAGADO' && actual.estado_pago !== 'PAGADO';
    const formaPagoNueva = normalizarFormaPago(forma_pago);
    if (esCobroNuevo && !formaPagoNueva) {
      await client.query('ROLLBACK');
      return res.status(400).json({
        message: `Indica la forma de pago: ${enPalabras(FORMAS_PAGO_VALIDAS)}.`,
      });
    }

    // Cargas: la lista enviada reemplaza a las de la nota... salvo las que YA
    // PASARON POR UNA MÁQUINA, que son intocables.
    //
    // Antes se borraban todas y se recreaban desde cero. En una nota ya en
    // proceso eso destruía el historial de la carga lavada —qué máquina la
    // lavó (lavadora_usada_id) y cuándo arrancó (mig. 097)— y con él el reporte
    // de uso de máquinas. Ahora esas cargas se conservan tal cual: ni se
    // retarifan (lo ya cobrado no se reescribe) ni se pueden quitar por aquí;
    // para eso está DELETE /notas/:id/cargas/:cargaId, que solo acepta las que
    // nunca arrancaron.
    let filasCargas = null;
    let cargasNota  = null;
    if (cargas !== undefined) {
      const maquinasAntes = await maquinasDeNota(client, id);
      const prendaEfectiva = tipo_prenda ? String(tipo_prenda).toUpperCase() : actual.tipo_prenda;

      const { rows: existentes } = await client.query(
        `SELECT id, orden, lavadora_id, secadora_id, lavadora_iniciada_at, secadora_iniciada_at
           FROM nota_cargas WHERE nota_id = $1 ORDER BY orden`,
        [id]
      );
      const yaProcesada = (c) => c.lavadora_iniciada_at != null || c.secadora_iniciada_at != null;
      const conservadas = existentes.filter(yaProcesada);
      const conservadasIds = conservadas.map((c) => c.id);

      // Una carga ya procesada no puede desaparecer en una edición: se perdería
      // el registro de un lavado que sí ocurrió.
      const idsEnviados = new Set(
        (Array.isArray(cargas) ? cargas : []).map((c) => Number(c?.id)).filter(Number.isInteger)
      );
      const perdidas = conservadas.filter((c) => !idsEnviados.has(c.id));
      if (perdidas.length > 0) {
        await client.query('ROLLBACK');
        return res.status(409).json({
          message: `La carga ${perdidas[0].orden} ya se procesó y no se puede quitar al editar. ` +
                   'Quita solo las cargas que no hayan arrancado.',
        });
      }

      // Solo se rehacen las cargas que no han arrancado.
      const entrantes = (Array.isArray(cargas) ? cargas : [])
        .filter((c) => !conservadasIds.includes(Number(c?.id)));

      if (entrantes.length > 0) {
        try {
          filasCargas = await prepararCargas(client, entrantes, prendaEfectiva, req.sucursal, actual.tipo_servicio, Number(id));
        } catch (e) {
          await client.query('ROLLBACK');
          return res.status(400).json({ message: e.message });
        }
        // Las conservadas se quedan con su orden; las rehechas van después.
        const ordenBase = conservadas.reduce((max, c) => Math.max(max, c.orden), 0);
        filasCargas.forEach((f, i) => { f.orden = ordenBase + i + 1; });
      } else {
        filasCargas = [];
      }

      // Liberar el stock reservado de los productos de las cargas que SÍ se
      // borran (el ON DELETE CASCADE elimina las filas pero no revierte
      // stock_reservado). Los nuevos productos se reservan en insertarCargas.
      await client.query(
        `UPDATE productos a
            SET stock_reservado = stock_reservado - np.cantidad_medidas
          FROM nota_productos np
          WHERE np.nota_id = $1 AND np.carga_id IS NOT NULL
            AND NOT (np.carga_id = ANY($2::int[]))
            AND np.producto_id = a.id`,
        [id, conservadasIds]
      );
      await client.query(
        'DELETE FROM nota_cargas WHERE nota_id = $1 AND NOT (id = ANY($2::int[]))',
        [id, conservadasIds]
      );
      if (filasCargas.length > 0) {
        try {
          await insertarCargas(client, id, filasCargas, req.sucursal, actual.tipo_servicio);
        } catch (e) {
          await client.query('ROLLBACK');
          return res.status(400).json({ message: e.message });
        }
      }
      cargasNota = await cargasDeNota(client, id);

      if (['LAVANDO', 'SECANDO'].includes(actual.estado)) {
        // Las máquinas de las cargas conservadas siguen ocupadas: si no se
        // cuentan aquí, editar la nota liberaría una lavadora que está girando.
        const despues = new Set([
          ...filasCargas.flatMap(f => [f.lavadora_id, f.secadora_id]),
          ...conservadas.flatMap(c => [c.lavadora_id, c.secadora_id]),
        ].filter(Boolean));
        const liberar = maquinasAntes.filter(mid => !despues.has(mid));
        if (liberar.length > 0) {
          await client.query(
            `UPDATE maquinas SET estado = 'disponible', en_uso_desde = NULL
              WHERE id = ANY($1) AND estado = 'en_uso'`,
            [liberar]
          );
        }
        const tomar = [...despues].filter(mid => !maquinasAntes.includes(mid));
        if (tomar.length > 0) {
          await client.query(
            `UPDATE maquinas SET estado = 'en_uso', en_uso_desde = NOW()
              WHERE id = ANY($1) AND estado = 'disponible'`,
            [tomar]
          );
          await marcarMaquinasIniciadas(client, id, tomar);
        }
        await sellarCicloMaquinas(client, id);
      }
    }

    // PATCH real (auditoría A4): solo los campos presentes en el body se
    // modifican; los ausentes conservan su valor. JSON no puede mandar
    // undefined, así que "presente" = la clave viene en el body.
    const tiene = (campo) => req.body[campo] !== undefined;

    const ajusteNum = tiene('ajuste')
      ? Number(ajuste) || 0
      : Number(actual.ajuste) || 0;

    // Los productos solo se tocan si vienen en el body: la lista enviada
    // (aun vacía) reemplaza los de la nota; ausente, se conservan.
    let productosNota;
    if (productos !== undefined) {
      // Solo los productos a nivel nota (carga_id IS NULL, autoservicio); los
      // de cargas se manejan junto con sus cargas.
      await client.query(
        `UPDATE productos a
           SET stock_reservado = stock_reservado - np.cantidad_medidas
         FROM nota_productos np
         WHERE np.nota_id = $1 AND np.carga_id IS NULL AND np.producto_id = a.id`,
        [id]
      );
      await client.query('DELETE FROM nota_productos WHERE nota_id = $1 AND carga_id IS NULL', [id]);

      // Insertar los nuevos productos (nivel nota). La unidad/precio/medidas los
      // resuelve reservarProducto según el servicio.
      const productosInsertados = [];
      for (const { producto_id, cantidad } of productos) {
        if (!producto_id || !cantidad || Number(cantidad) <= 0) continue;
        try {
          productosInsertados.push(
            await reservarProducto(client, id, null, producto_id, cantidad, req.sucursal, actual.tipo_servicio)
          );
        } catch (e) {
          await client.query('ROLLBACK');
          return res.status(400).json({ message: e.message });
        }
      }
      productosNota = productosInsertados;
    } else {
      const { rows: existentes } = await client.query(
        `SELECT np.id, np.producto_id, a.nombre, np.cantidad, np.precio_unitario,
                (np.cantidad * np.precio_unitario) AS subtotal
         FROM nota_productos np
         JOIN productos a ON a.id = np.producto_id
         WHERE np.nota_id = $1 AND np.carga_id IS NULL
         ORDER BY np.created_at ASC`,
        [id]
      );
      productosNota = existentes;
    }

    // Suma de cargas: las recién enviadas o las existentes de la nota.
    let cargasSum;
    if (filasCargas) {
      cargasSum = filasCargas.reduce((s, f) => s + f.precio_lavadora + f.precio_secadora, 0);
    } else {
      const { rows: sumRows } = await client.query(
        'SELECT SUM(precio_lavadora + precio_secadora) AS s FROM nota_cargas WHERE nota_id = $1',
        [id]
      );
      cargasSum = sumRows[0]?.s != null ? Number(sumRows[0].s) : 0;
    }

    // Provisional: recalcularPrecioTotal (abajo) fija el definitivo con la
    // regla de tope (en Por Encargo el precio de la carga es su tope).
    const subtotalProductos = productosNota.reduce((s, p) => s + Number(p.subtotal), 0);
    const precioFinal = cargasSum + ajusteNum + subtotalProductos;

    const { rows } = await client.query(
      `UPDATE notas SET
         cliente_id      = $2,
         estado_pago     = $3,
         fecha_entrega   = $4,
         tiempo_entrega  = $5,
         instrucciones   = $6,
         tamano          = $7,
         tipo_prenda     = $8,
         tipo_tela       = $9,
         tamano_edredon  = $10,
         ajuste          = $11,
         precio_total    = $12,
         forma_pago      = $13
       WHERE id = $1
       RETURNING *`,
      [
        id,
        tiene('cliente_id')     ? (cliente_id || null) : actual.cliente_id,
        estado_pago || actual.estado_pago,
        tiene('fecha_entrega')  ? (fecha_entrega || null) : actual.fecha_entrega,
        tiene('tiempo_entrega') ? (tiempo_entrega ? String(tiempo_entrega).toUpperCase() : null) : actual.tiempo_entrega,
        tiene('instrucciones')  ? (instrucciones || null) : actual.instrucciones,
        tamano ? String(tamano).toLowerCase() : actual.tamano,
        tipo_prenda ? String(tipo_prenda).toUpperCase() : actual.tipo_prenda,
        tiene('tipo_tela')      ? (tipo_tela ? String(tipo_tela).trim() : null) : actual.tipo_tela,
        tiene('tamano_edredon') ? (tamano_edredon ? String(tamano_edredon).trim() : null) : actual.tamano_edredon,
        ajusteNum,
        precioFinal,
        // Cobro nuevo → la forma recibida. Reversión → se limpia. En cualquier
        // otro caso se conserva la que ya tenía la nota.
        esCobroNuevo ? formaPagoNueva : actual.forma_pago,
      ]
    );

    // Total definitivo con la regla de tope (precio fijo por carga en Por
    // Encargo). Sobrescribe el provisional de arriba.
    rows[0].precio_total = await recalcularPrecioTotal(client, id);

    // Si la edición movió el total de una nota que ya estaba pagada, el cobro
    // deja de corresponder y vuelve a PENDIENTE. Se compara contra el precio
    // que tenía ANTES de editar (no contra el provisional). No aplica si en
    // esta misma petición se está cobrando.
    if (actual.estado_pago === 'PAGADO' && !esCobroNuevo
        && Number(rows[0].precio_total) !== Number(actual.precio_total)) {
      // Séptima puerta al mismo sitio: si ese cobro ya quedó congelado en un
      // corte cerrado, no se devuelve a pendiente (mismo motivo que arriba).
      if (actual.caja_id) {
        const { rows: cj } = await client.query(
          'SELECT estado FROM cajas WHERE id = $1 FOR SHARE', [actual.caja_id]);
        if (cj[0]?.estado !== 'abierta') {
          await client.query('ROLLBACK');
          return res.status(409).json({ message: new CorteCerradoError(actual.folio ?? `#${actual.id}`).message });
        }
      }
      await desmarcarPagoPorCambio(
        client, actual, Number(actual.precio_total), Number(rows[0].precio_total),
        req.user?.id, req.sucursal
      );
      rows[0].estado_pago = 'PENDIENTE';
      rows[0].forma_pago  = null;
      rows[0].pagado_en   = null;
    }

    if (rows[0].precio_total != null && Number(rows[0].precio_total) < 0) {
      await client.query('ROLLBACK');
      return res.status(400).json({ message: 'El total de la nota no puede ser negativo. Revisa el ajuste.' });
    }

    const errTope = await validarTopesCargas(client, id);
    if (errTope) {
      await client.query('ROLLBACK');
      return res.status(400).json({ message: errTope });
    }

    // Quitar la carga que ya no se va a usar puede dejar la nota terminada: sin
    // esto se quedaba En Espera para siempre, esperando una carga que ya no
    // existe. Solo aplica a notas en proceso; una PAGADA o FINALIZADA no se
    // reabre por editarla.
    if (['EN_ESPERA', 'LAVANDO', 'SECANDO'].includes(rows[0].estado)
        && !(await hayCargasPendientes(client, id))) {
      rows[0].estado = await cerrarNotaSinCargasPendientes(client, id, {
        sucursal: req.sucursal, usuarioId: req.user?.id,
      });
    }

    if (cargasNota === null) {
      cargasNota = await cargasDeNota(client, id);
    }

    await client.query('COMMIT');
    res.json({ ...rows[0], cargas: cargasNota, productos: productosNota });
  } catch (err) {
    await client.query('ROLLBACK');
    console.error('updateNota error:', err);
    if (err.code === '23503') {
      return res.status(400).json({ message: 'El cliente o la máquina seleccionada no existe en esta sucursal.' });
    }
    res.status(500).json({ message: 'No se pudieron guardar los cambios de la nota. Intenta de nuevo.' });
  } finally {
    client.release();
  }
};

// ── DELETE /notas/:id/cargas/:cargaId ───────────────────────
// Quita UNA carga que ya no se va a usar (el cliente trajo menos ropa de la
// prevista). Solo se puede quitar una carga que nunca arrancó: las que ya
// lavaron o secaron son historial y se conservan.
//
// Es la salida al caso contrario del "no está lista hasta terminarlas todas":
// sin esto, una carga que nadie va a usar dejaba la nota En Espera para
// siempre. Al quitarla, la nota deja de cobrarla y, si con eso ya no le queda
// nada pendiente, pasa sola a Por Entregar.
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

    // Una carga que ya pasó por una máquina es historial: quitarla borraría el
    // registro de un lavado que sí ocurrió (y de lo que se cobró por él).
    if (carga.lavadora_iniciada_at || carga.secadora_iniciada_at) {
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

    // Devolver el stock que esta carga tenía reservado (el CASCADE borra las
    // filas de nota_productos pero no revierte stock_reservado).
    await client.query(
      `UPDATE productos a
          SET stock_reservado = stock_reservado - np.cantidad_medidas
        FROM nota_productos np
        WHERE np.carga_id = $1 AND np.producto_id = a.id`,
      [cargaId]
    );

    // Si tenía máquinas apenas asignadas (nunca arrancadas), quedan libres.
    const asignadas = [carga.lavadora_id, carga.secadora_id].filter(Boolean);
    if (asignadas.length > 0) {
      await client.query(
        `UPDATE maquinas SET estado = 'disponible', en_uso_desde = NULL
          WHERE id = ANY($1) AND estado = 'en_uso'`,
        [asignadas]
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

// ── DELETE /notas/:id ───────────────────────────────────────
export const eliminarNota = async (req, res) => {
  if (!esAdmin(req.user.rol)) {
    return res.status(403).json({ message: 'Solo los administradores pueden eliminar notas.' });
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

    // El cobro que ya quedó congelado en un corte CERRADO (mig. 101) no se
    // deshace por ninguna puerta: editar la nota, revertir su pago y cancelarla
    // ya respondían 409, pero BORRARLA seguía permitido — y es el cambio más
    // grande de todos. El corte de aquel día conserva la venta (sus cifras están
    // congeladas) mientras Ventas, que suma las notas vivas, la pierde: dos
    // reportes del mismo día diciendo cosas distintas, y un dinero en el cajón
    // sin nota que lo explique (2026-09-23).
    //
    // Un cobro SIN caja (caja_id NULL) no entró en ningún corte: ese sí se borra.
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

    // Una máquina de esta nota CORRIENDO su ciclo (lavando o secando) no se
    // interrumpe por un borrado: hay ropa dentro y el ciclo va a medias. Se mide
    // por `en_uso_desde`, que es lo que separa "lavando" de "encendida
    // esperando arranque" (mig. 110) — esa última sí se apaga y se suelta más
    // abajo, porque ahí todavía no empezó nada.
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
      // Con una sola máquina se dice qué está haciendo; con varias, "en uso",
      // que es lo único cierto de todas a la vez.
      const haciendo = una
        ? (corriendo[0].tipo === 'secadora' ? 'está secando' : 'está lavando')
        : 'siguen en uso';
      return res.status(409).json({
        message: `No se puede eliminar la nota: ${una ? 'la máquina' : 'las máquinas'} ${nombres} ${haciendo}. `
               + `Termina o detén ${una ? 'su ciclo' : 'sus ciclos'} antes de eliminarla.`,
      });
    }

    // Máquinas ENCENDIDAS por esta nota y todavía sin arrancar (mig. 110):
    // eliminar la nota las APAGA y las suelta. La nota es lo único que dice por
    // qué ese relé está cerrado, así que dejarlas encendidas sin ella sería el
    // agujero de "lavar sin nota" otra vez. Es lo mismo que la eliminación ya
    // hacía con las máquinas que la nota tenía LAVANDO, que es el caso más
    // comprometido de los dos.
    //
    // Y hay que hacerlo ANTES del DELETE: la referencia es ON DELETE SET NULL y
    // la 110 obliga a que las dos marcas vayan juntas, así que borrar primero
    // dejaba media marca y tronaba contra el CHECK con un "Intenta de nuevo"
    // que nunca iba a funcionar. El guardo de `en_uso_desde IS NULL` es por si
    // entretanto alguien inició el lavado: esa ya está lavando y la suelta el
    // camino de siempre, unas líneas más abajo.
    await client.query(
      `UPDATE maquinas
          SET encendida_sin_iniciar_at = NULL,
              encendida_para_nota_id   = NULL,
              estado = CASE WHEN estado = 'en_uso' AND en_uso_desde IS NULL
                            THEN 'disponible'::estado_maquina ELSE estado END
        WHERE encendida_para_nota_id = $1`,
      [id]
    );
    // Se recolectan antes del DELETE: el CASCADE borra nota_cargas.
    // Solo las que ESTA nota arrancó: las que únicamente tenía asignadas
    // pueden estar corriendo para otra nota (mig. 097).
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

    // El efecto en stock depende del estado de la nota:
    //   - PAGADA o FINALIZADA: el producto YA salió del estante (lo consumió el
    //     cobro o el cierre). Eliminar la nota anula esa venta, así que vuelve.
    //   - CANCELADA: al cancelar ya se devolvió o se soltó la reserva; nada que
    //     revertir.
    //   - Estados activos: solo liberar la reserva.
    //
    // FINALIZADA se trataba antes como "nada que revertir", y solo la venta de
    // mostrador era la excepción. Pero el razonamiento de esa excepción vale
    // para todas: si el borrado no devuelve el producto, un cobro mal capturado
    // deja el inventario corto sin forma de arreglarlo desde la nota. Y desde
    // que el Autoservicio se cierra al liquidarlo (2026-09-23), FINALIZADA es
    // el final normal de casi toda nota, no un caso raro.
    if (['PAGADA', 'FINALIZADA'].includes(estadoNota)) {
      await registrarMovimientosProductosNota(client, id, req.sucursal, req.user.id, 'liberacion');
      await client.query(
        `UPDATE productos a
           SET stock_actual = stock_actual + np.cantidad_medidas
         FROM nota_productos np
         WHERE np.nota_id = $1 AND np.producto_id = a.id`,
        [id]
      );
    } else if (!['FINALIZADA', 'CANCELADA'].includes(estadoNota)) {
      await client.query(
        `UPDATE productos a
           SET stock_reservado = stock_reservado - np.cantidad_medidas
         FROM nota_productos np
         WHERE np.nota_id = $1 AND np.producto_id = a.id`,
        [id]
      );
    }

    await client.query('DELETE FROM notas WHERE id = $1', [id]);

    // Liberar las máquinas que esta nota tenía corriendo
    if (maquinasNota.length > 0) {
      await client.query(
        `UPDATE maquinas
           SET estado = 'disponible',
               en_uso_desde = NULL
         WHERE id = ANY($1) AND estado = 'en_uso'`,
        [maquinasNota]
      );
    }

    // Alerta en la campana del Dashboard: la nota se borró por completo.
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

    // Cancelar borra una venta del día: queda en manos del administrador.
    if (estado === 'CANCELADA' && !esAdmin(req.user?.rol)) {
      await client.query('ROLLBACK');
      return res.status(403).json({ message: 'Solo un administrador puede cancelar una nota.' });
    }

    // Una nota ya cobrada NO se cancela. Si se pudiera, el corte del día
    // quedaría esperando un dinero que se devolvió (y si el cobro fue en otra
    // sesión de caja, el descuadre caería en el día equivocado). Para deshacer
    // un cobro está la reversión de pago, que sí deja rastro; una vez revertido,
    // la nota se puede cancelar.
    if (estado === 'CANCELADA'
        && (notaRows[0].estado_pago === 'PAGADO' || estadoActual === 'PAGADA')) {
      await client.query('ROLLBACK');
      return res.status(409).json({
        message: 'La nota ya está pagada. Para cancelarla, primero revierte el pago.',
      });
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

    // "Procesado" (Por Encargo → Por Entregar) exige que al menos una lavadora
    // haya terminado (2026-10-02): antes no hay ropa que doblar ni empacar. El
    // detalle ya esconde el botón; esto cubre una pantalla vieja, otro
    // dispositivo que cambió la nota mientras tanto o una llamada directa.
    if (estado === 'LISTA' && notaRows[0].tipo_servicio === 'POR_ENCARGO'
        && !(await algunaLavadoraTermino(client, id))) {
      await client.query('ROLLBACK');
      return res.status(409).json({
        message: 'Todavía no termina ninguna lavadora de esta nota: no se puede marcar como procesada.',
      });
    }

    // No se puede finalizar (entregar) una nota pendiente de pago: primero se
    // liquida. La UI muestra el botón "Liquidar" en vez de "Finalizar".
    if (estado === 'FINALIZADA' && notaRows[0].estado_pago === 'PENDIENTE') {
      await client.query('ROLLBACK');
      return res.status(400).json({
        message: 'No se puede finalizar una nota pendiente de pago. Liquídala primero.',
      });
    }

    const consumido = await stockYaConsumido(client, id);
    if (estado === 'CANCELADA') {
      if (consumido) {
        // El producto ya se dio por vendido (se cobró o se entregó): al anular
        // la venta vuelve al estante. La reserva ya se había liberado.
        await registrarMovimientosProductosNota(client, id, req.sucursal, req.user.id, 'liberacion');
        await client.query(
          `UPDATE productos a
             SET stock_actual = stock_actual + np.cantidad_medidas
           FROM nota_productos np
           WHERE np.nota_id = $1 AND np.producto_id = a.id`,
          [id]
        );
      } else {
        await client.query(
          `UPDATE productos a
             SET stock_reservado = stock_reservado - np.cantidad_medidas
           FROM nota_productos np
           WHERE np.nota_id = $1 AND np.producto_id = a.id`,
          [id]
        );
      }
    } else if (!consumido && (estado === 'PAGADA' || estado === 'FINALIZADA')) {
      // Consumir stock al cobrar o al entregar, lo que ocurra primero, y solo
      // una vez: ni PAGADA → FINALIZADA ni una nota reabierta y vuelta a
      // entregar descuentan el mismo producto dos veces (2026-09-25).
      await registrarMovimientosProductosNota(client, id, req.sucursal, req.user.id, 'venta');
      await client.query(
        `UPDATE productos a
           SET stock_actual    = stock_actual    - np.cantidad_medidas,
               stock_reservado = stock_reservado - np.cantidad_medidas
         FROM nota_productos np
         WHERE np.nota_id = $1 AND np.producto_id = a.id`,
        [id]
      );
    }

    // Al cancelar se guarda el motivo (opcional) capturado por el empleado.
    const motivoCancel = estado === 'CANCELADA'
      ? (typeof req.body?.motivo === 'string' ? req.body.motivo.trim() || null : null)
      : null;
    const { rows } = await client.query(
      `UPDATE notas SET estado = $1${estado === 'CANCELADA' ? ', motivo_cancelacion = $3' : ''} WHERE id = $2 RETURNING *`,
      estado === 'CANCELADA' ? [estado, id, motivoCancel] : [estado, id]
    );

    // Al terminar el ciclo (Por Entregar) o cancelar, la nota suelta todas
    // sus máquinas. El backend es el dueño del ciclo de vida: los clientes
    // ya no necesitan liberar máquina por máquina.
    if (estado === 'LISTA' || estado === 'CANCELADA') {
      await liberarMaquinasDeNota(client, id);
    }

    // Alerta en la campana del Dashboard cuando se cancela una nota.
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

// ── PATCH /notas/:id/activar-pendientes ─────────────────────
// Activa (marca en uso) las máquinas ya asignadas a la nota que sigan
// disponibles. Sin body activa TODAS; con { maquina_id } activa solo esa (para
// el botón "Iniciar Lavado" por máquina en Salidas). Sirve para poner en marcha
// las cargas que quedaron en espera, tanto en una nota En Espera como en una
// ya En Proceso (caso mixto).
// ¿La carga que esta nota está corriendo en esta máquina todavía tiene ciclos
// disponibles (mig. 108)? Es lo que distingue "hay que encenderla para otra
// vuelta" de "esta carga ya terminó y toca cerrarla".
async function cargaConCiclosDisponibles(client, notaId, maquinaId) {
  const { rows } = await client.query(
    `SELECT CASE WHEN nc.lavadora_id = $2 THEN nc.lavadora_ciclos
                 ELSE nc.secadora_ciclos END AS ciclos,
            m.tipo,
            -- La vuelta extra corre un solo ciclo (mig. 115).
            COALESCE((
              SELECT ncm.ciclo_unico FROM nota_carga_maquinas ncm
               WHERE ncm.carga_id = nc.id
                 AND ncm.slot = CASE WHEN nc.lavadora_id = $2 THEN 'lavadora' ELSE 'secadora' END
               ORDER BY ncm.asignada_at DESC, ncm.id DESC LIMIT 1
            ), FALSE) AS ciclo_unico,
            ${MINUTOS_CONFIGURADOS} AS minutos_ciclo,
            -- Y lo que su marca declara (mig. 122): una marca de ciclo único
            -- tampoco tiene "otra vuelta" que ofrecer.
            ${OPCIONES_DE_MARCA} AS marca_opciones
       FROM nota_cargas nc
       -- La máquina entra por el tope de ciclos: una lavadora sin tiempo
       -- configurado corre uno solo, así que aquí ya no hay "otra vuelta" que
       -- encender y el botón tiene que llevar a Finalizar.
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
// Paso previo a "Iniciar Lavado" (mig. 110): le da CORRIENTE a la máquina sin
// arrancar su cronómetro.
//
// La lavadora no arranca sola al recibir luz —hay que apretar su botón— y antes
// de eso todavía hay que meter la ropa. Cuando los dos pasos eran uno, todo ese
// rato se le descontaba al ciclo, y con el corte por fin de ciclo activo la
// corriente se iba antes de que el lavado terminara.
//
// La máquina queda apartada ('en_uso', no se ofrece a otra nota) pero SIN
// `en_uso_desde`: eso distingue "encendida esperando" de "lavando" y evita que
// un `ciclo_minutos` viejo arme un corte que no toca. La espera caduca sola
// (ESPERA_ARRANQUE_MINUTOS) para que un descuido no deje la máquina prendida.
//
// La máquina con cronómetro (2026-10-02) no tiene esos dos pasos: encenderla ES
// arrancar su carga. El cronómetro empieza con la corriente, el empleado la
// arranca con su botón cuando quiera y la carga termina al finalizarla.
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

    // FOR UPDATE: dos empleados que le den a la vez a la misma máquina se
    // serializan aquí, igual que al iniciar.
    const { rows: maqRows } = await client.query(
      `SELECT m.id, m.nombre, m.tipo, m.marca, m.estado, m.en_uso_desde, m.encendida_para_nota_id,
              ${esCronometroSql('m')} AS cronometro
         FROM maquinas m WHERE m.id = $1 AND m.sucursal = $2 FOR UPDATE OF m`,
      [maquina_id, req.sucursal]
    );
    if (maqRows.length === 0) {
      await client.query('ROLLBACK');
      return res.status(404).json({ message: 'Máquina no encontrada.' });
    }
    const maq = maqRows[0];

    // Ya encendida por esta misma nota: no es un error, es el botón pulsado dos
    // veces. Se responde ok para que la pantalla quede en el estado correcto.
    if (maq.estado === 'en_uso' && maq.en_uso_desde == null
        && String(maq.encendida_para_nota_id) === String(id)) {
      await client.query('ROLLBACK');
      return res.json({ message: `${maq.nombre} ya está encendida.`, maquina: maq });
    }

    // Segundo ciclo de la misma carga (mig. 108): la máquina sigue 'en_uso' con
    // la nota abierta, pero su ciclo terminó y el corte ya le quitó la luz. Para
    // el empleado es el mismo trabajo que la primera vez —encender, cargar,
    // apretar el botón— así que se le da el mismo camino: vuelve al estado de
    // espera y "Otro ciclo" hará luego de "Iniciar".
    const listaParaOtroCiclo =
      maq.estado === 'en_uso' && maq.en_uso_desde != null && await cargaConCiclosDisponibles(client, id, maq.id);

    if (listaParaOtroCiclo) {
      const { rows: reUpd } = await client.query(
        `UPDATE maquinas
            SET encendida_sin_iniciar_at = NOW(),
                encendida_para_nota_id   = $2,
                -- Se borra el ciclo anterior: hasta que arranque el siguiente no
                -- hay cronómetro que contar ni corte que programar.
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

    // Cronómetro ya corriendo para esta misma nota: el botón pulsado dos veces.
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

    if (cronometro) {
      // Lo mismo que "Iniciar Lavado" (activar-pendientes) pero en el acto de
      // encender: el cronómetro cuenta desde aquí, y el ciclo que se sella es
      // el tope de su modelo o de su tamaño.
      //
      // Igual que allá, si es la SECADORA de una carga cuya lavadora seguía
      // apartada, esa lavadora ya cumplió: se suelta (la carga la conserva en
      // lavadora_usada_id como historial).
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
      // Las lavadoras soltadas se apagan ya; el trigger también lo haría.
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
              -- Sin cronómetro hasta que arranque el lavado. Se limpia el ciclo
              -- viejo para que nada de la carga anterior arme un corte.
              en_uso_desde  = NULL,
              ciclo_minutos = NULL
        WHERE id = $1 RETURNING *`,
      [maquina_id, id]
    );

    await client.query('COMMIT');

    // El trigger de la mig. 075 ya avisa al cambiar el estado, pero se pide
    // explícito para no depender de que el listener esté vivo: encender es la
    // acción que el empleado está mirando.
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

export const activarMaquinasPendientes = async (req, res) => {
  const { id } = req.params;
  const { maquina_id, minutos } = req.body ?? {};
  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    // Duración elegida en el modal del modelo que pregunta (mig. 120).
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
    // Arrancable = libre, o ya encendida por ESTA nota esperando su arranque
    // (mig. 110). Ese segundo caso es el paso previo "Encender máquina": la
    // máquina está apartada y con corriente, pero sin cronómetro (`en_uso_desde`
    // en NULL). Sin esto el segundo paso se rechazaba con un "ya está en uso",
    // porque antes solo contaba 'disponible'.
    const esperandoDeEstaNota = (m) =>
      m.estado === 'en_uso'
      && m.en_uso_desde == null
      && String(m.encendida_para_nota_id) === String(id);
    let libres = maqs
      .filter(m => m.estado === 'disponible' || esperandoDeEstaNota(m))
      .map(m => m.id);

    // Con maquina_id se activa solo esa (botón por máquina); debe estar
    // asignada a la nota y libre. Aquí es donde se decide quién se queda con
    // una máquina que varias notas tienen asignada: la primera en iniciar. El
    // FOR UPDATE de arriba serializa a dos empleados que le den a la vez.
    if (maquina_id != null) {
      if (!libres.some(x => String(x) === String(maquina_id))) {
        const asignada = maqs.some(m => String(m.id) === String(maquina_id));
        const ocupada = maqs.find(m => String(m.id) === String(maquina_id)
                                       && m.estado === 'en_uso' && !esperandoDeEstaNota(m));
        let mensaje = 'La máquina no está asignada a la nota o no está disponible.';
        if (ocupada) {
          // La tomó alguien más: hay que cambiarla por otra en esta carga.
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

    // Al iniciar el secado de una carga cuya lavadora seguía lavando (en uso),
    // esa lavadora ya cumplió: se captura antes de tomar la secadora para
    // soltarla (desvincular + liberar) después. La carga conserva la lavadora
    // en lavadora_usada_id (historial). Solo aplica a lavadoras realmente en uso.
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
              -- La espera terminó en el único final bueno: el lavado arrancó.
              encendida_sin_iniciar_at = NULL,
              encendida_para_nota_id   = NULL
        WHERE id = ANY($1)`,
      [libres]
    );
    await marcarMaquinasIniciadas(client, id, libres);

    if (lavASoltar.length > 0) {
      const lavIds   = lavASoltar.map(r => r.lavadora_id);
      const cargaIds = lavASoltar.map(r => r.carga_id);
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
    // La nota queda en la fase que dicten sus máquinas: si se activó una
    // lavadora vuelve/queda en LAVANDO; si solo corren secadoras, SECANDO.
    const fase = await faseProcesoDeNota(client, id);
    await client.query(`UPDATE notas SET estado = $1 WHERE id = $2`, [fase, id]);

    await client.query('COMMIT');

    const { rows } = await pool.query(
      `SELECT n.* FROM notas n WHERE n.id = $1`,
      [id]
    );
    res.json({ ...rows[0], cargas: await cargasDeNota(pool, id) });
  } catch (err) {
    await client.query('ROLLBACK');
    console.error('activarMaquinasPendientes error:', err);
    res.status(500).json({ message: 'No se pudieron activar las máquinas. Intenta de nuevo.' });
  } finally {
    client.release();
  }
};

// ── PATCH /notas/:id/asignar-carga-maquina ──────────────────
// Asigna una máquina física a una carga (de Autoservicio o Por Encargo) creada
// con TIPO pero sin máquina. Valida que sea del slot que toca (una secadora no
// entra de lavadora), que esté disponible y que no la tenga apartada otra nota
// abierta. El TAMAÑO ya no se valida salvo en el edredón (2026-09-26). La
// máquina queda asignada En Espera (se arranca luego con "Iniciar").
// El precio ya está fijado por el tipo: NO se recalcula.
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
    // Autoservicio: la máquina se cobra al asignarla (2026-09-25), y el tamaño
    // de lavadora no se eligió en la nota. Las dos cosas cuelgan de aquí.
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
    // El tipo de la máquina debe coincidir con el previsto de la carga.
    if (slot === 'lavadora') {
      if (maq.tipo === 'secadora') {
        await client.query('ROLLBACK');
        return res.status(400).json({ message: `${maq.nombre} es una secadora, no una lavadora.` });
      }
      // El tamaño ya NO tiene que coincidir con el que eligió la nota
      // (2026-09-26). En el mostrador la ropa entra en la lavadora que esté
      // libre, y el precio no depende de cuál sea: en Por Encargo se cobra el
      // tope de la carga, congelado al crearla, y en Autoservicio se tarifa
      // abajo con la máquina que de verdad se asigna. Exigirlo solo dejaba una
      // carga esperando una mediana con dos jumbos desocupadas al lado.
      //
      // Lo que sigue en pie es físico, no de tarifa: un edredón no cabe en una
      // mediana. Antes lo tapaba el propio chequeo de tamaño —una carga de
      // edredón se crea con lavadora_tipo 'jumbo'—, así que al quitarlo hay
      // que decirlo aquí explícitamente.
      if (String(carga.tipo_prenda).toUpperCase() === 'EDREDON' && maq.tipo !== 'lavadora_jumbo') {
        await client.query('ROLLBACK');
        return res.status(400).json({ message: `Los edredones solo van en lavadora jumbo (${maq.nombre} no lo es).` });
      }
    } else {
      // La secadora es de un solo tamaño: cualquier secadora disponible sirve.
      if (maq.tipo !== 'secadora') {
        await client.query('ROLLBACK');
        return res.status(400).json({ message: `${maq.nombre} no es una secadora.` });
      }
    }

    const col = slot === 'lavadora' ? 'lavadora_id' : 'secadora_id';
    const colUsada = slot === 'lavadora' ? 'lavadora_usada_id' : 'secadora_usada_id';
    await registrarMaquinaEnCarga(client, carga_id, slot, maquina_id);
    // AQUÍ se cobra la máquina en Autoservicio (2026-09-25): la nota nace en $0
    // y es al asignar la física cuando se sabe qué se usó, así que es cuando se
    // tarifa —con la tarifa de ESA máquina, mediana o jumbo—. En Por Encargo el
    // precio no depende de esto: la carga se cobra por su tope, congelado al
    // crear la nota, así que ahí no se toca nada.
    if (tarifaAlAsignar) {
      const t = await tarifasCarga(client);
      const precio = slot === 'lavadora'
        ? tarifaLavadora(maq.tipo, carga.tipo_prenda, t)
        : tarifaSecadora(maq.tamano, carga.tipo_prenda, t);
      const precioCol = slot === 'lavadora' ? 'precio_lavadora' : 'precio_secadora';
      await client.query(
        `UPDATE nota_cargas SET ${col} = $1, ${colUsada} = $1, ${precioCol} = $2 WHERE id = $3`,
        [maquina_id, precio, carga_id]
      );
      // Si la nota ya estaba pagada, lo cobrado deja de corresponder: vuelve a
      // PENDIENTE para cobrarla por el importe nuevo (mismo criterio que
      // cambiar-maquina).
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
    console.error('asignarCargaMaquina error:', err);
    res.status(500).json({ message: 'No se pudo asignar la máquina a la carga. Intenta de nuevo.' });
  } finally {
    client.release();
  }
};

// ── PATCH /notas/:id/asignar-secadora ───────────────────────
// Asigna una secadora a una nota en proceso: la agrega a las primeras N
// cargas que aún no tienen secadora, marca la máquina en uso y suma su
// tarifa al total.
export const asignarSecadora = async (req, res) => {
  const { id } = req.params;
  const { secadora_id, cantidad_cargas_secadora } = req.body;

  if (!secadora_id) {
    return res.status(400).json({ message: 'Elige la secadora.' });
  }
  if (cantidad_cargas_secadora != null && cantidad_cargas_secadora !== '' &&
      (!Number.isInteger(Number(cantidad_cargas_secadora)) || Number(cantidad_cargas_secadora) < 1)) {
    return res.status(400).json({ message: 'La cantidad de cargas de secadora debe ser 1 o más.' });
  }
  const cargasPedidas = cantidad_cargas_secadora != null && cantidad_cargas_secadora !== ''
    ? Number(cantidad_cargas_secadora)
    : 1;

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
    const nota = notaRows[0];
    if (!['LAVANDO', 'SECANDO'].includes(nota.estado)) {
      await client.query('ROLLBACK');
      return res.status(400).json({ message: 'Solo se puede asignar una secadora a una nota en proceso.' });
    }

    // La secadora se agrega a las primeras N cargas que no tienen una. Se trae
    // la lavadora (actual o ya usada) y la prenda de cada carga para tarifar el
    // secado por su categoría (mirror de la lavadora).
    const { rows: sinSecadora } = await client.query(
      `SELECT nc.id, nc.tipo_prenda, ml.tipo AS lavadora_tipo
         FROM nota_cargas nc
         LEFT JOIN maquinas ml ON ml.id = COALESCE(nc.lavadora_id, nc.lavadora_usada_id)
        WHERE nc.nota_id = $1 AND nc.secadora_id IS NULL
        ORDER BY nc.orden ASC
        FOR UPDATE OF nc`,
      [id]
    );
    if (sinSecadora.length === 0) {
      await client.query('ROLLBACK');
      return res.status(400).json({ message: 'La nota no tiene cargas sin secadora.' });
    }
    const objetivo = sinSecadora.slice(0, cargasPedidas);

    const { rows: maqRows } = await client.query(
      'SELECT tipo, tamano, estado FROM maquinas WHERE id = $1 AND sucursal = $2 FOR UPDATE',
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

    const t = await tarifasCarga(client);

    await client.query(
      `UPDATE maquinas SET estado = 'en_uso', en_uso_desde = NOW() WHERE id = $1`,
      [secadora_id]
    );
    await marcarMaquinasIniciadas(client, id, [secadora_id]);
    // Cada carga cobra el secado según el tamaño de la secadora (prenda edredón
    // manda sobre el tamaño).
    for (const c of objetivo) {
      await registrarMaquinaEnCarga(client, c.id, 'secadora', secadora_id);
      await client.query(
        `UPDATE nota_cargas SET secadora_id = $1, secadora_usada_id = $1, precio_secadora = $2 WHERE id = $3`,
        [secadora_id, tarifaSecadora(secadoraTamano, c.tipo_prenda, t), c.id]
      );
    }
    await sellarCicloMaquinas(client, id);
    // Si el cambio movió el total y la nota ya estaba pagada, el cobro deja de
    // corresponder: vuelve a PENDIENTE para cobrarla por el importe nuevo.
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
    console.error('asignarSecadora error:', err);
    res.status(500).json({ message: 'No se pudo asignar la secadora. Intenta de nuevo.' });
  } finally {
    client.release();
  }
};

// ── PATCH /notas/:id/asignar-maquina ────────────────────────
// Asigna una máquina extra (lavadora o secadora) a la nota. Sin `carga_id` se
// crea una CARGA NUEVA; con `carga_id` la máquina se suma a esa carga, llenando
// su hueco libre (p. ej. la secadora de una carga que solo tiene lavadora).
// La máquina queda ASIGNADA pero disponible (En Espera): NO arranca aquí,
// el empleado la inicia manualmente desde Salidas (igual que al crear la nota).
// `cobrar` decide si la carga suma su tarifa al total (true) o va sin costo
// (false, precio 0). Disponible mientras la nota no esté finalizada ni cancelada.
// No toca estado_pago: igual que agregar productos, un cobro posterior a una
// nota pagada se maneja aparte.
export const asignarMaquina = async (req, res) => {
  const { id } = req.params;
  const { maquina_id, maquina_ids, cobrar, carga_id } = req.body;

  // Acepta una máquina (maquina_id, formato viejo) o varias (maquina_ids). Se
  // normaliza a una lista de ids únicos.
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
    // Autoservicio SÍ puede agregar máquinas (2026-09-25). El bloqueo anterior
    // se apoyaba en que se cobraba por adelantado, y eso ya no es así: la nota
    // nace pendiente y cada máquina se tarifa al asignarla, así que una máquina
    // de más es un renglón más de esta nota —no una nota nueva—. La máquina que
    // la nota ya traía elegida se sigue poniendo con `asignar-carga-maquina`;
    // esta ruta es para AGREGAR.

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

    // La(s) carga(s) nueva(s) heredan la prenda de la nota para tarifar con su
    // categoría.
    const tipoPrenda = notaRows[0].tipo_prenda ?? null;
    const esEdredon  = String(tipoPrenda).toUpperCase() === 'EDREDON';
    const lavadoras  = maqRows.filter(m => m.tipo !== 'secadora');
    const secadoras  = maqRows.filter(m => m.tipo === 'secadora');
    const lavNoJumbo = esEdredon && lavadoras.find(m => m.tipo !== 'lavadora_jumbo');
    if (lavNoJumbo) {
      await client.query('ROLLBACK');
      return res.status(400).json({ message: 'Los edredones solo van en lavadora jumbo.' });
    }

    const { rows: [{ max_orden }] } = await client.query(
      'SELECT COALESCE(MAX(orden), 0)::int AS max_orden FROM nota_cargas WHERE nota_id = $1',
      [id]
    );

    const t = await tarifasCarga(client);
    const precioLav = m => cobrar ? tarifaLavadora(m.tipo, tipoPrenda, t) : 0;
    const precioSec = m => cobrar ? tarifaSecadora(m.tamano, tipoPrenda, t) : 0;

    // Si se indica carga_id, la primera pareja se agrega a ESA carga en vez de
    // crear una carga nueva; las parejas que sobren sí se agregan como cargas
    // nuevas. La carga puede estar vacía (creada al hacer la nota sin máquina) o
    // ya traer una máquina: p. ej. sumarle la secadora a una carga que solo
    // tiene lavadora. El hueco lo ocupa la máquina PUESTA, no la que ya se usó
    // y se liberó: la misma ropa puede necesitar otro lavado o más secado, y
    // eso va en su carga (2026-09-22). Lo que no cabe es una segunda máquina
    // del mismo tipo a la vez: la carga guarda una lavadora y una secadora.
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
      cargaObjetivo = c;
    }

    // Empareja lavadora+secadora en una misma carga (un ciclo completo). Las que
    // sobran de un tipo van cada una en su propia carga.
    const nuevas = [];
    const n = Math.max(lavadoras.length, secadoras.length);
    for (let i = 0; i < n; i++) {
      nuevas.push({ lavadora: lavadoras[i] ?? null, secadora: secadoras[i] ?? null });
    }

    // La máquina NO arranca aquí: queda asignada pero disponible (En Espera) y
    // el empleado la inicia manualmente desde Salidas, igual que al crear la nota.
    let nuevoOrden = max_orden;
    for (let i = 0; i < nuevas.length; i++) {
      const { lavadora, secadora } = nuevas[i];
      // La primera pareja llena la carga objetivo (si se indicó): conserva su
      // orden, prenda y es_adicional originales; solo se le ponen las máquinas.
      if (cargaObjetivo && i === 0) {
        const prendaCarga = cargaObjetivo.tipo_prenda ?? tipoPrenda;
        if (String(prendaCarga).toUpperCase() === 'EDREDON' && lavadora && lavadora.tipo !== 'lavadora_jumbo') {
          await client.query('ROLLBACK');
          return res.status(400).json({ message: 'Los edredones solo van en lavadora jumbo.' });
        }
        // Solo se toca el hueco que se está llenando: si la carga ya traía la
        // otra máquina (o su precio), se conserva tal cual. Y si ese hueco YA
        // se había usado (segundo lavado, más secado), su precio tampoco se
        // reescribe: lo que se cobró al hacer la nota sigue siendo lo cobrado,
        // y la máquina repetida va sin cobro. Sin esto, repetir con cobrar
        // false pondría el precio en 0 y bajaría el total de la nota.
        // Cada hueco que se llena aquí es una pasada más de esa carga. Corre un
        // solo ciclo (mig. 115) cuando es una REPETICIÓN de ese hueco: relavar
        // o secar de más sobre ropa que ya dio su vuelta, donde encadenar dos
        // ciclos es regalar el doble de agua y luz.
        //
        // Ya NO se mira si va sin cobro. Ese era un buen atajo cuando la nota
        // traía sus máquinas elegidas y lo que se agregaba aquí era un extra;
        // desde que Por Encargo vende servicios y TODAS sus máquinas se ponen
        // en Salidas —siempre sin cobro, porque lo que se cobra es el
        // servicio—, capar por ahí dejaba el lavado normal del cliente en un
        // solo ciclo aunque su modelo pida dos (una LG, sin ir más lejos).
        const repiteLav = Boolean(cargaObjetivo.lavadora_usada_id);
        const repiteSec = Boolean(cargaObjetivo.secadora_usada_id);
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
                  precio_secadora   = CASE WHEN $4::numeric IS NULL THEN precio_secadora ELSE $4 END
            WHERE id = $5`,
          [
            lavadora ? lavadora.id : null,
            secadora ? secadora.id : null,
            // null = conservar el precio que ya tenía el hueco.
            !lavadora || cargaObjetivo.lavadora_usada_id
              ? null
              : (cobrar ? tarifaLavadora(lavadora.tipo, prendaCarga, t) : 0),
            !secadora || cargaObjetivo.secadora_usada_id
              ? null
              : (cobrar ? tarifaSecadora(secadora.tamano, prendaCarga, t) : 0),
            cargaObjetivo.id,
          ]
        );
        continue;
      }
      nuevoOrden += 1;
      const { rows: nuevaCarga } = await client.query(
        `INSERT INTO nota_cargas
           (nota_id, orden, lavadora_id, secadora_id, lavadora_usada_id, secadora_usada_id,
            precio_lavadora, precio_secadora, tipo_prenda, es_adicional)
         VALUES ($1, $2, $3, $4, $3, $4, $5, $6, $7, TRUE) RETURNING id`,
        [
          id, nuevoOrden,
          lavadora ? lavadora.id : null,
          secadora ? secadora.id : null,
          lavadora ? precioLav(lavadora) : 0,
          secadora ? precioSec(secadora) : 0,
          tipoPrenda,
        ]
      );
      // Carga nueva: es un lavado de estreno, nunca una repetición, así que
      // corre lo que diga el modelo de su máquina. Que vaya sin cobro no la
      // capa: en Por Encargo TODAS las máquinas se ponen aquí y sin cobro
      // —lo cobrado es el servicio—, así que mirarlo dejaba el lavado del
      // cliente en un ciclo.
      await registrarMaquinaEnCarga(client, nuevaCarga[0].id, 'lavadora',
        lavadora ? lavadora.id : null, 'pasada', false);
      await registrarMaquinaEnCarga(client, nuevaCarga[0].id, 'secadora',
        secadora ? secadora.id : null, 'pasada', false);
    }

    // Estado según las máquinas EN USO: las nuevas no cuentan (no se iniciaron).
    // Si nada corre, la nota queda En Espera (reabre una nota LISTA para poder
    // iniciarla).
    const nuevoEstado = await faseProcesoDeNota(client, id);
    await client.query('UPDATE notas SET estado = $1 WHERE id = $2', [nuevoEstado, id]);
    // Si el cambio movió el total y la nota ya estaba pagada, el cobro deja de
    // corresponder: vuelve a PENDIENTE para cobrarla por el importe nuevo.
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
// Cambia una máquina ASIGNADA PERO SIN INICIAR de una carga por otra disponible
// del mismo tipo (lavadora↔lavadora, secadora↔secadora). Re-tarifa la carga con
// la nueva máquina (p. ej. secadora mediana→jumbo cambia el precio) y recalcula
// el total. No aplica a máquinas ya en uso: primero hay que detenerlas.
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
      'SELECT estado FROM notas WHERE id = $1 AND sucursal = $2 FOR UPDATE',
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

    // La máquina actual debe estar asignada, disponible (sin iniciar) y en la sucursal.
    const { rows: actRows } = await client.query(
      'SELECT id, nombre, tipo, estado FROM maquinas WHERE id = $1 AND sucursal = $2 FOR UPDATE',
      [maquina_actual_id, req.sucursal]
    );
    if (actRows.length === 0) {
      await client.query('ROLLBACK');
      return res.status(400).json({ message: 'La máquina actual no existe.' });
    }
    // Si la máquina está en uso puede ser por ESTA nota (hay que detenerla
    // antes) o por OTRA que se le adelantó al iniciar: en ese caso justamente
    // hay que poder cambiarla, que es lo que pide el aviso de Salidas.
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

    // La carga que usa esa máquina.
    const { rows: cargaRows } = await client.query(
      `SELECT id, tipo_prenda FROM nota_cargas WHERE nota_id = $1 AND ${cargaCol} = $2 FOR UPDATE`,
      [id, maquina_actual_id]
    );
    if (cargaRows.length === 0) {
      await client.query('ROLLBACK');
      return res.status(400).json({ message: 'La máquina no está asignada a esta nota.' });
    }
    const carga = cargaRows[0];

    // La máquina nueva: disponible, del mismo tipo y en la sucursal.
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
    if (!esSecadora && String(carga.tipo_prenda).toUpperCase() === 'EDREDON' && nueva.tipo !== 'lavadora_jumbo') {
      await client.query('ROLLBACK');
      return res.status(400).json({ message: 'Los edredones solo van en lavadora jumbo.' });
    }

    const t = await tarifasCarga(client);
    const precio = esSecadora
      ? tarifaSecadora(nueva.tamano, carga.tipo_prenda, t)
      : tarifaLavadora(nueva.tipo, carga.tipo_prenda, t);

    await registrarMaquinaEnCarga(client, carga.id, esSecadora ? 'secadora' : 'lavadora',
      maquina_nueva_id, 'reemplazo');
    await client.query(
      `UPDATE nota_cargas SET ${cargaCol} = $1, ${usadaCol} = $1, ${precioCol} = $2 WHERE id = $3`,
      [maquina_nueva_id, precio, carga.id]
    );
    // Si el cambio movió el total y la nota ya estaba pagada, el cobro deja de
    // corresponder: vuelve a PENDIENTE para cobrarla por el importe nuevo.
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
// Termina el lavado de UNA lavadora de la nota y arranca su secado: libera
// esa lavadora, marca en uso la secadora elegida (obligatoria) y la asigna a
// las cargas que lavó esa lavadora. Cada carga es independiente: las demás
// lavadoras de la nota no se tocan. Cobra la tarifa de secado de esas cargas
// (el secado es un cargo aparte del lavado), así que el total sube. Si era la
// última lavadora la nota pasa a SECANDO, y a LISTA cuando termine la última
// carga que le quede pendiente (ver terminarSecado).
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
      'SELECT estado FROM notas WHERE id = $1 AND sucursal = $2 FOR UPDATE',
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
      'SELECT tipo, tamano, estado FROM maquinas WHERE id = $1 AND sucursal = $2 FOR UPDATE',
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

    // La lavadora debe pertenecer a alguna carga de la nota.
    const { rows: cargasLav } = await client.query(
      'SELECT id FROM nota_cargas WHERE nota_id = $1 AND lavadora_id = $2 FOR UPDATE',
      [id, lavadora_id]
    );
    if (cargasLav.length === 0) {
      await client.query('ROLLBACK');
      return res.status(400).json({ message: 'La lavadora no está asignada a esta nota.' });
    }

    // La secadora hereda las cargas de esa lavadora y cobra su tarifa de secado
    // según el TAMAÑO de la secadora (prenda edredón manda sobre el tamaño). Se
    // tarifa aquí porque en Autoservicio la carga nace solo con lavadora
    // (precio_secadora en 0) y el secado se cobra al iniciarlo.
    const t = await tarifasCarga(client);
    const { rows: cargasMover } = await client.query(
      `SELECT nc.id, nc.tipo_prenda
         FROM nota_cargas nc
        WHERE nc.nota_id = $1 AND nc.lavadora_id = $2 AND nc.secadora_id IS NULL
        FOR UPDATE OF nc`,
      [id, lavadora_id]
    );
    for (const c of cargasMover) {
      await registrarMaquinaEnCarga(client, c.id, 'secadora', secadora_id);
      await client.query(
        `UPDATE nota_cargas SET secadora_id = $1, secadora_usada_id = $1, precio_secadora = $2 WHERE id = $3`,
        [secadora_id, tarifaSecadora(secadoraTamano, c.tipo_prenda, t), c.id]
      );
    }
    // ...y la lavadora se desvincula y libera: queda libre para el siguiente
    // cliente y no debe re-liberarse (ni frenar el secado) si otra nota la
    // toma. El cobro del lavado ya quedó guardado en precio_lavadora.
    await client.query(
      'UPDATE nota_cargas SET lavadora_id = NULL WHERE nota_id = $1 AND lavadora_id = $2',
      [id, lavadora_id]
    );
    await client.query(
      `UPDATE maquinas SET estado = 'disponible', en_uso_desde = NULL
        WHERE id = $1 AND estado = 'en_uso'`,
      [lavadora_id]
    );

    // La secadora entra en uso y su ciclo arranca ahora. Se sella su ciclo
    // según la categoría de la carga (la lavadora que la lavó, ya en
    // lavadora_usada_id, define mediana/jumbo; la prenda, edredón).
    await client.query(
      `UPDATE maquinas SET estado = 'en_uso', en_uso_desde = NOW() WHERE id = $1`,
      [secadora_id]
    );
    await marcarMaquinasIniciadas(client, id, [secadora_id]);
    // La secadora puede ser de un modelo que pregunta su duración (mig. 120):
    // este es el otro camino que la arranca, así que también la acepta.
    const leido = await tiempoElegidoDeMaquina(client, secadora_id, minutos);
    if (leido?.error) {
      await client.query('ROLLBACK');
      return res.status(400).json({ message: leido.error });
    }
    await sellarCicloMaquinas(client, id, leido ? { maquinaId: secadora_id, minutos: leido.minutos } : null);
    // Si era la última lavadora, la nota pasa a SECANDO; si otras cargas
    // siguen en lavadora, continúa LAVANDO.
    const fase = await faseProcesoDeNota(client, id);
    await client.query('UPDATE notas SET estado = $1 WHERE id = $2', [fase, id]);

    // El secado recién cobrado sube el total; se recalcula y se valida que
    // ninguna carga rebase su tope.
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
    console.error('terminarLavado error:', err);
    res.status(500).json({ message: 'No se pudo terminar el lavado. Intenta de nuevo.' });
  } finally {
    client.release();
  }
};

// ── PATCH /notas/:id/terminar-secado ────────────────────────
// Termina el secado de UNA secadora de la nota: la libera y la desvincula.
// Si era la última máquina en uso de la nota, la nota pasa a LISTA
// ("Por Entregar"); si otras cargas siguen lavando o secando, la nota
// continúa en proceso.
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

    // Desvincular y liberar la secadora: queda libre para el siguiente
    // cliente y no debe re-liberarse si otra nota la toma.
    await client.query(
      'UPDATE nota_cargas SET secadora_id = NULL WHERE nota_id = $1 AND secadora_id = $2',
      [id, secadora_id]
    );
    await client.query(
      `UPDATE maquinas SET estado = 'disponible', en_uso_desde = NULL
        WHERE id = $1 AND estado = 'en_uso'`,
      [secadora_id]
    );

    // ¿Era la última máquina de la nota? Entonces la nota está lista.
    const restantes = await maquinasDeNota(client, id);
    const { rowCount: enUso } = restantes.length === 0
      ? { rowCount: 0 }
      : await client.query(
          `SELECT id FROM maquinas WHERE id = ANY($1) AND estado = 'en_uso'`,
          [restantes]
        );
    if (enUso === 0) {
      // Sin máquinas corriendo la nota se cierra SOLO si ya no le falta ninguna
      // carga; si falta alguna, vuelve a su fase real (En Espera).
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
// Finaliza una carga de Autoservicio cuya máquina es una LAVADORA, SIN pasar a
// secado (en Autoservicio cada carga es una sola máquina independiente). Libera
// la lavadora y, si con eso la nota ya no tiene NINGUNA carga pendiente, la
// deja LISTA; si queda trabajo (otra máquina corriendo, o una carga que aún no
// arranca), recalcula la fase. Espejo de terminarSecado para el slot lavadora.
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

    // Desvincular y liberar la lavadora (queda libre para el siguiente cliente).
    await client.query(
      'UPDATE nota_cargas SET lavadora_id = NULL WHERE nota_id = $1 AND lavadora_id = $2',
      [id, lavadora_id]
    );
    await client.query(
      `UPDATE maquinas SET estado = 'disponible', en_uso_desde = NULL
        WHERE id = $1 AND estado = 'en_uso'`,
      [lavadora_id]
    );

    // ¿Quedan máquinas en uso? Si no, la nota está lista; si sí, se recalcula fase.
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

  // Cobrar exige saber CÓMO se pagó: sin este dato el corte de caja no puede
  // distinguir el dinero del cajón de las transferencias y tarjetas, y el
  // faltante aparente sale a costa del empleado en turno.
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

    // Autoservicio sin máquina asignada no se puede cobrar (2026-09-25): su
    // carga todavía no vale nada (se tarifa al asignar en Salidas), así que el
    // cobro entraría en $0 y al asignar la máquina el total subiría y la nota
    // volvería sola a PENDIENTE — con el corte ya cerrado, ni eso se podría.
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
    }

    const esReversion = actual.estado_pago === 'PAGADO' && estado_pago === 'PENDIENTE';
    if (esReversion && !esAdmin(req.user.rol)) {
      await client.query('ROLLBACK');
      return res.status(403).json({ message: 'Solo un administrador puede revertir un pago.' });
    }
    // Deshacer un cobro es el vector directo para desaparecer una venta: el
    // motivo es obligatorio y viaja al aviso de la campana, para que se pueda
    // revisar después sin interrogar a nadie.
    const motivoReversion = String(req.body?.motivo ?? '').trim().slice(0, 200);
    if (esReversion && !motivoReversion) {
      await client.query('ROLLBACK');
      return res.status(400).json({ message: 'Escribe por qué se revierte el pago.' });
    }
    // Solo se revierte mientras el cobro siga en la caja abierta (o si entró
    // sin caja: entonces no está en ningún corte). Con el corte ya cerrado las
    // cifras quedaron congeladas (mig. 101): la venta seguiría contada ahí y
    // volver a cobrar la nota la sumaría otra vez en la caja de hoy.
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

    // Revertir el pago tiene que devolver también el DINERO, y desde el
    // 2026-09-26 el dinero entra por los abonos: cobrar una nota de un tirón
    // registra un abono por el total y la marca pagada sola. Sin esto, la nota
    // volvía a PENDIENTE con sus abonos vivos y quedaba "Pendiente de cobro
    // $0.00 · Abonado $140 de $140": marcada como que debe, sin deber nada.
    //
    // Se revierten TODOS los abonos vivos: revertir el pago es decir "esta nota
    // no está cobrada", así que no puede quedar dinero suyo contado en ningún
    // corte. Para deshacer solo una parte —un adelanto mal capturado— está el
    // botón de cada abono, que es más fino y pide su propio motivo.
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
      // Un abono que ya entró en un corte CERRADO no se deshace, igual que un
      // cobro (mig. 101). Y esta es la única puerta que lo vigilaba: el cobro
      // por abonos no deja `notas.caja_id`, así que el control de arriba ni se
      // asomaba a este dinero.
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

    // Al revertir un pago la forma deja de aplicar y se limpia, para que no
    // quede una nota PENDIENTE marcada como pagada en efectivo.
    const { rows } = await client.query(
      'UPDATE notas SET estado_pago = $1, forma_pago = $2, caja_id = $4 WHERE id = $3 RETURNING *',
      [estado_pago, estado_pago === 'PAGADO' ? formaPago : null, id,
       estado_pago === 'PAGADO' ? actual.caja_id : null]
    );
    if (esReversion) {
      await registrarReversionPago(client, actual, req.user.id, req.sucursal, motivoReversion, abonosRevertidos);
    }

    // Autoservicio que esperaba el cobro en "Por Entregar": al liquidarlo ya no
    // queda nada que hacer —el cliente se llevó su ropa cuando terminó su
    // carga—, así que la nota se cierra sola en vez de pedir un "Finalizar" que
    // solo es un trámite. Es la misma regla de `estadoAlTerminarCargas`, que
    // hasta ahora solo corría al terminar la última carga; desde que el pago
    // dejó de ser obligatorio para arrancar (2026-09-23), el cobro puede llegar
    // después y es aquí donde la nota queda sin pendientes.
    //
    // Se exige estado LISTA para no re-consumir el stock de una nota que ya se
    // cerró (FINALIZADA consume al cerrar), y que no le falte ninguna carga.
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
// Corrige la forma de pago de una nota YA COBRADA, para cuando el empleado se
// equivocó al registrarla (marcó efectivo y el cliente pagó por transferencia).
//
// Solo se permite mientras la caja donde se cobró siga ABIERTA. Con la caja
// abierta el corte se calcula en vivo desde `notas.caja_id` + `forma_pago`, así
// que corregir aquí arregla el corte y Ventas sin tocar nada más. Con la caja
// ya cerrada las cifras quedaron congeladas (mig. 101): cambiar la forma de
// pago movería Ventas pero no el corte, y ambos dirían cosas distintas.
//
// No se usa "revertir el pago y volver a cobrar" para esto: al cobrar de nuevo,
// el trigger ata la nota a la caja abierta HOY, y la venta se movería del día
// en que se cobró al día de la corrección.
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

    // El cambio y su rastro van juntos: es dinero moviéndose entre columnas del
    // corte, no puede quedar uno sin el otro (mig. 102).
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
// Guarda un teléfono de contacto a nivel nota (para el ticket de Autoservicio,
// que es de mostrador y no lleva cliente). Se normaliza a solo dígitos; vacío = null.
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

    // La unidad/precio/medidas se resuelven según el servicio (botella o medida).
    let fila;
    try {
      fila = await reservarProducto(client, id, null, producto_id, cantidad, req.sucursal, notaRows[0].tipo_servicio);
    } catch (e) {
      await client.query('ROLLBACK');
      return res.status(400).json({ message: e.message });
    }

    // Si el cambio movió el total y la nota ya estaba pagada, el cobro deja de
    // corresponder: vuelve a PENDIENTE para cobrarla por el importe nuevo.
    await recalcularPrecioTotal(client, id, {
      desmarcarPagoSiCambia: true, usuarioId: req.user?.id, sucursal: req.sucursal,
    });

    // El tope manda también aquí. En Por Encargo el granel y las bolsas que se
    // agregan son material del servicio, así que gastan de su precio: sin esta
    // comprobación, lo que el alta no deja servir se podía servir igual desde
    // Salidas, que es la otra puerta para agregar productos.
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
// El granel de un tipo (Jabón, Suavizante…) dentro de un servicio Por Encargo
// (migs. 133 y 134). El empleado lo elige en Salidas: qué producto y cuántas
// medidas. Sirve igual para el que está por elegir que para cambiar uno ya
// elegido: lo que había de ese tipo en el servicio se suelta (devuelve lo
// apartado) y se pone lo nuevo. Sin producto, el tipo vuelve a quedar por
// elegir con la cantidad dada.
export const elegirGranelDeCarga = async (req, res) => {
  const { id, cargaId, tipoId } = req.params;
  const { producto_id } = req.body ?? {};
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
    for (const np of previos) {
      await client.query(
        'UPDATE productos SET stock_reservado = GREATEST(0, stock_reservado - $2) WHERE id = $1',
        [np.producto_id, Number(np.cantidad_medidas) || 0]
      );
      await client.query('DELETE FROM nota_productos WHERE id = $1', [np.id]);
    }
    await client.query(
      'DELETE FROM nota_carga_pendientes WHERE carga_id = $1 AND tipo_granel_id = $2',
      [cargaId, tipoId]
    );

    let fila = null;
    if (producto_id) {
      // Solo un granel líquido de ESE tipo: es lo que el servicio pide.
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
    // El granel del servicio gasta de su precio, igual que al agregarlo.
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
export const removeProductoFromNota = async (req, res) => {
  const { id, productoId } = req.params;

  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    const { rows: npRows } = await client.query(
      `SELECT np.*, n.estado AS nota_estado FROM nota_productos np
       JOIN notas n ON n.id = np.nota_id AND n.sucursal = $3
       WHERE np.nota_id = $1 AND np.producto_id = $2`,
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

    await client.query(
      'DELETE FROM nota_productos WHERE nota_id = $1 AND producto_id = $2',
      [id, productoId]
    );

    await client.query(
      'UPDATE productos SET stock_reservado = stock_reservado - $1 WHERE id = $2',
      [np.cantidad_medidas, productoId]
    );

    // Si el cambio movió el total y la nota ya estaba pagada, el cobro deja de
    // corresponder: vuelve a PENDIENTE para cobrarla por el importe nuevo.
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
// Cambia la CANTIDAD de un producto que la nota ya tiene. Es lo que hacen los
// botones + y − de Salidas: agregar otra vez sumaba, pero no había forma de
// servir menos sin borrar el renglón y volver a ponerlo (y eso, además, es de
// admin). La cantidad viaja completa, no un delta: dos empleados tocando los
// botones a la vez terminan en el número que se ve, no en la suma de los dos.
//
// El precio unitario NO se recalcula: es el que se congeló al ponerlo, igual
// que hace `reservarProducto` al sumar. Lo que se ajusta es la reserva del
// inventario, y por eso se valida que alcance.
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
       WHERE np.nota_id = $1 AND np.producto_id = $2`,
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

    // Las medidas por unidad salen de lo que ya está guardado: así una botella
    // sigue valiendo las mismas medidas aunque el catálogo haya cambiado después.
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
      'UPDATE nota_productos SET cantidad = $1, cantidad_medidas = $2 WHERE nota_id = $3 AND producto_id = $4',
      [cantidad, medidasNuevas, id, productoId]
    );
    await client.query(
      'UPDATE productos SET stock_reservado = stock_reservado + $1 WHERE id = $2',
      [delta, productoId]
    );

    // Si el cambio movió el total y la nota ya estaba pagada, el cobro deja de
    // corresponder: vuelve a PENDIENTE para cobrarla por el importe nuevo.
    await recalcularPrecioTotal(client, id, {
      desmarcarPagoSiCambia: true, usuarioId: req.user?.id, sucursal: req.sucursal,
    });

    // El tope manda igual que al agregar: servir más desde aquí no puede pasarse
    // de lo que el servicio cobra.
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

// ── Abonos (pagos parciales, mig. 121) ──────────────────────
//
// Por Encargo el cliente suele adelantar una parte al dejar la ropa. El abono
// es dinero que entró HOY: se guarda con la caja abierta de su sucursal, y el
// corte de ese día lo cuenta. Al liquidar la nota solo entra lo que faltaba, así
// que cada peso se cuenta una sola vez y en el corte que le toca.
//
// Cuando los abonos cubren el total, la nota se marca PAGADA sola: nadie tiene
// que apretar Liquidar para cerrar algo que ya está cobrado.

// Suma de lo abonado (sin los revertidos) de una nota.
async function totalAbonado(client, notaId) {
  const { rows } = await client.query(
    `SELECT COALESCE(SUM(monto), 0) AS abonado
       FROM nota_abonos WHERE nota_id = $1 AND revertido_at IS NULL`,
    [notaId]
  );
  return Number(rows[0].abonado);
}

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

    // Nunca se abona de más: lo que sobra sería dinero que la nota no debe.
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

    // La caja abierta de la sucursal, que es donde entra este dinero. Sin caja
    // abierta el abono se registra igual (queda fuera de todo corte, como un
    // cobro sin caja).
    const { rows: cajaRows } = await client.query(
      `SELECT id FROM cajas WHERE estado = 'abierta' AND sucursal = $1 LIMIT 1`,
      [req.sucursal]
    );
    const cajaId = cajaRows[0]?.id ?? null;

    const { rows: abonoRows } = await client.query(
      `INSERT INTO nota_abonos (nota_id, caja_id, usuario_id, monto, forma_pago)
       VALUES ($1, $2, $3, $4, $5) RETURNING *`,
      [id, cajaId, req.user?.id ?? null, importe, formaPago]
    );

    // ¿Quedó cubierta? Entonces la nota se cobra sola, con la forma de este
    // último abono (es el que la terminó de pagar).
    const cubierta = importe >= saldo - 1e-9;
    if (cubierta) {
      await client.query(
        `UPDATE notas SET estado_pago = 'PAGADO', forma_pago = $2 WHERE id = $1`,
        [id, formaPago]
      );
      // Mismo cierre que al liquidar: un Autoservicio que ya terminó sus cargas
      // no tiene nada que entregar, así que queda finalizado.
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

// Deshace un abono mal capturado. Es de admin y pide motivo, como revertir un
// pago: el abono no se borra, se marca revertido con quién y por qué. Solo
// mientras la caja donde entró siga abierta —con el corte cerrado sus cifras ya
// quedaron congeladas (mig. 101)—, y si el abono había dejado la nota pagada,
// esta vuelve a deber.
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
      `SELECT ab.id, ab.monto, ab.caja_id, ab.revertido_at, n.estado_pago, n.id AS nota_id
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
//
// Deshace la ENTREGA de una nota: la nota finalizada vuelve a "Por Entregar",
// tal como estaba antes de confirmar que el cliente se la llevó (2026-09-25).
// Es para el error de mostrador —se marcó entregada la nota equivocada, o el
// cliente no se llevó todo—, así que es de admin.
//
// El producto de la nota NO vuelve al inventario: ya se usó en ella (2026-09-25).
// Tampoco se vuelve a descontar si la nota se entrega otra vez: el consumo queda
// marcado en el historial de inventario y solo ocurre una vez. El cobro tampoco
// se toca: reabrir la entrega no deshace el pago.
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
//
// Ajuste de la nota desde Salidas (2026-09-25): un descuento (negativo) o un
// cargo extra (positivo) sobre el total. Se captura donde se atiende la nota,
// que es donde aparece el motivo real ("le rebajo $20 porque una prenda se
// manchó"), y sale impreso en el ticket.
//
// Si la nota ya estaba cobrada y el ajuste mueve su total, el cobro deja de
// corresponder y la nota vuelve a PENDIENTE por el importe nuevo — la misma
// regla que al cambiar cualquier otra cosa que cuesta dinero. Con el cobro
// congelado en un corte cerrado no se permite.
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
    // Un descuento no puede dejar la nota en números rojos.
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
