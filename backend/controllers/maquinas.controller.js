import pool from '../db/pool.js';
import { TZ_NEGOCIO } from '../utils/tz.js';
import * as dispositivos from '../services/dispositivos/index.js';
import { explicarFalla, resumirMotivo } from '../services/dispositivos/mensajes.js';
import { MINUTOS_CONFIGURADOS, TIEMPOS_DEL_MODELO, OPCIONES_DE_MARCA, esCronometroSql, conIniciarSql } from '../db/sqlMaquina.js';
import {
  HORAS_ENCENDIDO_MANUAL,
  PAUSA_OTRO_CICLO_SEGUNDOS,
  maxCiclosDeMaquina,
  instanteOtroCiclo,
  finCiclo,
  esperandoArranque,
  sincronizarSonoff,
} from '../services/sincronizarSonoff.js';
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

// Agrega a la fila de la máquina lo que la tarjeta necesita para ofrecer otro
// ciclo (mig. 108). Se calcula aquí y no en el frontend porque depende del
// margen y de la pausa, que son configuración del servidor: mandarlos al
// navegador para que allá se haga la resta sería duplicar la regla en dos
// lugares que pueden desincronizarse.
//
//   ciclos_carga        → cuántos ciclos lleva (1 = va en el primero)
//   ciclos_max          → el tope, para poder decir "ciclo 1 de 2"
//   otro_ciclo_desde    → cuándo se le puede devolver la corriente (ISO)
//   esperando_arranque  → ya tiene corriente y falta que la arranquen (mig. 110)
//
// Los dos últimos son los que parten el botón en dos pasos: primero "Encender
// máquina" —que no se habilita hasta pasada la pausa sin corriente— y después
// "Otro ciclo", que arranca el cronómetro cuando el lavado ya empezó.
const conDatosDeOtroCiclo = (m) => {
  const ciclos = m.ciclos_carga ?? null;
  const desde = instanteOtroCiclo(m);
  // El tope no es el mismo para todas: una lavadora sin tiempo configurado
  // corre un solo ciclo. Sale de la fila, así que la consulta tiene que traer
  // `minutos_ciclo`.
  // `ciclo_unico` viene de la carga que corre ahora (lateral de getMaquinas),
  // así que el tope se calcula con la fila completa.
  const maxCiclos = maxCiclosDeMaquina(m);
  return {
    ...m,
    ciclos_carga: ciclos,
    ciclos_max: maxCiclos,
    esperando_arranque: esperandoArranque(m),
    otro_ciclo_desde:
      ciclos != null && ciclos < maxCiclos && desde != null
        ? new Date(desde).toISOString()
        : null,
  };
};

