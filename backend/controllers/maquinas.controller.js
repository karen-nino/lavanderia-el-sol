import pool from '../db/pool.js';
import { sellarPasadasVivas } from '../db/pasadas.js';
import { TZ_NEGOCIO, esFechaISO } from '../utils/tz.js';
import * as dispositivos from '../services/dispositivos/index.js';
import { explicarFalla, resumirMotivo } from '../services/dispositivos/mensajes.js';
import { MINUTOS_CONFIGURADOS, TIEMPOS_DEL_MODELO, OPCIONES_DE_MARCA, MINUTOS_POR_FICHA, TOPE_RELOJ, esCronometroSql, conIniciarSql, soloFichasSql } from '../db/sqlMaquina.js';
import {
  HORAS_ENCENDIDO_MANUAL,
  PAUSA_OTRO_CICLO_SEGUNDOS,
  maxCiclosDeMaquina,
  instanteOtroCiclo,
  finCiclo,
  esperandoArranque,
  sincronizarSonoff,
  opcionesMasTiempo,
  programaTerminado,
  meterFichasExtra,
} from '../services/sincronizarSonoff.js';
import { esAdmin } from '../middleware/roles.js';

const ESTADOS_VALIDOS = ['disponible', 'en_uso', 'mantenimiento'];
const TIPOS_VALIDOS   = ['lavadora_mediana', 'lavadora_jumbo', 'secadora'];
const CAPACIDADES_VALIDAS = ['20kg', '35kg'];
const TAMANOS_VALIDOS = ['mediana', 'jumbo'];

/** ['lavadora_mediana', 'secadora'] → "lavadora mediana o secadora" */
const enPalabras = (valores) => {
  const legibles = valores.map((v) => v.replace(/_/g, ' '));
  if (legibles.length <= 1) return legibles.join('');
  return `${legibles.slice(0, -1).join(', ')} o ${legibles.at(-1)}`;
};

/** device_id del Sonoff en eWeLink: recortado, o null si viene vacío. */
const normalizarDeviceId = (v) => {
  if (v == null) return null;
  const s = String(v).trim();
  return s === '' ? null : s;
};

/** Canal del Sonoff multi-relé: entero >= 0, o null. */
const normalizarDeviceCanal = (v) => {
  if (v == null || v === '') return null;
  const n = Number(v);
  return Number.isInteger(n) && n >= 0 ? n : null;
};

/**
 * Un relé no puede estar enlazado a dos máquinas (apagaría la equivocada). Se
 * busca en todas las sucursales; el mismo device_id con otro canal sí vale.
 * @returns {Promise<string|null>} nombre de la máquina que ya lo usa, o null.
 */
const buscarMaquinaConMismoDevice = async (deviceId, deviceCanal, excluirId = null) => {
  if (!deviceId) return null;
  const { rows } = await pool.query(
    `SELECT nombre FROM maquinas
      WHERE device_id = $1
        AND device_canal IS NOT DISTINCT FROM $2
        AND ($3::int IS NULL OR id <> $3::int)
      LIMIT 1`,
    [deviceId, deviceCanal, excluirId]
  );
  return rows[0]?.nombre ?? null;
};

/** Con el driver de simulación las pruebas de enlace no prueban nada. */
const simulacionActiva = (maq) => dispositivos.esSimulacion(maq);

const MSG_SIMULACION =
  'Modo simulación: la app no está conectada a los Sonoff reales, así que esta ' +
  'prueba no comprueba nada y las máquinas tampoco van a encender ni apagar solas. ' +
  'Para activarlo hay que configurar eWeLink en el servidor (DISPOSITIVOS_DRIVER=ewelink) ' +
  'y, si se limita por sucursal, incluir esta en DISPOSITIVOS_SUCURSALES.';

/** Guarda el estado del enlace y, si falló, el motivo para la tarjeta. */
const guardarEnlace = async (id, ok, motivo) => {
  const { rows } = await pool.query(
    `UPDATE maquinas SET sonoff_estado = $1, sonoff_detalle = $2, sonoff_sync_at = NOW()
      WHERE id = $3 RETURNING *`,
    [ok ? 'enlazada' : 'error', ok ? null : resumirMotivo(motivo), id]
  );
  return rows[0];
};

/** Pulso de la prueba física: se ve arrancar, sin iniciar un ciclo. */

const esperar = (ms) => new Promise(resolve => setTimeout(resolve, ms));

/** Apaga con reintentos: un apagado fallido deja una máquina andando sola. */
const INTENTOS_APAGADO = 3;
async function apagarConReintentos(maq) {
  let ultimo;
  for (let i = 1; i <= INTENTOS_APAGADO; i++) {
    ultimo = await dispositivos.apagar(maq);
    if (ultimo.ok) {
      if (i > 1) console.log(`[maquinas] apagado de ${maq.nombre} logrado en el intento ${i}`);
      return ultimo;
    }
    console.warn(`[maquinas] intento ${i}/${INTENTOS_APAGADO} de apagar ${maq.nombre} falló: ${ultimo.motivo}`);
    if (i < INTENTOS_APAGADO) await esperar(1000);
  }
  return ultimo;
}

const mensajeDeviceDuplicado = (nombre, deviceCanal) =>
  `Ese ID de Sonoff ya está asignado a "${nombre}"` +
  (deviceCanal != null ? ` (canal ${deviceCanal})` : '') +
  '. Usa un ID distinto o, si es un dispositivo multi-relé, indica otro canal.';

/**
 * Agrega lo que la tarjeta necesita para "otro ciclo" (se calcula aquí porque
 * depende de configuración del servidor):
 * - ciclos_carga: ciclos que lleva la carga.
 * - ciclos_max: tope de ciclos ("ciclo 1 de 2").
 * - otro_ciclo_desde: cuándo se le puede volver a dar corriente (ISO).
 * - esperando_arranque: tiene corriente y falta "Iniciar".
 * - opciones_mas_tiempo: programas que caben en la secadora de fichas.
 */
const conDatosDeOtroCiclo = (m) => {
  const ciclos = m.ciclos_carga ?? null;
  const desde = instanteOtroCiclo(m);
  // Necesita `minutos_ciclo` y `ciclo_unico` en la fila (ver getMaquinas).
  const maxCiclos = maxCiclosDeMaquina(m);
  return {
    ...m,
    ciclos_carga: ciclos,
    ciclos_max: maxCiclos,
    esperando_arranque: esperandoArranque(m),
    opciones_mas_tiempo: opcionesMasTiempo(m),
    otro_ciclo_desde:
      ciclos != null && ciclos < maxCiclos && desde != null
        ? new Date(desde).toISOString()
        : null,
  };
};

