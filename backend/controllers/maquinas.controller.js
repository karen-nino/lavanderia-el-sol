import pool from '../db/pool.js';
import { TZ_NEGOCIO } from '../utils/tz.js';
import * as dispositivos from '../services/dispositivos/index.js';
import { esAdmin } from '../middleware/roles.js';

const ESTADOS_VALIDOS = ['disponible', 'en_uso', 'mantenimiento'];
const TIPOS_VALIDOS   = ['lavadora_mediana', 'lavadora_jumbo', 'secadora'];
const CAPACIDADES_VALIDAS = ['20kg', '35kg'];
const TAMANOS_VALIDOS = ['mediana', 'jumbo'];

// device_id del Sonoff en eWeLink: cadena recortada, o null si viene vacío.
const normalizarDeviceId = (v) => {
  if (v == null) return null;
  const s = String(v).trim();
  return s === '' ? null : s;
};

// Canal/relé del dispositivo (Sonoff multi-relé): entero >= 0, o null.
const normalizarDeviceCanal = (v) => {
  if (v == null || v === '') return null;
  const n = Number(v);
  return Number.isInteger(n) && n >= 0 ? n : null;
};

// Un mismo relé físico no puede estar enlazado a dos máquinas: un device_id
// copiado por error haría que la app apague la máquina equivocada (con ropa
// dentro). Se busca en TODAS las sucursales porque el Sonoff es un aparato
// físico único, no un dato por sucursal. Un mismo device_id con canales
// distintos sí es válido (Sonoff multi-relé).
// Devuelve el nombre de la máquina que ya lo usa, o null si está libre.
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

// El driver 'null' simula todo en memoria: responde ok a cualquier device_id,
// sin tocar hardware. Mientras esté activo, las pruebas de enlace no prueban
// nada y hay que decirlo en pantalla en vez de pintar una palomita verde.
const simulacionActiva = () => dispositivos.esSimulacion();

const MSG_SIMULACION =
  'Modo simulación: el sistema no está conectado a los Sonoff reales, así que ' +
  'esta prueba no comprueba nada. Falta configurar las credenciales de eWeLink ' +
  'en el servidor (DISPOSITIVOS_DRIVER=ewelink).';

// Duración del pulso de la prueba física: suficiente para ver/oír arrancar la
// máquina, corto para no iniciar un ciclo de verdad.
const SEGUNDOS_PRUEBA_FISICA = 5;

const esperar = (ms) => new Promise(resolve => setTimeout(resolve, ms));

const mensajeDeviceDuplicado = (nombre, deviceCanal) =>
  `Ese ID de Sonoff ya está asignado a "${nombre}"` +
  (deviceCanal != null ? ` (canal ${deviceCanal})` : '') +
  '. Usa un ID distinto o, si es un dispositivo multi-relé, indica otro canal.';

export const getMaquinas = async (req, res) => {
  try {
    // Dos datos que las pantallas de asignación necesitan, además del estado:
    //
    // · "reservada": la máquina está libre pero ya la tiene asignada otra nota
    //   abierta que aún no la arranca. NO bloquea —asignar no aparta— pero se
    //   muestra para avisar que alguien más va por ella.
    // · "en_uso_folio": la nota que la está usando ahora mismo. Es la que se
    //   la quedó al darle a Iniciar; las demás tienen que cambiar de máquina.
    const { rows } = await pool.query(
      `SELECT m.*,
              (r.folio IS NOT NULL) AS reservada,
              r.folio               AS reservada_folio,
              r.id                  AS reservada_nota_id,
              u.folio               AS en_uso_folio,
              u.id                  AS en_uso_nota_id
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
            WHERE m.estado = 'en_uso'
              AND n.estado IN ('LAVANDO', 'SECANDO')
              AND EXISTS (
                SELECT 1 FROM nota_cargas nc
                 WHERE nc.nota_id = n.id
                   AND (nc.lavadora_id = m.id OR nc.secadora_id = m.id)
              )
            ORDER BY n.created_at ASC
            LIMIT 1
         ) u ON TRUE
        WHERE m.sucursal = $1
        ORDER BY m.tipo ASC, m.nombre ASC`,
      [req.sucursal]
    );
    res.json(rows);
  } catch (err) {
    console.error('getMaquinas error:', err);
    res.status(500).json({ message: 'Error interno del servidor.' });
  }
};