export const getMaquinas = async (req, res) => {
  try {
    // Dos datos que las pantallas de asignación necesitan, además del estado:
    //
    // · "reservada": la máquina está libre pero ya la tiene asignada otra nota
    //   abierta que aún no la arranca. NO bloquea —asignar no aparta— pero se
    //   muestra para avisar que alguien más va por ella.
    // · "en_uso_folio": la nota que la está usando ahora mismo. Es la que se
    //   la quedó al darle a Iniciar —por eso se busca por `iniciada_at`, la
    //   marca de haberla arrancado—; las demás tienen que cambiar de máquina.
    //   Resolverlo por la nota más antigua con la máquina ASIGNADA era mirar el
    //   dato equivocado: asignar no aparta, así que la nota vieja que nunca le
    //   dio a Iniciar salía como dueña del ciclo de otra, con su botón de
    //   "Detener Lavado" al lado (2026-09-22).
    const { rows } = await pool.query(
      `SELECT m.*,
              ${MINUTOS_CONFIGURADOS} AS minutos_ciclo,
              -- Los tiempos que ofrece su modelo y si hay que preguntar cuál
              -- usar al iniciarla (mig. 120).
              ${TIEMPOS_DEL_MODELO} AS modelo_tiempos,
              -- Lo que su marca dice del arranque y de los ciclos (mig. 122).
              ${OPCIONES_DE_MARCA} AS marca_opciones,
              -- Cronómetro en vez de temporizador (2026-10-02): la tarjeta
              -- cuenta hacia arriba y ofrece Finalizar siempre.
              ${esCronometroSql('m')} AS cronometro,
              -- Cronómetro que arranca con "Iniciar" y no al encender.
              ${conIniciarSql('m')} AS con_iniciar,
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
                -- La arrancó esta nota, o está encendida esperando su arranque
                -- (mig. 110): en esa ventana la máquina ya es suya aunque el
                -- cronómetro no haya empezado.
                (nc.lavadora_id = m.id
                 AND (nc.lavadora_iniciada_at IS NOT NULL OR m.encendida_para_nota_id = n.id))
                OR (nc.secadora_id = m.id
                    AND (nc.secadora_iniciada_at IS NOT NULL OR m.encendida_para_nota_id = n.id))
              )
            -- La última en arrancarla es la que la tiene: una carga puede
            -- repetir máquina, y la encendida sin arrancar va al final.
            ORDER BY (CASE WHEN nc.lavadora_id = m.id THEN nc.lavadora_iniciada_at
                           ELSE nc.secadora_iniciada_at END) DESC NULLS LAST
            LIMIT 1
         ) u ON TRUE
         -- Ciclos que lleva la carga que está corriendo en esta máquina
         -- (mig. 108). Va aparte del lateral de arriba a propósito: aquel
         -- responde "qué nota la tiene" y aquí hace falta la CARGA concreta,
         -- que además tiene que haber arrancado de verdad (mig. 097).
         LEFT JOIN LATERAL (
           SELECT CASE WHEN nc.lavadora_id = m.id THEN nc.lavadora_ciclos
                       ELSE nc.secadora_ciclos END AS ciclos,
                  -- ¿Esta vuelta es de un solo ciclo? (mig. 115) Es de la
                  -- PASADA: la misma lavadora puede dar dos ciclos en el
                  -- lavado de la nota y uno en el relavado de después.
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

    // Una nota "usó" la máquina si alguna de sus cargas corrió en ella. Se lee
    // del historial de pasadas (mig. 114) y no de lavadora_id / secadora_id:
    // esos se vacían al finalizar, así que solo veían la máquina mientras
    // seguía corriendo y el historial de uso quedaba vacío (2026-10-03).
    // Una pasada cuenta si la máquina arrancó: tiene su encendido sellado
    // (mig. 140) o la carga arrancó ese hueco (mig. 097).
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

    // Ciclos de esta máquina: una fila por PASADA, así que una carga que se
    // relavó o se secó de más en ella cuenta cada vuelta (2026-10-03).
    //
    // Lo generado es lo que vale CADA vez que se usó la máquina, no el total
    // de la nota (que en Por Encargo paga el servicio entero, con todas sus
    // máquinas). El primer ciclo de la carga vale lo que se le cobró a ese
    // hueco; si no se le cobró aparte (Por Encargo, que va con precio de
    // servicio) o es una vuelta más, vale la tarifa de la máquina en Ajustes.
    // La descripción son las máquinas que usó la carga (*_usada_id).
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
              -- Cuánto estuvo encendida en este ciclo (migs. 140-141). Si aún
              -- no se finaliza pero ya pasó su tope, el reloj se paró ahí y se
              -- cuenta en vivo, como en Ventas.
              p.finalizada_at IS NULL AND vivo.al_tope AS tope_vivo,
              CASE WHEN p.finalizada_at IS NOT NULL
                   THEN ROUND(EXTRACT(EPOCH FROM p.finalizada_at - p.encendida_at))::int
                   WHEN vivo.al_tope THEN mx.ciclo_minutos * 60
              END AS segundos,
              p.llego_tope OR (p.finalizada_at IS NULL AND vivo.al_tope) AS tope,
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
                    AND mx.en_uso_desde + make_interval(mins => mx.ciclo_minutos) <= NOW()
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
      // Clientes: autoservicio = 1 cliente cada uno; el resto, por cliente,
      // con las notas que trajo (2026-10-03: antes el registrado iba sin nota).
      // Por Encargo de mostrador no tiene cliente: cuenta como uno, igual que
      // el autoservicio.
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
      });
    }

    // En el detalle de notas, cada nota vale lo que generó EN ESTA MÁQUINA (sus
    // ciclos), no su total: así cuadra con la columna Generado.
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
             marca = $14,
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

// ── PATCH /maquinas/:id/otro-ciclo ──────────────────────────
// Re-arma una máquina para el siguiente ciclo de la MISMA carga (mig. 108).
//
// El ciclo real de una LG son 15 min y una carga necesita dos seguidos. Al
// cumplirse el primero la máquina se queda sin corriente (corte por fin de
// ciclo) y su temporizador llega a cero: sin esto, el único modo de seguir era
// el encendido manual de Gestión, que es de admin. Aquí lo puede hacer quien
// esté en el mostrador.
//
// Lo que cambia es el reloj, no la nota: `en_uso_desde` vuelve a NOW() y el
// contador de la carga sube. `ciclo_minutos` no se recalcula —es la misma
// máquina y la misma marca, así que el ciclo dura lo mismo— y el precio
// tampoco: los dos ciclos son una sola carga cobrada una vez.
//
// Tres candados, en este orden: que el ciclo anterior haya TERMINADO, que la
// pausa sin corriente se haya cumplido, y que la carga no haya agotado su tope.
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

    // La carga que de verdad la arrancó (mig. 097). Se bloquea para que dos
    // empleados no puedan re-armar el mismo ciclo a la vez y saltarse el tope.
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

    // Una lavadora sin tiempo de marca corre un solo ciclo, y la vuelta
    // REPETIDA sobre la misma carga también (mig. 115). Se revalida aquí y no
    // solo en la tarjeta porque este endpoint es lo que de verdad alarga el
    // lavado: el botón es únicamente quien lo pide.
    const maxCiclos = maxCiclosDeMaquina({ ...maq, ciclo_unico: carga.ciclo_unico });
    if (carga.ciclos >= maxCiclos) {
      await client.query('ROLLBACK');
      return res.status(400).json({
        message: maxCiclos > 1
          ? `Esta carga ya corrió sus ${maxCiclos} ciclos. Termínala para liberar ${maq.nombre}.`
          : carga.ciclo_unico
          ? `Esta vuelta es una repetición (relavado o secado de más), así que corre un solo ciclo. Termínala para liberar ${maq.nombre}.`
          // Una secadora corre un ciclo por regla del negocio, tenga o no
          // tiempo de marca: mandarla a configurarlo no arregla nada.
          : maq.tipo === 'secadora'
          ? `Un secado es un solo ciclo. Termínalo para liberar ${maq.nombre}.`
          : `${maq.nombre} no tiene configurado el tiempo de su marca, así que su carga corre un solo ciclo. `
            + 'Termínala, o configura el tiempo en Ajustes → Marcas y tiempos.',
      });
    }

    // Si ya se le dio a "Encender máquina" para esta vuelta (mig. 110), la
    // máquina está esperando arranque: sin cronómetro y con corriente. Los
    // relojes de abajo ya se cumplieron ANTES de encenderla —es lo que dejó que
    // el botón apareciera— y volver a exigirlos aquí bloquearía el segundo ciclo
    // para siempre, porque al encender se borró el `en_uso_desde` que miden.
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

      // La pausa sin corriente es parte del flujo pedido por el negocio, no un
      // detalle de la UI: si se pudiera saltar desde la API, el botón de la
      // tarjeta sería el único que la respeta.
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

    // Reiniciar en_uso_desde es lo que vuelve a arrancar el temporizador y, de
    // paso, lo que hace que la máquina deje de estar vencida: la sincronización
    // de abajo la vuelve a encender.
    //
    // El ciclo se vuelve a sellar porque "Encender máquina" lo dejó en NULL: una
    // máquina esperando arranque no tiene cronómetro. Sale de su modelo o su
    // marca (migs. 117 y 107) con el mismo respaldo por tamaño de siempre, para
    // que el segundo ciclo dure exactamente lo que duró el primero.
    const { rows: upd } = await client.query(
      `UPDATE maquinas m
          SET en_uso_desde = NOW(),
              encendida_sin_iniciar_at = NULL,
              encendida_para_nota_id   = NULL,
              ciclo_minutos = COALESCE(
                m.ciclo_minutos,
                ${MINUTOS_CONFIGURADOS},
                (SELECT CASE
                          -- La secadora también tiene respaldo por tamaño
                          -- (mig. 051): la columna plana es la mediana.
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

    // Fuera de la transacción: el trigger de LISTEN/NOTIFY solo mira el estado
    // y el enlace (mig. 075), y aquí ninguno cambió, así que el encendido hay
    // que pedirlo a mano. Esto además reprograma el corte del nuevo ciclo.
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
        // La consulta de arriba trae la máquina sola; el tope de ESTA vuelta
        // lo decide la pasada, que ya se leyó con la carga.
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