export const getMaquinas = async (req, res) => {
  try {
    // Además del estado:
    // - reservada: libre pero asignada a otra nota abierta que aún no la arranca.
    // - en_uso_folio: la nota que la está usando, la que le dio a Iniciar
    //   (asignar no aparta).
    const { rows } = await pool.query(
      `SELECT m.*,
              ${MINUTOS_CONFIGURADOS} AS minutos_ciclo,
              -- Programas del modelo y si se pregunta cuál al iniciar.
              ${TIEMPOS_DEL_MODELO} AS modelo_tiempos,
              -- Opciones del modelo (dos ciclos).
              ${OPCIONES_DE_MARCA} AS marca_opciones,
              -- Cronómetro: la tarjeta cuenta hacia arriba y ofrece Finalizar.
              ${esCronometroSql('m')} AS cronometro,
              -- Cronómetro que arranca con "Iniciar" y no al encender.
              ${conIniciarSql('m')} AS con_iniciar,
              -- Secadora de fichas: su "Otro ciclo" suma programas.
              ${MINUTOS_POR_FICHA} AS minutos_por_ficha,
              -- Alias para tablets con una versión anterior de la app.
              ${MINUTOS_POR_FICHA} AS minutos_por_moneda,
              -- Solo fichas: sin Sonoff ni tope.
              ${soloFichasSql('m')} AS solo_fichas,
              (r.folio IS NOT NULL) AS reservada,
              r.folio               AS reservada_folio,
              r.id                  AS reservada_nota_id,
              u.folio               AS en_uso_folio,
              u.id                  AS en_uso_nota_id,
              c.ciclos              AS ciclos_carga,
              c.ciclo_unico         AS ciclo_unico
         FROM maquinas m
         LEFT JOIN LATERAL (
           SELECT n.id, n.folio
             FROM notas n
            WHERE m.estado = 'disponible'
              AND n.estado IN ('EN_ESPERA', 'LAVANDO', 'SECANDO')
              AND EXISTS (
                SELECT 1 FROM nota_cargas nc
                 WHERE nc.nota_id = n.id
                   AND (nc.lavadora_id = m.id OR nc.secadora_id = m.id)
              )
            ORDER BY n.created_at ASC
            LIMIT 1
         ) r ON TRUE
         LEFT JOIN LATERAL (
           SELECT n.id, n.folio
             FROM notas n
             JOIN nota_cargas nc ON nc.nota_id = n.id
            WHERE m.estado = 'en_uso'
              AND n.estado IN ('EN_ESPERA', 'LAVANDO', 'SECANDO')
              AND (
                -- La arrancó esta nota, o la encendió y espera su arranque.
                (nc.lavadora_id = m.id
                 AND (nc.lavadora_iniciada_at IS NOT NULL OR m.encendida_para_nota_id = n.id))
                OR (nc.secadora_id = m.id
                    AND (nc.secadora_iniciada_at IS NOT NULL OR m.encendida_para_nota_id = n.id))
              )
            -- La última en arrancarla; la encendida sin arrancar va al final.
            ORDER BY (CASE WHEN nc.lavadora_id = m.id THEN nc.lavadora_iniciada_at
                           ELSE nc.secadora_iniciada_at END) DESC NULLS LAST
            LIMIT 1
         ) u ON TRUE
         -- Ciclos de la carga que corre en esta máquina (arrancada por su nota).
         LEFT JOIN LATERAL (
           SELECT CASE WHEN nc.lavadora_id = m.id THEN nc.lavadora_ciclos
                       ELSE nc.secadora_ciclos END AS ciclos,
                  -- ¿Esta vuelta es de un solo ciclo? (lo marca cada vuelta).
                  COALESCE((
                    SELECT ncm.ciclo_unico FROM nota_carga_maquinas ncm
                     WHERE ncm.carga_id = nc.id
                       AND ncm.slot = CASE WHEN nc.lavadora_id = m.id THEN 'lavadora' ELSE 'secadora' END
                     ORDER BY ncm.asignada_at DESC, ncm.id DESC LIMIT 1
                  ), FALSE) AS ciclo_unico
             FROM nota_cargas nc
             JOIN notas n ON n.id = nc.nota_id
            WHERE m.estado = 'en_uso'
              AND n.estado IN ('EN_ESPERA', 'LAVANDO', 'SECANDO')
              AND ((nc.lavadora_id = m.id AND nc.lavadora_iniciada_at IS NOT NULL)
                OR (nc.secadora_id = m.id AND nc.secadora_iniciada_at IS NOT NULL))
            ORDER BY n.created_at ASC
            LIMIT 1
         ) c ON TRUE
        WHERE m.sucursal = $1
        ORDER BY m.tipo ASC, m.nombre ASC`,
      [req.sucursal]
    );
    res.json(rows.map(conDatosDeOtroCiclo));
  } catch (err) {
    console.error('getMaquinas error:', err);
    res.status(500).json({ message: 'No se pudieron cargar las máquinas. Intenta de nuevo.' });
  }
};

// ── GET /maquinas/:id/uso ───────────────────────────────────
/** Orden de las máquinas en el reporte: lavadoras, luego secadoras; por nombre con números. */
const ORDEN_TIPO_MAQUINA = { lavadora_mediana: 0, lavadora_jumbo: 1, secadora: 2 };

/**
 * Reporte diario de máquinas (cualquier rol): por máquina, las vueltas que
 * arrancaron ese día, el tiempo encendida, las veces al tope y lo generado.
 * Lo generado sigue la regla de Uso de máquina: la primera vuelta de cada
 * hueco vale lo cobrado; una vuelta más o sin cobro aparte, la tarifa de
 * Ajustes. Sin notas canceladas; el día es el local (America/Mexico_City).
 */
export const getReporteDiarioMaquinas = async (req, res) => {
  const hoyMx = new Date().toLocaleDateString('en-CA', { timeZone: TZ_NEGOCIO });
  const fecha = esFechaISO(req.query.fecha) ? req.query.fecha : hoyMx;

  try {
    const { rows: maquinas } = await pool.query(
      `SELECT id, nombre, tipo, tamano, estado FROM maquinas WHERE sucursal = $1`,
      [req.sucursal]
    );
    const { rows: pasadas } = await pool.query(
      `WITH bounds AS (
         SELECT ($2::date)::timestamp      AT TIME ZONE '${TZ_NEGOCIO}' AS inicio,
                ($2::date + 1)::timestamp  AT TIME ZONE '${TZ_NEGOCIO}' AS cierre
       ),
       -- Todas las vueltas que arrancaron (de cualquier día), numeradas por hueco.
       vueltas AS (
         SELECT ncm.*, nc.nota_id,
                COALESCE(ncm.encendida_at,
                         CASE WHEN ncm.slot = 'lavadora' THEN nc.lavadora_iniciada_at
                              ELSE nc.secadora_iniciada_at END,
                         ncm.asignada_at) AS inicio_at,
                ROW_NUMBER() OVER (PARTITION BY ncm.carga_id, ncm.slot
                                   ORDER BY ncm.asignada_at, ncm.id) AS n_vuelta,
                CASE WHEN ncm.slot = 'lavadora' THEN nc.precio_lavadora ELSE nc.precio_secadora END AS cobrado,
                CASE WHEN ncm.slot = 'lavadora' THEN nc.lavadora_id ELSE nc.secadora_id END AS puesta_id
           FROM nota_carga_maquinas ncm
           JOIN nota_cargas nc ON nc.id = ncm.carga_id
          WHERE ncm.encendida_at IS NOT NULL
             OR (ncm.slot = 'lavadora' AND nc.lavadora_iniciada_at IS NOT NULL)
             OR (ncm.slot = 'secadora' AND nc.secadora_iniciada_at IS NOT NULL)
       )
       SELECT v.id, v.maquina_id, v.slot, v.inicio_at, v.llego_tope,
              n.id AS nota_id, n.folio, n.tipo_servicio,
              -- El cliente o, en Autoservicio, el nombre que se dio (referencia).
              COALESCE(NULLIF(TRIM(COALESCE(c.nombre, '') || ' ' || COALESCE(c.apellido, '')), ''),
                       n.referencia) AS cliente,
              -- Sigue corriendo: la máquina tiene puesta esta carga y no se finalizó.
              (v.finalizada_at IS NULL AND v.puesta_id = m.id AND m.en_uso_desde IS NOT NULL) AS en_curso,
              CASE WHEN v.finalizada_at IS NOT NULL THEN v.finalizada_at END AS fin_at,
              CASE WHEN v.finalizada_at IS NOT NULL AND v.encendida_at IS NOT NULL
                     THEN ROUND(EXTRACT(EPOCH FROM v.finalizada_at - v.encendida_at))::int
                   WHEN v.finalizada_at IS NULL AND v.puesta_id = m.id AND m.en_uso_desde IS NOT NULL
                     THEN ROUND(EXTRACT(EPOCH FROM NOW() - COALESCE(v.encendida_at, m.en_uso_desde)))::int
              END AS segundos,
              CASE WHEN v.n_vuelta = 1 AND v.cobrado > 0 THEN v.cobrado
                   ELSE CASE
                          WHEN COALESCE(v.maquina_tipo, m.tipo::text) = 'secadora'
                               AND COALESCE(v.maquina_tamano, m.tamano::text) = 'jumbo' THEN aj.precio_secadora_jumbo
                          WHEN COALESCE(v.maquina_tipo, m.tipo::text) = 'secadora'       THEN aj.precio_carga_secadora
                          WHEN COALESCE(v.maquina_tipo, m.tipo::text) = 'lavadora_jumbo' THEN aj.precio_carga_jumbo
                          ELSE aj.precio_carga_mediana
                        END
              END AS precio
         FROM vueltas v
         JOIN maquinas m ON m.id = v.maquina_id
         JOIN notas n    ON n.id = v.nota_id
         LEFT JOIN clientes c ON c.id = n.cliente_id
         LEFT JOIN ajustes aj ON aj.id = 1
         , bounds
        WHERE m.sucursal = $1 AND n.estado <> 'CANCELADA'
          AND v.inicio_at >= bounds.inicio AND v.inicio_at < bounds.cierre
        ORDER BY v.inicio_at, v.id`,
      [req.sucursal, fecha]
    );

    const porMaquina = new Map(maquinas.map((m) => [m.id, []]));
    for (const p of pasadas) {
      porMaquina.get(p.maquina_id)?.push({
        id:            p.id,
        slot:          p.slot,
        inicio_at:     p.inicio_at,
        fin_at:        p.fin_at,
        segundos:      p.segundos,
        en_curso:      p.en_curso,
        llego_tope:    p.llego_tope === true,
        precio:        Number(p.precio ?? 0),
        nota_id:       p.nota_id,
        folio:         p.folio,
        tipo_servicio: p.tipo_servicio,
        cliente:       p.cliente || null,
      });
    }

    const orden = (m) => ORDEN_TIPO_MAQUINA[m.tipo] ?? 9;
    res.json({
      fecha,
      maquinas: maquinas
        .sort((a, b) => orden(a) - orden(b) || a.nombre.localeCompare(b.nombre, 'es', { numeric: true }))
        .map((m) => {
          const lista = porMaquina.get(m.id);
          return {
            id: m.id, nombre: m.nombre, tipo: m.tipo, tamano: m.tamano, estado: m.estado,
            usos:     lista.length,
            segundos: lista.reduce((t, p) => t + (p.segundos ?? 0), 0),
            topes:    lista.filter((p) => p.llego_tope).length,
            generado: lista.reduce((t, p) => t + p.precio, 0),
            pasadas:  lista,
          };
        }),
    });
  } catch (err) {
    console.error('getReporteDiarioMaquinas error:', err);
    res.status(500).json({ message: 'No se pudo generar el reporte de máquinas. Intenta de nuevo.' });
  }
};