// ── GET /maquinas/:id/uso ───────────────────────────────────
// Uso diario de la máquina, derivado de las notas que la usaron DE VERDAD:
// tenerla asignada no cuenta (varias notas pueden tenerla; la usa la que le da
// a Iniciar, y eso es lo que marca nota_cargas.*_iniciada_at, mig. 097).
// "Generado" = dinero cobrado (notas PAGADAS), atribuido al día en que se
// usó la máquina. Métricas por día: usos, cargas, generado, empleados que
// la operaron y clientes atendidos (cada autoservicio cuenta como 1 cliente;
// el resto, sus clientes distintos). Excluye notas canceladas.
// El desglose por día se arma en JS (igual que el desempeño de empleados)
// para que cada número y el contenido de su modal siempre coincidan.
export const getUsoMaquina = async (req, res) => {
  const id = Number(req.params.id);
  if (!id) return res.status(400).json({ message: 'Máquina inválida.' });

  try {
    const { rows: maq } = await pool.query(
      'SELECT id, nombre, tipo, estado, capacidad, sucursal FROM maquinas WHERE id = $1 AND sucursal = $2',
      [id, req.sucursal]
    );
    if (maq.length === 0) return res.status(404).json({ message: 'Máquina no encontrada.' });

    // Una nota "usó" la máquina si la tiene en alguna de sus cargas
    // (tabla nota_cargas).
    const { rows: notas } = await pool.query(
      `SELECT n.id, to_char(n.created_at AT TIME ZONE $2, 'YYYY-MM-DD') AS fecha,
              n.folio, n.tipo_servicio, n.estado,
              n.precio_total, n.estado_pago, n.cliente_id,
              n.usuario_id, TRIM(u.nombre || ' ' || COALESCE(u.apellido, '')) AS empleado_nombre,
              c.nombre AS cliente_nombre, c.apellido AS cliente_apellido
         FROM notas n
         LEFT JOIN usuarios u ON u.id = n.usuario_id
         LEFT JOIN clientes c ON c.id = n.cliente_id
        WHERE EXISTS (
                SELECT 1 FROM nota_cargas nc
                 WHERE nc.nota_id = n.id
                   AND ((nc.lavadora_id = $1 AND nc.lavadora_iniciada_at IS NOT NULL)
                     OR (nc.secadora_id = $1 AND nc.secadora_iniciada_at IS NOT NULL))
              )
          AND n.estado <> 'CANCELADA'
        ORDER BY n.created_at DESC`,
      [id, TZ_NEGOCIO]
    );

    // Cargas de esta máquina (autoservicio): cada fila es una carga. El precio
    // atribuido es el del rol en que participó esta máquina (lavado o secado).
    const { rows: cargas } = await pool.query(
      `SELECT nc.nota_id, nc.precio_lavadora, nc.precio_secadora,
              nc.lavadora_id, ml.nombre AS lav_nombre,
              nc.secadora_id, ms.nombre AS sec_nombre
         FROM nota_cargas nc
         JOIN notas n ON n.id = nc.nota_id
         LEFT JOIN maquinas ml ON ml.id = nc.lavadora_id
         LEFT JOIN maquinas ms ON ms.id = nc.secadora_id
        WHERE ((nc.lavadora_id = $1 AND nc.lavadora_iniciada_at IS NOT NULL)
            OR (nc.secadora_id = $1 AND nc.secadora_iniciada_at IS NOT NULL))
          AND n.estado <> 'CANCELADA'
        ORDER BY nc.nota_id, nc.orden`,
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
          _clientesReg: new Map(), // cliente_id -> nombre
          _autoservicios: [],      // { folio }
        });
      }
      return buckets.get(k);
    };

    for (const n of notas) {
      const b = getBucket(n.fecha);
      if (n.estado_pago === 'PAGADO') b.generado += Number(n.precio_total) || 0;
      const clienteNombre = `${n.cliente_nombre ?? ''}${n.cliente_apellido ? ' ' + n.cliente_apellido : ''}`.trim();
      // Cada nota que usó la máquina cuenta como un uso.
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
      // Clientes: autoservicio = 1 cliente cada uno; el resto, por cliente.
      if (n.tipo_servicio === 'AUTOSERVICIO') {
        b._autoservicios.push({ folio: n.folio });
      } else if (n.cliente_id) {
        b._clientesReg.set(n.cliente_id, clienteNombre || 'Cliente');
      }
    }

    for (const c of cargas) {
      const n = notaPorId.get(c.nota_id);
      if (!n) continue;
      const b = getBucket(n.fecha);
      const esLav = c.lavadora_id === id;
      const esSec = c.secadora_id === id;
      const partes = [c.lav_nombre, c.sec_nombre].filter(Boolean);
      b._cargas.push({
        folio: n.folio,
        descripcion: partes.join(' + ') || maq[0].nombre,
        precio: (esLav ? Number(c.precio_lavadora) || 0 : 0) + (esSec ? Number(c.precio_secadora) || 0 : 0),
      });
    }

    const diasFmt = [...buckets.values()]
      .sort((a, b) => new Date(b.fecha) - new Date(a.fecha))
      .map((b) => {
        const empleados = [...b._empleados.values()].map((e) => ({ nombre: e.nombre, usos: e.usos }));
        const clientes  = [
          ...b._autoservicios.map((a) => ({ nombre: 'Autoservicio', folio: a.folio })),
          ...[...b._clientesReg.values()].map((nombre) => ({ nombre, folio: null })),
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
    res.status(500).json({ message: 'Error interno del servidor.' });
  }
};

export const createMaquina = async (req, res) => {
  const { nombre, tipo, tamano, modelo, capacidad, numero_serie, fecha_adquisicion, notas, device_id, device_canal } = req.body;

  if (!nombre || !tipo) {
    return res.status(400).json({ message: 'Nombre y tipo son requeridos.' });
  }
  if (!TIPOS_VALIDOS.includes(tipo)) {
    return res.status(400).json({ message: `Tipo inválido. Valores permitidos: ${TIPOS_VALIDOS.join(', ')}.` });
  }
  if (tamano != null && tamano !== '' && !TAMANOS_VALIDOS.includes(tamano)) {
    return res.status(400).json({ message: `Tamaño inválido. Valores permitidos: ${TAMANOS_VALIDOS.join(', ')}.` });
  }
  if (capacidad != null && !CAPACIDADES_VALIDAS.includes(capacidad)) {
    return res.status(400).json({ message: `Capacidad inválida. Valores permitidos: ${CAPACIDADES_VALIDAS.join(', ')}.` });
  }

  const deviceId = normalizarDeviceId(device_id);
  const deviceCanal = normalizarDeviceCanal(device_canal);
  // Sin dispositivo enlazado la máquina queda 'sin_enlazar'; con dispositivo
  // arranca en 'error' (aún no confirmado) hasta que el reconciliador o el
  // botón "Probar" verifiquen que responde y lo marquen 'enlazada'.
  const sonoffEstado = deviceId ? 'error' : 'sin_enlazar';

  try {
    const yaUsado = await buscarMaquinaConMismoDevice(deviceId, deviceCanal);
    if (yaUsado) {
      return res.status(409).json({ message: mensajeDeviceDuplicado(yaUsado, deviceCanal) });
    }

    const { rows } = await pool.query(
      `INSERT INTO maquinas (nombre, tipo, tamano, modelo, capacidad, numero_serie, fecha_adquisicion, sucursal, notas, device_id, device_canal, sonoff_estado)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)
       RETURNING *`,
      [nombre, tipo, tamano || null, modelo, capacidad, numero_serie, fecha_adquisicion, req.sucursal, notas, deviceId, deviceCanal, sonoffEstado]
    );
    res.status(201).json(rows[0]);
  } catch (err) {
    console.error('createMaquina error:', err);
    if (err.code === '22P02') {
      return res.status(400).json({ message: 'Tipo de máquina inválido.' });
    }
    res.status(500).json({ message: 'Error interno del servidor.' });
  }
};

export const updateMaquina = async (req, res) => {
  const { id } = req.params;
  const { nombre, tipo, tamano, modelo, capacidad, numero_serie, fecha_adquisicion, notas, estado, device_id, device_canal } = req.body;

  if (!nombre || !tipo) {
    return res.status(400).json({ message: 'Nombre y tipo son requeridos.' });
  }
  if (!TIPOS_VALIDOS.includes(tipo)) {
    return res.status(400).json({ message: `Tipo inválido. Valores permitidos: ${TIPOS_VALIDOS.join(', ')}.` });
  }
  if (tamano != null && tamano !== '' && !TAMANOS_VALIDOS.includes(tamano)) {
    return res.status(400).json({ message: `Tamaño inválido. Valores permitidos: ${TAMANOS_VALIDOS.join(', ')}.` });
  }
  if (capacidad != null && !CAPACIDADES_VALIDAS.includes(capacidad)) {
    return res.status(400).json({ message: `Capacidad inválida. Valores permitidos: ${CAPACIDADES_VALIDAS.join(', ')}.` });
  }
  if (estado != null && !ESTADOS_VALIDOS.includes(estado)) {
    return res.status(400).json({ message: `Estado inválido. Valores permitidos: ${ESTADOS_VALIDOS.join(', ')}.` });
  }

  const deviceId = normalizarDeviceId(device_id);
  const deviceCanal = normalizarDeviceCanal(device_canal);

  try {
    const yaUsado = await buscarMaquinaConMismoDevice(deviceId, deviceCanal, id);
    if (yaUsado) {
      return res.status(409).json({ message: mensajeDeviceDuplicado(yaUsado, deviceCanal) });
    }

    // estado es opcional: si llega null se conserva el actual. Al cambiarlo se
    // mantiene en_uso_desde coherente, igual que en cambiarEstadoMaquina.
    //
    // sonoff_estado/sonoff_sync_at se recalculan según el enlace: sin
    // dispositivo → 'sin_enlazar'; si el device_id cambia → 'error' (aún sin
    // confirmar) y se limpia sync_at para que el reconciliador/probar lo
    // reverifiquen; si no cambia, se conserva el estado actual.
    const { rows } = await pool.query(
      `UPDATE maquinas
         SET nombre = $1, tipo = $2, tamano = $3, modelo = $4, capacidad = $5, numero_serie = $6, fecha_adquisicion = $7, notas = $8,
             estado = COALESCE($9::estado_maquina, estado),
             en_uso_desde = CASE
               WHEN $9::estado_maquina IS NULL THEN en_uso_desde
               WHEN $9::estado_maquina = 'en_uso'::estado_maquina THEN NOW()
               ELSE NULL
             END,
             device_id = $12::varchar,
             device_canal = $13,
             -- $12 va casteado en TODOS sus usos: sin el cast, Postgres lo
             -- deduce como varchar en la asignación y como text dentro del
             -- CASE, y rechaza la consulta ("inconsistent types deduced").
             sonoff_estado = CASE
               WHEN $12::varchar IS NULL THEN 'sin_enlazar'
               WHEN device_id IS DISTINCT FROM $12::varchar THEN 'error'
               ELSE sonoff_estado
             END,
             sonoff_sync_at = CASE
               WHEN device_id IS DISTINCT FROM $12::varchar THEN NULL
               ELSE sonoff_sync_at
             END
       WHERE id = $10 AND sucursal = $11
       RETURNING *`,
      [nombre, tipo, tamano || null, modelo, capacidad, numero_serie, fecha_adquisicion, notas, estado ?? null, id, req.sucursal, deviceId, deviceCanal]
    );
    if (rows.length === 0) {
      return res.status(404).json({ message: 'Máquina no encontrada.' });
    }
    res.json(rows[0]);
  } catch (err) {
    console.error('updateMaquina error:', err);
    res.status(500).json({ message: 'Error interno del servidor.' });
  }
};

export const deleteMaquina = async (req, res) => {
  const { id } = req.params;
  try {
    const { rowCount } = await pool.query(
      'DELETE FROM maquinas WHERE id = $1 AND sucursal = $2',
      [id, req.sucursal]
    );
    if (rowCount === 0) {
      return res.status(404).json({ message: 'Máquina no encontrada.' });
    }
    res.status(204).end();
  } catch (err) {
    console.error('deleteMaquina error:', err);
    res.status(500).json({ message: 'Error interno del servidor.' });
  }
};

// ── PATCH /maquinas/:id/detener-ciclo ───────────────────────
// Detiene manualmente el ciclo: la máquina pasa a 'disponible' y se
// reinicia su temporizador. Si el ajuste alerta_ciclo_detenido está
// activo y la máquina estaba en uso, registra una notificación que
// aparecerá en la campana del Dashboard.
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
    // Solo un admin puede detener una LAVADORA; la secadora la puede detener
    // cualquier usuario.
    if (maq.tipo !== 'secadora' && !esAdmin(req.user?.rol)) {
      await client.query('ROLLBACK');
      return res.status(403).json({ message: 'Solo un administrador puede detener una lavadora.' });
    }
    const estabaEnUso = maq.estado === 'en_uso';

    const { rows: upd } = await client.query(
      `UPDATE maquinas SET estado = 'disponible', en_uso_desde = NULL WHERE id = $1 RETURNING *`,
      [id]
    );

    // Si la máquina pertenece a una nota en proceso, recalcular su fase: al
    // soltarla la nota puede quedar sin ninguna máquina en uso y volver a
    // "En Espera" (o seguir Lavando/Secando si otras cargas siguen corriendo).
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
    res.status(500).json({ message: 'Error interno del servidor.' });
  } finally {
    client.release();
  }
};

