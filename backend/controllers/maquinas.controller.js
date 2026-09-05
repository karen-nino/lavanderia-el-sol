import pool from '../db/pool.js';
import { TZ_NEGOCIO } from '../utils/tz.js';
import * as dispositivos from '../services/dispositivos/index.js';
import { explicarFalla, resumirMotivo } from '../services/dispositivos/mensajes.js';
import { HORAS_ENCENDIDO_MANUAL } from '../services/sincronizarSonoff.js';
import { esAdmin } from '../middleware/roles.js';

const ESTADOS_VALIDOS = ['disponible', 'en_uso', 'mantenimiento'];
const TIPOS_VALIDOS   = ['lavadora_mediana', 'lavadora_jumbo', 'secadora'];
const CAPACIDADES_VALIDAS = ['20kg', '35kg'];
const TAMANOS_VALIDOS = ['mediana', 'jumbo'];

// Los valores válidos se enlistan como se leen, no como se guardan:
// ['lavadora_mediana', 'secadora'] → "lavadora mediana o secadora".
const enPalabras = (valores) => {
  const legibles = valores.map((v) => v.replace(/_/g, ' '));
  if (legibles.length <= 1) return legibles.join('');
  return `${legibles.slice(0, -1).join(', ')} o ${legibles.at(-1)}`;
};

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
  'Modo simulación: la app no está conectada a los Sonoff reales, así que esta ' +
  'prueba no comprueba nada y las máquinas tampoco van a encender ni apagar solas. ' +
  'Para activarlo hay que configurar eWeLink en el servidor (DISPOSITIVOS_DRIVER=ewelink).';

// Guarda cómo quedó el enlace y, si falló, POR QUÉ: así la tarjeta explica el
// problema sin que nadie tenga que apretar "Probar" para enterarse.
const guardarEnlace = async (id, ok, motivo) => {
  const { rows } = await pool.query(
    `UPDATE maquinas SET sonoff_estado = $1, sonoff_detalle = $2, sonoff_sync_at = NOW()
      WHERE id = $3 RETURNING *`,
    [ok ? 'enlazada' : 'error', ok ? null : resumirMotivo(motivo), id]
  );
  return rows[0];
};

// Duración del pulso de la prueba física: suficiente para ver/oír arrancar la
// máquina, corto para no iniciar un ciclo de verdad.

const esperar = (ms) => new Promise(resolve => setTimeout(resolve, ms));

// Apagar es la operación que NO puede quedarse a medias: si falla, una máquina
// se queda andando sola. Se reintenta con una pausa corta antes de rendirse.
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
    res.status(500).json({ message: 'No se pudieron cargar las máquinas. Intenta de nuevo.' });
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
  if (!id) return res.status(400).json({ message: 'No se reconoció la máquina.' });

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
    res.status(500).json({ message: 'No se pudo cargar el uso de la máquina. Intenta de nuevo.' });
  }
};

export const createMaquina = async (req, res) => {
  const { nombre, tipo, tamano, modelo, capacidad, numero_serie, fecha_adquisicion, notas, device_id, device_canal } = req.body;

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
  // Sin dispositivo enlazado la máquina queda 'sin_enlazar'; con dispositivo
  // arranca en 'sin_probar' hasta que el reconciliador o el botón "Probar"
  // verifiquen que responde y lo marquen 'enlazada'. No es 'error': todavía no
  // ha fallado nada, solo falta comprobarlo (mig. 103).
  const sonoffEstado = deviceId ? 'sin_probar' : 'sin_enlazar';

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
      return res.status(400).json({ message: 'Ese tipo de máquina no es válido.' });
    }
    res.status(500).json({ message: 'No se pudo crear la máquina. Intenta de nuevo.' });
  }
};