/**
 * Uso diario de la máquina según las notas que de verdad la arrancaron (sin
 * canceladas): usos, cargas, generado (cobrado), empleados y clientes. Un
 * Autoservicio o un Por Encargo sin cliente cuenta como un cliente. El desglose
 * se arma en JS para que cada número cuadre con su modal.
 */
export const getUsoMaquina = async (req, res) => {
  const id = Number(req.params.id);
  if (!id) return res.status(400).json({ message: 'No se reconoció la máquina.' });

  try {
    const { rows: maq } = await pool.query(
      'SELECT id, nombre, tipo, estado, capacidad, sucursal FROM maquinas WHERE id = $1 AND sucursal = $2',
      [id, req.sucursal]
    );
    if (maq.length === 0) return res.status(404).json({ message: 'Máquina no encontrada.' });

    // Una nota la usó si alguna vuelta de sus cargas corrió en ella (el
    // historial de vueltas, porque lavadora_id se vacía al finalizar).
    const PASADAS_DE_LA_MAQUINA = `
      SELECT ncm.id, ncm.carga_id, ncm.slot, ncm.asignada_at, nc.nota_id,
             ncm.encendida_at, ncm.finalizada_at, ncm.llego_tope
        FROM nota_carga_maquinas ncm
        JOIN nota_cargas nc ON nc.id = ncm.carga_id
       WHERE ncm.maquina_id = $1
         AND (ncm.encendida_at IS NOT NULL
              OR (ncm.slot = 'lavadora' AND nc.lavadora_iniciada_at IS NOT NULL)
              OR (ncm.slot = 'secadora' AND nc.secadora_iniciada_at IS NOT NULL))`;
    const { rows: notas } = await pool.query(
      `SELECT n.id, to_char(n.created_at AT TIME ZONE $2, 'YYYY-MM-DD') AS fecha,
              n.folio, n.tipo_servicio, n.estado,
              n.precio_total, n.estado_pago, n.cliente_id,
              n.usuario_id, TRIM(u.nombre || ' ' || COALESCE(u.apellido, '')) AS empleado_nombre,
              c.nombre AS cliente_nombre, c.apellido AS cliente_apellido
         FROM notas n
         LEFT JOIN usuarios u ON u.id = n.usuario_id
         LEFT JOIN clientes c ON c.id = n.cliente_id
        WHERE n.id IN (SELECT p.nota_id FROM (${PASADAS_DE_LA_MAQUINA}) p)
          AND n.estado <> 'CANCELADA'
        ORDER BY n.created_at DESC`,
      [id, TZ_NEGOCIO]
    );

    // Una fila por vuelta. Lo generado es lo que vale cada vuelta: la primera,
    // lo cobrado a ese hueco; si no se cobró aparte (Por Encargo) o es una
    // vuelta más, la tarifa de la máquina en Ajustes.
    const { rows: cargas } = await pool.query(
      `SELECT nc.nota_id, p.slot,
              CASE WHEN ROW_NUMBER() OVER (PARTITION BY p.carga_id, p.slot
                                           ORDER BY p.asignada_at, p.id) = 1
                        AND (CASE WHEN p.slot = 'lavadora' THEN nc.precio_lavadora
                                  ELSE nc.precio_secadora END) > 0
                   THEN CASE WHEN p.slot = 'lavadora' THEN nc.precio_lavadora
                             ELSE nc.precio_secadora END
                   ELSE CASE
                          WHEN mx.tipo = 'secadora' AND mx.tamano = 'jumbo' THEN aj.precio_secadora_jumbo
                          WHEN mx.tipo = 'secadora'                         THEN aj.precio_carga_secadora
                          WHEN mx.tipo = 'lavadora_jumbo'                   THEN aj.precio_carga_jumbo
                          ELSE aj.precio_carga_mediana
                        END
              END AS precio,
              -- Minutos encendida; si sigue y ya pasó su tope, hasta el tope.
              p.finalizada_at IS NULL AND vivo.al_tope AS tope_vivo,
              CASE WHEN p.finalizada_at IS NOT NULL
                   THEN ROUND(EXTRACT(EPOCH FROM p.finalizada_at - p.encendida_at))::int
                   WHEN vivo.al_tope THEN ${TOPE_RELOJ('mx')} * 60
              END AS segundos,
              p.llego_tope OR (p.finalizada_at IS NULL AND vivo.al_tope) AS tope,
              -- Inicio y fin; la que sigue corriendo usa el arranque de la
              -- máquina y, si ya pasó su tope, el tope como fin.
              COALESCE(p.encendida_at,
                       CASE WHEN (CASE WHEN p.slot = 'lavadora' THEN nc.lavadora_id
                                       ELSE nc.secadora_id END) = $1
                            THEN mx.en_uso_desde END) AS inicio_at,
              COALESCE(p.finalizada_at,
                       CASE WHEN vivo.al_tope
                            THEN mx.en_uso_desde + make_interval(mins => ${TOPE_RELOJ('mx')}) END) AS fin_at,
              ml.nombre AS lav_nombre, ms.nombre AS sec_nombre
         FROM (${PASADAS_DE_LA_MAQUINA}) p
         JOIN nota_cargas nc ON nc.id = p.carga_id
         JOIN notas n ON n.id = nc.nota_id
         JOIN maquinas mx ON mx.id = $1
         LEFT JOIN ajustes aj ON aj.id = 1
         -- ¿Esta pasada sigue corriendo y ya cumplió el tope del cronómetro?
         CROSS JOIN LATERAL (
           SELECT COALESCE(
                    mx.en_uso_desde IS NOT NULL
                    AND mx.ciclo_minutos > 0
                    AND ${esCronometroSql('mx')}
                    AND mx.en_uso_desde + make_interval(mins => ${TOPE_RELOJ('mx')}) <= NOW()
                    AND (CASE WHEN p.slot = 'lavadora' THEN nc.lavadora_id ELSE nc.secadora_id END) = $1,
                  FALSE) AS al_tope
         ) vivo
         LEFT JOIN maquinas ml ON ml.id = COALESCE(nc.lavadora_id, nc.lavadora_usada_id)
         LEFT JOIN maquinas ms ON ms.id = COALESCE(nc.secadora_id, nc.secadora_usada_id)
        WHERE n.estado <> 'CANCELADA'
        ORDER BY nc.nota_id, nc.orden, p.asignada_at, p.id`,
      [id]
    );

    // ── Agregación por día ──────────────────────────────────
    const notaPorId = new Map(notas.map((n) => [n.id, n]));
    const buckets = new Map();
    const getBucket = (fecha) => {
      const k = fecha;
      if (!buckets.has(k)) {
        buckets.set(k, {
          fecha, generado: 0,
          _usos: [],               // { id, folio, tipo_servicio, estado, cliente, precio }
          _cargas: [],             // { folio, descripcion, precio }
          _empleados: new Map(),   // usuario_id -> { nombre, usos }
          _clientesReg: new Map(), // cliente_id -> { nombre, folios }
          _autoservicios: [],      // { folio }
          _mostrador: [],          // { folio }: Por Encargo sin cliente
        });
      }
      return buckets.get(k);
    };

    for (const n of notas) {
      const b = getBucket(n.fecha);
      const clienteNombre = `${n.cliente_nombre ?? ''}${n.cliente_apellido ? ' ' + n.cliente_apellido : ''}`.trim();
      // Cada nota cuenta como un uso.
      b._usos.push({
        id:        n.id,
        folio:     n.folio,
        tipo_servicio: n.tipo_servicio,
        estado:    n.estado,
        cliente:   clienteNombre || null,
        precio:    Number(n.precio_total) || 0,
      });
      // Empleado que operó la máquina.
      if (n.usuario_id) {
        const e = b._empleados.get(n.usuario_id) ?? { nombre: n.empleado_nombre || 'Empleado', usos: 0 };
        e.usos += 1;
        b._empleados.set(n.usuario_id, e);
      }
      // Clientes: cada nota sin cliente cuenta como uno; las demás, por cliente.
      if (n.tipo_servicio === 'AUTOSERVICIO') {
        b._autoservicios.push({ folio: n.folio });
      } else if (n.cliente_id) {
        const cl = b._clientesReg.get(n.cliente_id) ?? { nombre: clienteNombre || 'Cliente', folios: [] };
        cl.folios.push(n.folio);
        b._clientesReg.set(n.cliente_id, cl);
      } else {
        b._mostrador.push({ folio: n.folio });
      }
    }

    for (const c of cargas) {
      const n = notaPorId.get(c.nota_id);
      if (!n) continue;
      const b = getBucket(n.fecha);
      const partes = [c.lav_nombre, c.sec_nombre].filter(Boolean);
      // Lo generado suma cada ciclo de las notas ya cobradas.
      if (n.estado_pago === 'PAGADO') b.generado += Number(c.precio) || 0;
      b._cargas.push({
        folio: n.folio,
        descripcion: partes.join(' + ') || maq[0].nombre,
        precio: Number(c.precio) || 0,
        segundos: c.segundos,
        tope: Boolean(c.tope),
        inicio_at: c.inicio_at,
        fin_at: c.fin_at,
      });
    }

    // Cada nota vale lo que generó en esta máquina, no su total.
    const generadoPorNota = new Map();
    for (const c of cargas) {
      generadoPorNota.set(c.nota_id, (generadoPorNota.get(c.nota_id) ?? 0) + (Number(c.precio) || 0));
    }
    for (const b of buckets.values()) {
      for (const u of b._usos) u.precio = generadoPorNota.get(u.id) ?? 0;
    }

    const diasFmt = [...buckets.values()]
      .sort((a, b) => new Date(b.fecha) - new Date(a.fecha))
      .map((b) => {
        const empleados = [...b._empleados.values()].map((e) => ({ nombre: e.nombre, usos: e.usos }));
        const clientes  = [
          ...b._autoservicios.map((a) => ({ nombre: 'Autoservicio', folios: [a.folio] })),
          ...b._mostrador.map((m) => ({ nombre: 'Mostrador', folios: [m.folio] })),
          ...[...b._clientesReg.values()].map((cl) => ({ nombre: cl.nombre, folios: cl.folios })),
        ];
        return {
          fecha:     b.fecha,
          usos:      b._usos.length,
          generado:  b.generado,
          cargas:    b._cargas.length,
          empleados: empleados.length,
          clientes:  clientes.length,
          detalle:   { usos: b._usos, cargas: b._cargas, empleados, clientes },
        };
      });

    const resumen = diasFmt.reduce(
      (acc, d) => ({
        dias_usada: acc.dias_usada + 1,
        usos:       acc.usos + d.usos,
        cargas:     acc.cargas + d.cargas,
        generado:   acc.generado + d.generado,
      }),
      { dias_usada: 0, usos: 0, cargas: 0, generado: 0 }
    );

    res.json({ maquina: maq[0], resumen, dias: diasFmt });
  } catch (err) {
    console.error('getUsoMaquina error:', err);
    res.status(500).json({ message: 'No se pudo cargar el uso de la máquina. Intenta de nuevo.' });
  }
};