export const cambiarEstadoMaquina = async (req, res) => {
  const { id } = req.params;
  const { estado } = req.body;

  if (!estado || !ESTADOS_VALIDOS.includes(estado)) {
    return res.status(400).json({
      message: `Estado inválido. Valores permitidos: ${ESTADOS_VALIDOS.join(', ')}.`,
    });
  }

  try {
    // en_uso_desde se setea al activar y se limpia al salir de en_uso.
    // Se castea $1 al enum estado_maquina porque al usarlo en la rama CASE
    // Postgres ya no puede inferir el tipo desde la asignación a la columna.
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
    res.status(500).json({ message: 'Error interno del servidor.' });
  }
};

// ── POST /maquinas/:id/probar-sonoff ────────────────────────
// Verifica el enlace con el Sonoff SIN cambiar el estado operativo de la
// máquina: solo lee el estado del dispositivo. Actualiza sonoff_estado
// ('enlazada' si respondió, 'error' si no, 'sin_enlazar' si no tiene device_id)
// y devuelve la máquina actualizada. Útil al asignar el device_id en Gestión.
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
        `UPDATE maquinas SET sonoff_estado = 'sin_enlazar', sonoff_sync_at = NOW()
          WHERE id = $1 RETURNING *`,
        [id]
      );
      return res.status(400).json({ message: 'La máquina no tiene un Sonoff enlazado.', maquina: upd[0] });
    }

    // Con el driver de simulación CUALQUIER device_id responde ok, así que una
    // prueba "exitosa" no significa nada: no se guarda el resultado (marcar
    // 'enlazada' sería mentir en la tarjeta) y se avisa a quien la ejecutó.
    if (simulacionActiva()) {
      return res.json({
        simulado: true,
        driver: dispositivos.nombreDriver(),
        message: MSG_SIMULACION,
        maquina: maq,
      });
    }

    const resultado = await dispositivos.estado(maq);
    const nuevo = resultado.ok ? 'enlazada' : 'error';
    const { rows: upd } = await pool.query(
      `UPDATE maquinas SET sonoff_estado = $1, sonoff_sync_at = NOW()
        WHERE id = $2 RETURNING *`,
      [nuevo, id]
    );

    if (!resultado.ok) {
      return res.status(502).json({
        message: `El Sonoff no respondió (${resultado.motivo ?? 'sin detalle'}).`,
        maquina: upd[0],
      });
    }
    res.json({ message: 'Sonoff enlazado correctamente.', estado: resultado.estado, maquina: upd[0] });
  } catch (err) {
    console.error('probarSonoff error:', err);
    res.status(500).json({ message: 'Error interno del servidor.' });
  }
};