export const updateMaquina = async (req, res) => {
  const { id } = req.params;
  const { nombre, tipo, tamano, modelo, capacidad, numero_serie, fecha_adquisicion, notas, estado, device_id, device_canal } = req.body;

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

    // estado es opcional: si llega null se conserva el actual. Al cambiarlo se
    // mantiene en_uso_desde coherente, igual que en cambiarEstadoMaquina.
    //
    // sonoff_estado/sonoff_sync_at se recalculan según el enlace: sin
    // dispositivo → 'sin_enlazar'; si el device_id cambia → 'sin_probar' (aún
    // sin confirmar, pero sin fallas que reportar) y se limpia sync_at para que
    // el reconciliador/probar lo reverifiquen; si no cambia, se conserva el
    // estado actual. El detalle del último fallo se borra en ambos casos:
    // hablaba del Sonoff anterior.
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
             -- El canal cuenta igual que el device_id: en un Sonoff multi-relé
             -- corregir el canal apunta a OTRO relé, y el enlace que se había
             -- confirmado ya no dice nada del nuevo.
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
      [nombre, tipo, tamano || null, modelo, capacidad, numero_serie, fecha_adquisicion, notas, estado ?? null, id, req.sucursal, deviceId, deviceCanal]
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
    res.status(500).json({ message: 'No se pudo eliminar la máquina. Intenta de nuevo.' });
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
    res.status(500).json({ message: 'No se pudo cambiar el estado de la máquina. Intenta de nuevo.' });
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
        `UPDATE maquinas SET sonoff_estado = 'sin_enlazar', sonoff_detalle = NULL, sonoff_sync_at = NOW()
          WHERE id = $1 RETURNING *`,
        [id]
      );
      return res.status(400).json({
        message: explicarFalla('sin_enlazar', 'No se pudo probar el Sonoff'),
        maquina: upd[0],
      });
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
    const actualizada = await guardarEnlace(id, resultado.ok, resultado.motivo);

    if (!resultado.ok) {
      return res.status(502).json({
        message: explicarFalla(resultado.motivo, 'No se pudo probar el Sonoff'),
        maquina: actualizada,
      });
    }
    // Decir en qué estado se encontró el relé ahorra el viaje a la máquina: si
    // aparece encendida y nadie la está usando, ahí mismo se ve el problema.
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

// Apagado de emergencia: corta el Sonoff ya, sin esperas ni condiciones.
//
// Existe porque una máquina puede quedar andando cuando no debería (un
// encendido manual que nadie apagó, un ciclo que no cortó) y en ese momento lo
// último que sirve es ir a buscar el teléfono y abrir eWeLink.
//
// Se permite incluso con la máquina en uso: justamente el caso urgente es
// "está encendida y no debería estarlo". No toca el estado operativo en la BD;
// solo manda apagar el dispositivo.
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
    if (simulacionActiva()) {
      return res.json({ simulado: true, driver: dispositivos.nombreDriver(), message: MSG_SIMULACION, maquina: maq });
    }

    const apagado = await apagarConReintentos(maq);
    console.log(`[maquinas] apagado de emergencia ${maq.nombre}: ${apagado.ok ? 'ok' : `falló (${apagado.motivo})`}`);

    // Apagar cancela el encendido manual: si no se borrara la marca, el
    // reconciliador volvería a prender la máquina que se acaba de cortar.
    // La máquina se libera solo si estaba ocupada por ese encendido, no por una
    // nota: ahí el estado lo maneja el flujo de la nota.
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
      // Aquí la máquina puede estar andando con ropa dentro, así que el mensaje
      // termina siempre con la salida manual: no se queda esperando a que la
      // app se recupere.
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

// Encendido manual desde Gestión de Máquinas: cierra el relé y lo deja
// cerrado, hasta que alguien lo apague.
//
// Sirve para arrancar una máquina sin pasar por una nota: reanudar un ciclo
// que se cortó por un apagón, o dejarla andando mientras se revisa. Como el
// equipo arranca de verdad, la UI pide confirmación antes de llamar aquí.
//
// La máquina queda marcada como encendida a mano (mig. 104) y pasa a 'en_uso':
// el reconciliador la respeta y deja de ofrecerse al crear notas y en Salidas,
// porque está ocupada de verdad. Antes de la 104 este botón prendía la máquina
// y el barrido la apagaba a los tres minutos.
export const encenderSonoff = async (req, res) => {
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
        message: explicarFalla('sin_enlazar', 'No se pudo encender la máquina'),
      });
    }
    if (simulacionActiva()) {
      return res.json({ simulado: true, driver: dispositivos.nombreDriver(), message: MSG_SIMULACION, maquina: maq });
    }

    const encendido = await dispositivos.encender(maq);
    console.log(`[maquinas] encendido manual ${maq.nombre}: ${encendido.ok ? 'ok' : `falló (${encendido.motivo})`}`);

    if (!encendido.ok) {
      return res.status(502).json({
        message: explicarFalla(encendido.motivo, `No se pudo encender ${maq.nombre}`),
        maquina: await guardarEnlace(id, false, encendido.motivo),
      });
    }

    // Queda marcada como encendida a mano (mig. 104). Sin esto el reconciliador
    // la apagaba en su siguiente pasada, o sea que el botón prendía la máquina
    // por tres minutos. La marca además la pone 'en_uso': está ocupada de
    // verdad, y así no se ofrece al crear notas ni en Salidas.
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