export const createMaquina = async (req, res) => {
  const { nombre, tipo, tamano, marca, modelo, capacidad, numero_serie, fecha_adquisicion, notas, device_id, device_canal } = req.body;

  if (!nombre || !tipo) {
    return res.status(400).json({ message: 'Escribe el nombre y elige el tipo de máquina.' });
  }
  if (!TIPOS_VALIDOS.includes(tipo)) {
    return res.status(400).json({ message: `Elige un tipo de máquina válido: ${enPalabras(TIPOS_VALIDOS)}.` });
  }
  if (tamano != null && tamano !== '' && !TAMANOS_VALIDOS.includes(tamano)) {
    return res.status(400).json({ message: `Elige un tamaño válido: ${enPalabras(TAMANOS_VALIDOS)}.` });
  }
  if (capacidad != null && !CAPACIDADES_VALIDAS.includes(capacidad)) {
    return res.status(400).json({ message: `Elige una capacidad válida: ${enPalabras(CAPACIDADES_VALIDAS)}.` });
  }

  const deviceId = normalizarDeviceId(device_id);
  const deviceCanal = normalizarDeviceCanal(device_canal);
  // Sin dispositivo: 'sin_enlazar'. Con dispositivo: 'sin_probar' hasta que el
  // barrido o "Probar" confirmen que responde.
  const sonoffEstado = deviceId ? 'sin_probar' : 'sin_enlazar';

  try {
    const yaUsado = await buscarMaquinaConMismoDevice(deviceId, deviceCanal);
    if (yaUsado) {
      return res.status(409).json({ message: mensajeDeviceDuplicado(yaUsado, deviceCanal) });
    }

    const { rows } = await pool.query(
      `INSERT INTO maquinas (nombre, tipo, tamano, marca, modelo, capacidad, numero_serie, fecha_adquisicion, sucursal, notas, device_id, device_canal, sonoff_estado)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13)
       RETURNING *`,
      [nombre, tipo, tamano || null, marca || null, modelo, capacidad, numero_serie, fecha_adquisicion, req.sucursal, notas, deviceId, deviceCanal, sonoffEstado]
    );
    res.status(201).json(rows[0]);
  } catch (err) {
    console.error('createMaquina error:', err);
    if (err.code === '22P02') {
      return res.status(400).json({ message: 'Ese tipo de máquina no es válido.' });
    }
    res.status(500).json({ message: 'No se pudo crear la máquina. Intenta de nuevo.' });
  }
};