// Prueba FÍSICA del relé: enciende la máquina unos segundos y la vuelve a
// apagar, para confirmar en la instalación que el Sonoff mueve el equipo de
// verdad (probarSonoff solo lee el estado del dispositivo, que responde igual
// aunque esté conectado a nada).
//
// No cambia el estado operativo de la máquina en la BD: es un pulso al relé.
// Se bloquea si la máquina está en uso — encender un equipo con ropa dentro,
// o interrumpir un ciclo, es peor que no poder probar.
export const pruebaFisicaSonoff = async (req, res) => {
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
      return res.status(400).json({ message: 'La máquina no tiene un Sonoff enlazado.' });
    }
    if (maq.estado === 'en_uso') {
      return res.status(409).json({
        message: 'La máquina está en uso. Espera a que termine el ciclo para hacer la prueba física.',
      });
    }
    if (simulacionActiva()) {
      return res.json({ simulado: true, driver: dispositivos.nombreDriver(), message: MSG_SIMULACION, maquina: maq });
    }

    const encendido = await dispositivos.encender(maq);
    if (!encendido.ok) {
      const { rows: upd } = await pool.query(
        `UPDATE maquinas SET sonoff_estado = 'error', sonoff_sync_at = NOW() WHERE id = $1 RETURNING *`,
        [id]
      );
      return res.status(502).json({
        message: `No se pudo encender (${encendido.motivo ?? 'sin detalle'}).`,
        maquina: upd[0],
      });
    }

    // Pase lo que pase después de encender hay que intentar apagar: dejar una
    // máquina prendida por un error de red sería peor que fallar la prueba.
    let apagado;
    try {
      await esperar(SEGUNDOS_PRUEBA_FISICA * 1000);
    } finally {
      apagado = await dispositivos.apagar(maq);
    }

    if (!apagado.ok) {
      return res.status(502).json({
        message: `Encendió, pero NO se pudo apagar (${apagado.motivo ?? 'sin detalle'}). ` +
                 'Revisa la máquina y apágala manualmente.',
        maquina: maq,
      });
    }

    const { rows: upd } = await pool.query(
      `UPDATE maquinas SET sonoff_estado = 'enlazada', sonoff_sync_at = NOW() WHERE id = $1 RETURNING *`,
      [id]
    );
    res.json({
      message: `Listo: la máquina encendió ${SEGUNDOS_PRUEBA_FISICA} segundos y se apagó.`,
      segundos: SEGUNDOS_PRUEBA_FISICA,
      maquina: upd[0],
    });
  } catch (err) {
    console.error('pruebaFisicaSonoff error:', err);
    res.status(500).json({ message: 'Error interno del servidor.' });
  }
};