export const updateMaquina = async (req, res) => {
  const { id } = req.params;
  const { nombre, tipo, tamano, marca, modelo, capacidad, numero_serie, fecha_adquisicion, notas, estado, device_id, device_canal } = req.body;

  if (!nombre || !tipo) {
    return res.status(400).json({ message: 'Escribe el nombre y elige el tipo de máquina.' });
  }
  if (!TIPOS_VALIDOS.includes(tipo)) {
    return res.status(400).json({ message: `Elige un tipo de máquina válido: ${enPalabras(TIPOS_VALIDOS)}.` });
  }
  if (tamano != null && tamano !== '' && !TAMANOS_VALIDOS.includes(tamano)) {
    return res.status(400).json({ message: `Elige un tamaño válido: ${enPalabras(TAMANOS_VALIDOS)}.` });
  }
  if (capacidad != null && !CAPACIDADES_VALIDAS.includes(capacidad)) {
    return res.status(400).json({ message: `Elige una capacidad válida: ${enPalabras(CAPACIDADES_VALIDAS)}.` });
  }
  if (estado != null && !ESTADOS_VALIDOS.includes(estado)) {
    return res.status(400).json({ message: `Elige un estado válido: ${enPalabras(ESTADOS_VALIDOS)}.` });
  }

  const deviceId = normalizarDeviceId(device_id);
  const deviceCanal = normalizarDeviceCanal(device_canal);

  try {
    const yaUsado = await buscarMaquinaConMismoDevice(deviceId, deviceCanal, id);
    if (yaUsado) {
      return res.status(409).json({ message: mensajeDeviceDuplicado(yaUsado, deviceCanal) });
    }

    // `estado` null conserva el actual. El estado del Sonoff según el enlace:
    // sin dispositivo → 'sin_enlazar'; si cambia el device_id o el canal →
    // 'sin_probar' (a reverificar); si no, se conserva. El detalle de la falla
    // anterior se borra.
    const { rows } = await pool.query(
      `UPDATE maquinas
         SET nombre = $1, tipo = $2, tamano = $3, modelo = $4, capacidad = $5, numero_serie = $6, fecha_adquisicion = $7, notas = $8,
             marca = $14,
             estado = COALESCE($9::estado_maquina, estado),
             en_uso_desde = CASE
               WHEN $9::estado_maquina IS NULL THEN en_uso_desde
               WHEN $9::estado_maquina = 'en_uso'::estado_maquina THEN NOW()
               ELSE NULL
             END,
             device_id = $12::varchar,
             device_canal = $13,
             -- $12 casteado en todos sus usos ("inconsistent types deduced").
             sonoff_estado = CASE
               WHEN $12::varchar IS NULL THEN 'sin_enlazar'
               WHEN device_id IS DISTINCT FROM $12::varchar
                 OR device_canal IS DISTINCT FROM $13 THEN 'sin_probar'
               ELSE sonoff_estado
             END,
             sonoff_detalle = CASE
               WHEN $12::varchar IS NULL THEN NULL
               WHEN device_id IS DISTINCT FROM $12::varchar
                 OR device_canal IS DISTINCT FROM $13 THEN NULL
               ELSE sonoff_detalle
             END,
             sonoff_sync_at = CASE
               WHEN device_id IS DISTINCT FROM $12::varchar
                 OR device_canal IS DISTINCT FROM $13 THEN NULL
               ELSE sonoff_sync_at
             END
       WHERE id = $10 AND sucursal = $11
       RETURNING *`,
      [nombre, tipo, tamano || null, modelo, capacidad, numero_serie, fecha_adquisicion, notas, estado ?? null, id, req.sucursal, deviceId, deviceCanal, marca || null]
    );
    if (rows.length === 0) {
      return res.status(404).json({ message: 'Máquina no encontrada.' });
    }
    res.json(rows[0]);
  } catch (err) {
    console.error('updateMaquina error:', err);
    res.status(500).json({ message: 'No se pudieron guardar los cambios de la máquina. Intenta de nuevo.' });
  }
};

export const deleteMaquina = async (req, res) => {
  const { id } = req.params;
  try {
    // Una máquina en uso no se borra: su carga se quedaría sin máquina y nadie
    // apagaría su relé.
    const { rowCount } = await pool.query(
      `DELETE FROM maquinas WHERE id = $1 AND sucursal = $2 AND estado <> 'en_uso'`,
      [id, req.sucursal]
    );
    if (rowCount === 0) {
      const { rows: enUso } = await pool.query(
        `SELECT nombre FROM maquinas WHERE id = $1 AND sucursal = $2 AND estado = 'en_uso'`,
        [id, req.sucursal]
      );
      if (enUso.length > 0) {
        return res.status(409).json({
          message: `${enUso[0].nombre} está en uso. Finaliza su carga (o apágala desde Gestión) antes de eliminarla.`,
        });
      }
    }
    if (rowCount === 0) {
      return res.status(404).json({ message: 'Máquina no encontrada.' });
    }
    res.status(204).end();
  } catch (err) {
    console.error('deleteMaquina error:', err);
    res.status(500).json({ message: 'No se pudo eliminar la máquina. Intenta de nuevo.' });
  }
};

// ── PATCH /maquinas/:id/detener-ciclo ───────────────────────
/**
 * Detiene el ciclo: la máquina pasa a disponible y la nota recalcula su fase.
 * Con `alerta_ciclo_detenido` activo deja aviso en la campana. Detener una
 * lavadora es de admin.
 */
export const detenerCiclo = async (req, res) => {
  const { id } = req.params;
  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    const { rows: maqRows } = await client.query(
      'SELECT id, nombre, tipo, estado FROM maquinas WHERE id = $1 AND sucursal = $2 FOR UPDATE',
      [id, req.sucursal]
    );
    if (maqRows.length === 0) {
      await client.query('ROLLBACK');
      return res.status(404).json({ message: 'Máquina no encontrada.' });
    }
    const maq = maqRows[0];
    // Lavadora: solo admin. Secadora: cualquiera.
    if (maq.tipo !== 'secadora' && !esAdmin(req.user?.rol)) {
      await client.query('ROLLBACK');
      return res.status(403).json({ message: 'Solo un administrador puede detener una lavadora.' });
    }
    const estabaEnUso = maq.estado === 'en_uso';

    // Cierra su vuelta antes de soltarla.
    await sellarPasadasVivas(client, [maq.id]);
    const { rows: upd } = await client.query(
      `UPDATE maquinas SET estado = 'disponible', en_uso_desde = NULL WHERE id = $1 RETURNING *`,
      [id]
    );

    // La nota en proceso recalcula su fase (puede volver a En Espera).
    await client.query(
      `UPDATE notas n SET estado = (CASE
           WHEN EXISTS (SELECT 1 FROM nota_cargas nc JOIN maquinas m ON m.id = nc.lavadora_id
                         WHERE nc.nota_id = n.id AND m.estado = 'en_uso')
             THEN 'LAVANDO'
           WHEN EXISTS (SELECT 1 FROM nota_cargas nc JOIN maquinas m ON m.id = nc.secadora_id
                         WHERE nc.nota_id = n.id AND m.estado = 'en_uso')
             THEN 'SECANDO'
           ELSE 'EN_ESPERA'
         END)::estado_orden
       WHERE n.estado IN ('LAVANDO', 'SECANDO')
         AND EXISTS (SELECT 1 FROM nota_cargas nc WHERE nc.nota_id = n.id AND (nc.lavadora_id = $1 OR nc.secadora_id = $1))`,
      [id]
    );

    if (estabaEnUso) {
      const { rows: cfg } = await client.query('SELECT alerta_ciclo_detenido FROM ajustes WHERE id = 1');
      if (cfg[0]?.alerta_ciclo_detenido) {
        const { rows: u } = await client.query("SELECT TRIM(nombre || ' ' || COALESCE(apellido, '')) AS nombre FROM usuarios WHERE id = $1", [req.user.id]);
        const quien = u[0]?.nombre ?? 'un empleado';
        await client.query(
          `INSERT INTO notificaciones (tipo, mensaje, maquina_id, usuario_id, sucursal)
           VALUES ('ciclo_detenido', $1, $2, $3, $4)`,
          [`${maq.nombre} detenida por ${quien}`, id, req.user.id, req.sucursal]
        );
      }
    }

    await client.query('COMMIT');
    res.json(upd[0]);
  } catch (err) {
    await client.query('ROLLBACK');
    console.error('detenerCiclo error:', err);
    res.status(500).json({ message: 'No se pudo detener el ciclo. Intenta de nuevo.' });
  } finally {
    client.release();
  }
};

export const cambiarEstadoMaquina = async (req, res) => {
  const { id } = req.params;
  const { estado } = req.body;

  if (!estado || !ESTADOS_VALIDOS.includes(estado)) {
    return res.status(400).json({
      message: `Elige un estado válido: ${enPalabras(ESTADOS_VALIDOS)}.`,
    });
  }

  try {
    // $1 casteado al enum: dentro del CASE Postgres no infiere el tipo.
    const { rows } = await pool.query(
      `UPDATE maquinas
         SET estado       = $1::estado_maquina,
             en_uso_desde = CASE
               WHEN $1::estado_maquina = 'en_uso'::estado_maquina THEN NOW()
               ELSE NULL
             END
       WHERE id = $2 AND sucursal = $3
       RETURNING *`,
      [estado, id, req.sucursal]
    );
    if (rows.length === 0) {
      return res.status(404).json({ message: 'Máquina no encontrada.' });
    }
    res.json(rows[0]);
  } catch (err) {
    console.error('cambiarEstadoMaquina error:', err);
    res.status(500).json({ message: 'No se pudo cambiar el estado de la máquina. Intenta de nuevo.' });
  }
};

// ── POST /maquinas/:id/probar-sonoff ────────────────────────
/**
 * Prueba el enlace leyendo el estado del Sonoff, sin tocar la máquina. Guarda
 * 'enlazada', 'error' o 'sin_enlazar' y devuelve la máquina.
 */
export const probarSonoff = async (req, res) => {
  const { id } = req.params;
  try {
    const { rows } = await pool.query(
      'SELECT * FROM maquinas WHERE id = $1 AND sucursal = $2',
      [id, req.sucursal]
    );
    if (rows.length === 0) {
      return res.status(404).json({ message: 'Máquina no encontrada.' });
    }
    const maq = rows[0];

    if (!dispositivos.tieneDispositivo(maq)) {
      const { rows: upd } = await pool.query(
        `UPDATE maquinas SET sonoff_estado = 'sin_enlazar', sonoff_detalle = NULL, sonoff_sync_at = NOW()
          WHERE id = $1 RETURNING *`,
        [id]
      );
      return res.status(400).json({
        message: explicarFalla('sin_enlazar', 'No se pudo probar el Sonoff'),
        maquina: upd[0],
      });
    }

    // En simulación todo responde ok: no se guarda y se avisa.
    if (simulacionActiva(maq)) {
      return res.json({
        simulado: true,
        driver: dispositivos.nombreDriver(maq),
        message: MSG_SIMULACION,
        maquina: maq,
      });
    }

    const resultado = await dispositivos.estado(maq);
    const actualizada = await guardarEnlace(id, resultado.ok, resultado.motivo);

    if (!resultado.ok) {
      return res.status(502).json({
        message: explicarFalla(resultado.motivo, 'No se pudo probar el Sonoff'),
        maquina: actualizada,
      });
    }
    // Se dice en qué estado estaba el relé.
    res.json({
      message: `Sonoff enlazado correctamente. Ahora mismo está ${resultado.estado === 'on' ? 'encendido' : 'apagado'}.`,
      estado: resultado.estado,
      maquina: actualizada,
    });
  } catch (err) {
    console.error('probarSonoff error:', err);
    res.status(500).json({ message: 'No se pudo probar el enchufe de la máquina. Intenta de nuevo.' });
  }
};

/**
 * Apagado de emergencia: corta el Sonoff ya, aunque la máquina esté en uso.
 * Cancela un encendido manual; no toca el estado de una nota.
 */
export const apagarSonoff = async (req, res) => {
  const { id } = req.params;
  try {
    const { rows } = await pool.query(
      'SELECT * FROM maquinas WHERE id = $1 AND sucursal = $2',
      [id, req.sucursal]
    );
    if (rows.length === 0) {
      return res.status(404).json({ message: 'Máquina no encontrada.' });
    }
    const maq = rows[0];

    if (!dispositivos.tieneDispositivo(maq)) {
      return res.status(400).json({
        message: explicarFalla('sin_enlazar', 'No se pudo apagar la máquina'),
      });
    }
    if (simulacionActiva(maq)) {
      return res.json({ simulado: true, driver: dispositivos.nombreDriver(maq), message: MSG_SIMULACION, maquina: maq });
    }

    const apagado = await apagarConReintentos(maq);
    console.log(`[maquinas] apagado de emergencia ${maq.nombre}: ${apagado.ok ? 'ok' : `falló (${apagado.motivo})`}`);

    // Se borra el encendido manual (si no, el barrido la volvería a prender) y
    // se libera si solo la ocupaba eso.
    if (apagado.ok && maq.encendida_manual_at) {
      await pool.query(
        `UPDATE maquinas
            SET encendida_manual_at = NULL,
                estado       = CASE WHEN estado = 'en_uso' THEN 'disponible'::estado_maquina ELSE estado END,
                en_uso_desde = CASE WHEN estado = 'en_uso' THEN NULL ELSE en_uso_desde END
          WHERE id = $1
            AND NOT EXISTS (
              SELECT 1 FROM notas n
               WHERE n.estado IN ('EN_ESPERA', 'LAVANDO', 'SECANDO')
                 AND EXISTS (
                   SELECT 1 FROM nota_cargas nc
                    WHERE nc.nota_id = n.id
                      AND (nc.lavadora_id = $1 OR nc.secadora_id = $1)
                 )
            )`,
        [id]
      );
    }

    const actualizada = await guardarEnlace(id, apagado.ok, apagado.motivo);

    if (!apagado.ok) {
      // Puede estar andando con ropa dentro: el mensaje da la salida manual.
      return res.status(502).json({
        message: explicarFalla(apagado.motivo, `No se pudo apagar ${maq.nombre} después de ${INTENTOS_APAGADO} intentos`) +
                 ' Apágala desde la app de eWeLink o con el interruptor de la máquina.',
        maquina: actualizada,
      });
    }
    res.json({ message: `Orden de apagado enviada a ${maq.nombre}.`, maquina: actualizada });
  } catch (err) {
    console.error('apagarSonoff error:', err);
    res.status(500).json({ message: 'No se pudo apagar la máquina. Intenta de nuevo.' });
  }
};

/**
 * Encendido manual desde Gestión de Máquinas, sin nota (reanudar tras un
 * apagón, revisarla). Queda 'en_uso' con encendido manual: el barrido la
 * respeta y no se ofrece a notas hasta que se apague o caduque.
 */
export const encenderSonoff = async (req, res) => {
  const { id } = req.params;
  try {
    const { rows } = await pool.query(
      `SELECT m.*, ${soloFichasSql('m')} AS solo_fichas
         FROM maquinas m WHERE m.id = $1 AND m.sucursal = $2`,
      [id, req.sucursal]
    );
    if (rows.length === 0) {
      return res.status(404).json({ message: 'Máquina no encontrada.' });
    }
    const maq = rows[0];

    // Solo fichas: no se enciende (su encendido manual nunca caducaría).
    if (maq.solo_fichas) {
      return res.status(400).json({
        message: `${maq.nombre} trabaja con fichas: no tiene Sonoff que encender.`,
      });
    }

    if (!dispositivos.tieneDispositivo(maq)) {
      return res.status(400).json({
        message: explicarFalla('sin_enlazar', 'No se pudo encender la máquina'),
      });
    }
    if (simulacionActiva(maq)) {
      return res.json({ simulado: true, driver: dispositivos.nombreDriver(maq), message: MSG_SIMULACION, maquina: maq });
    }

    const encendido = await dispositivos.encender(maq);
    console.log(`[maquinas] encendido manual ${maq.nombre}: ${encendido.ok ? 'ok' : `falló (${encendido.motivo})`}`);

    if (!encendido.ok) {
      return res.status(502).json({
        message: explicarFalla(encendido.motivo, `No se pudo encender ${maq.nombre}`),
        maquina: await guardarEnlace(id, false, encendido.motivo),
      });
    }

    // Encendido manual: el barrido la respeta y queda 'en_uso'.
    const { rows: upd } = await pool.query(
      `UPDATE maquinas
          SET encendida_manual_at = NOW(),
              estado       = CASE WHEN estado = 'disponible' THEN 'en_uso'::estado_maquina ELSE estado END,
              en_uso_desde = CASE WHEN estado = 'disponible' THEN NOW() ELSE en_uso_desde END,
              sonoff_estado = 'enlazada',
              sonoff_detalle = NULL,
              sonoff_sync_at = NOW()
        WHERE id = $1
        RETURNING *`,
      [id]
    );

    res.json({
      message: `${maq.nombre} encendida. Queda ocupada hasta que la apagues; ` +
               `si nadie lo hace, se libera sola en ${HORAS_ENCENDIDO_MANUAL} h.`,
      maquina: upd[0],
    });
  } catch (err) {
    console.error('encenderSonoff error:', err);
    res.status(500).json({ message: 'No se pudo encender la máquina. Intenta de nuevo.' });
  }
};

// ── PATCH /maquinas/:id/otro-ciclo ──────────────────────────
/**
 * Arranca el siguiente ciclo de la misma carga (modelos de dos ciclos): reinicia
 * el reloj y sube el contador; el precio no cambia. Exige que el ciclo anterior
 * haya terminado, que pasara la pausa sin corriente y que no se agote el tope.
 */
export const otroCiclo = async (req, res) => {
  const { id } = req.params;
  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    const { rows } = await client.query(
      `SELECT m.*, ${MINUTOS_CONFIGURADOS} AS minutos_ciclo,
              ${OPCIONES_DE_MARCA} AS marca_opciones
         FROM maquinas m WHERE m.id = $1 AND m.sucursal = $2 FOR UPDATE OF m`,
      [id, req.sucursal]
    );
    if (rows.length === 0) {
      await client.query('ROLLBACK');
      return res.status(404).json({ message: 'Máquina no encontrada.' });
    }
    const maq = rows[0];

    if (maq.estado !== 'en_uso') {
      await client.query('ROLLBACK');
      return res.status(400).json({ message: `${maq.nombre} no está corriendo ninguna carga.` });
    }

    // La carga que la arrancó, bloqueada: dos clics no se saltan el tope.
    const { rows: cargas } = await client.query(
      `SELECT nc.id,
              nc.nota_id,
              (nc.lavadora_id = $1) AS es_lavadora,
              CASE WHEN nc.lavadora_id = $1 THEN nc.lavadora_ciclos
                   ELSE nc.secadora_ciclos END AS ciclos,
              COALESCE((
                SELECT ncm.ciclo_unico FROM nota_carga_maquinas ncm
                 WHERE ncm.carga_id = nc.id
                   AND ncm.slot = CASE WHEN nc.lavadora_id = $1 THEN 'lavadora' ELSE 'secadora' END
                 ORDER BY ncm.asignada_at DESC, ncm.id DESC LIMIT 1
              ), FALSE) AS ciclo_unico
         FROM nota_cargas nc
         JOIN notas n ON n.id = nc.nota_id
        WHERE n.estado IN ('EN_ESPERA', 'LAVANDO', 'SECANDO')
          AND ((nc.lavadora_id = $1 AND nc.lavadora_iniciada_at IS NOT NULL)
            OR (nc.secadora_id = $1 AND nc.secadora_iniciada_at IS NOT NULL))
        ORDER BY n.created_at ASC
        LIMIT 1
        FOR UPDATE OF nc`,
      [maq.id]
    );
    const carga = cargas[0];
    if (!carga) {
      await client.query('ROLLBACK');
      return res.status(400).json({
        message: `${maq.nombre} no tiene una carga en curso. Si la prendiste a mano, apágala desde Gestión de Máquinas.`,
      });
    }

    // El tope de ciclos se revalida aquí, no solo en la tarjeta.
    const maxCiclos = maxCiclosDeMaquina({ ...maq, ciclo_unico: carga.ciclo_unico });
    if (carga.ciclos >= maxCiclos) {
      await client.query('ROLLBACK');
      return res.status(400).json({
        message: maxCiclos > 1
          ? `Esta carga ya corrió sus ${maxCiclos} ciclos. Termínala para liberar ${maq.nombre}.`
          : carga.ciclo_unico
          ? `Esta vuelta es una repetición (relavado o secado de más), así que corre un solo ciclo. Termínala para liberar ${maq.nombre}.`
          // La secadora siempre corre un ciclo.
          : maq.tipo === 'secadora'
          ? `Un secado es un solo ciclo. Termínalo para liberar ${maq.nombre}.`
          : `${maq.nombre} no tiene configurado el tiempo de su marca, así que su carga corre un solo ciclo. `
            + 'Termínala, o configura el tiempo en Ajustes → Marcas y tiempos.',
      });
    }

    // Ya encendida para esta vuelta: los relojes se cumplieron antes de
    // encenderla (y al encender se borró el `en_uso_desde` que miden).
    const esperandoArranqueDeEstaCarga =
      maq.en_uso_desde == null && String(maq.encendida_para_nota_id) === String(carga.nota_id);

    if (!esperandoArranqueDeEstaCarga) {
      const fin = finCiclo(maq);
      if (fin == null) {
        await client.query('ROLLBACK');
        return res.status(400).json({ message: `${maq.nombre} no tiene un ciclo cronometrado.` });
      }
      if (Date.now() < fin) {
        await client.query('ROLLBACK');
        return res.status(400).json({
          message: `${maq.nombre} sigue en su ciclo. Espera a que termine para darle otro.`,
        });
      }

      // La pausa sin corriente se exige también desde la API.
      const desde = instanteOtroCiclo(maq);
      if (desde != null && Date.now() < desde) {
        const faltan = Math.ceil((desde - Date.now()) / 1000);
        await client.query('ROLLBACK');
        return res.status(400).json({
          message: `${maq.nombre} necesita ${PAUSA_OTRO_CICLO_SEGUNDOS} s sin corriente antes del siguiente ciclo. Espera ${faltan} s.`,
        });
      }
    }

    const columna = carga.es_lavadora ? 'lavadora_ciclos' : 'secadora_ciclos';
    await client.query(
      `UPDATE nota_cargas SET ${columna} = ${columna} + 1 WHERE id = $1`,
      [carga.id]
    );

    // Reiniciar en_uso_desde arranca el reloj. El ciclo se vuelve a sellar
    // (encender lo dejó en NULL) con la misma cadena que el primero.
    const { rows: upd } = await client.query(
      `UPDATE maquinas m
          SET en_uso_desde = NOW(),
              encendida_sin_iniciar_at = NULL,
              encendida_para_nota_id   = NULL,
              ciclo_minutos = COALESCE(
                m.ciclo_minutos,
                ${MINUTOS_CONFIGURADOS},
                (SELECT CASE
                          -- Respaldo por tamaño; la columna plana es la mediana.
                          WHEN m.tipo = 'secadora' AND m.tamano = 'jumbo'
                            THEN COALESCE(a.tiempo_secadora_jumbo, a.tiempo_carga_secadora)
                          WHEN m.tipo = 'secadora'       THEN a.tiempo_carga_secadora
                          WHEN m.tipo = 'lavadora_jumbo' THEN a.tiempo_carga_jumbo
                          ELSE a.tiempo_carga_mediana END
                   FROM ajustes a WHERE a.id = 1)
              )
        WHERE m.id = $1 RETURNING *`,
      [maq.id]
    );

    await client.query('COMMIT');

    // Fuera de la transacción: el trigger no ve este cambio, así que se pide el
    // encendido (y reprograma el corte).
    await sincronizarSonoff(maq.id);

    const { rows: fresca } = await pool.query(
      `SELECT m.*, ${MINUTOS_CONFIGURADOS} AS minutos_ciclo,
              ${OPCIONES_DE_MARCA} AS marca_opciones
         FROM maquinas m WHERE m.id = $1`,
      [maq.id]
    );
    const ciclo = carga.ciclos + 1;
    res.json({
      message: `${maq.nombre}: ciclo ${ciclo} de ${maxCiclos} en marcha.`,
      ciclo,
      ciclos_max: maxCiclos,
      maquina: conDatosDeOtroCiclo({
        ...(fresca[0] ?? upd[0]),
        ciclos_carga: ciclo,
        // El tope de esta vuelta lo decide la pasada leída con la carga.
        ciclo_unico: carga.ciclo_unico,
      }),
    });
  } catch (err) {
    await client.query('ROLLBACK').catch(() => {});
    console.error('otroCiclo error:', err);
    res.status(500).json({ message: 'No se pudo iniciar el siguiente ciclo. Intenta de nuevo.' });
  } finally {
    client.release();
  }
};

// ── PATCH /maquinas/:id/mas-tiempo ──────────────────────────
/**
 * "Otro ciclo" de la secadora de fichas que pregunta su programa: al acabar el
 * programa, suma otro y mete sus fichas, sin pasar del tope en minutos metidos.
 * El precio no cambia. El nuevo fin cuenta desde ahora si ya había terminado.
 */
export const masTiempo = async (req, res) => {
  const { id } = req.params;
  const minutos = Number(req.body?.minutos);
  if (!Number.isInteger(minutos) || minutos <= 0) {
    return res.status(400).json({ message: 'Elige cuántos minutos le sumas.' });
  }
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    // Fila bloqueada: dos clics no suman dos veces el mismo cupo.
    const { rows } = await client.query(
      `SELECT m.*, ${TIEMPOS_DEL_MODELO} AS modelo_tiempos,
              ${MINUTOS_POR_FICHA} AS minutos_por_ficha,
              ${esCronometroSql('m')} AS cronometro
         FROM maquinas m WHERE m.id = $1 AND m.sucursal = $2 FOR UPDATE OF m`,
      [id, req.sucursal]
    );
    if (rows.length === 0) {
      await client.query('ROLLBACK');
      return res.status(404).json({ message: 'Máquina no encontrada.' });
    }
    const maq = rows[0];
    const opciones = opcionesMasTiempo(maq);
    // Un minuto de gracia por la diferencia de reloj con la tablet.
    if (opciones.length > 0 && !programaTerminado(maq, Date.now() + 60_000)) {
      await client.query('ROLLBACK');
      return res.status(400).json({
        message: `${maq.nombre} sigue en su programa de ${maq.ciclo_elegido_minutos} min. Súmale tiempo cuando termine.`,
      });
    }
    if (!opciones.includes(minutos)) {
      await client.query('ROLLBACK');
      return res.status(400).json({
        message: opciones.length > 0
          ? `A ${maq.nombre} solo le puedes sumar ${opciones.join(' o ')} min.`
          : `${maq.nombre} ya no admite más tiempo: llegó a su tope de ${maq.ciclo_minutos} min.`,
      });
    }
    const { rows: upd } = await client.query(
      `UPDATE maquinas
          SET minutos_pagados = COALESCE(minutos_pagados, ciclo_elegido_minutos) + $2,
              -- Nuevo fin: desde ahora o desde el fin anterior si no ha llegado.
              ciclo_elegido_minutos = GREATEST(
                ciclo_elegido_minutos,
                ROUND(EXTRACT(EPOCH FROM (NOW() - en_uso_desde)) / 60)::int
              ) + $2
        WHERE id = $1 RETURNING ciclo_elegido_minutos, minutos_pagados`,
      [maq.id, minutos]
    );
    await client.query('COMMIT');

    // Fuera de la transacción: los pulsos tardan.
    await meterFichasExtra(maq.id, minutos);

    res.json({
      message: `${maq.nombre}: +${minutos} min (${upd[0].minutos_pagados} de ${maq.ciclo_minutos}). Dale START en la máquina.`,
      ciclo_elegido_minutos: upd[0].ciclo_elegido_minutos,
      minutos_pagados: upd[0].minutos_pagados,
    });
  } catch (err) {
    await client.query('ROLLBACK').catch(() => {});
    console.error('masTiempo error:', err);
    res.status(500).json({ message: 'No se pudo sumar el tiempo. Intenta de nuevo.' });
  } finally {
    client.release();
  }
};

// ── POST /maquinas/revisar-sonoff ───────────────────────────
/**
 * Botón de refrescar de Máquinas: hace ya el paso del barrido sobre las
 * máquinas ocupadas de la sucursal (así una encendida a mano que ya apagaron se
 * suelta en el acto). Si un Sonoff no responde, sigue con los demás.
 */
export const revisarSonoff = async (req, res) => {
  try {
    const { rows } = await pool.query(
      `SELECT id, sucursal FROM maquinas
        WHERE sucursal = $1 AND device_id IS NOT NULL
          AND (estado = 'en_uso' OR encendida_manual_at IS NOT NULL)
        ORDER BY id`,
      [req.sucursal]
    );
    const reales = rows.filter(m => !dispositivos.esSimulacion(m));
    await Promise.all(reales.map(m => sincronizarSonoff(m.id, { reconciliando: true })));
    res.json({ revisadas: reales.length });
  } catch (err) {
    console.error('revisarSonoff error:', err);
    res.status(500).json({ message: 'No se pudieron revisar los Sonoff.' });
  }
};
