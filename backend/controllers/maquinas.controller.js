import pool from '../db/pool.js';

const ESTADOS_VALIDOS = ['disponible', 'en_uso', 'mantenimiento'];
const TIPOS_VALIDOS   = ['lavadora_mediana', 'lavadora_jumbo', 'secadora'];
const CAPACIDADES_VALIDAS = ['20kg', '35kg'];
const TAMANOS_VALIDOS = ['mediana', 'jumbo'];

export const getMaquinas = async (req, res) => {
  try {
    const { rows } = await pool.query(
      'SELECT * FROM maquinas WHERE sucursal = $1 ORDER BY tipo ASC, nombre ASC',
      [req.sucursal]
    );
    res.json(rows);
  } catch (err) {
    console.error('getMaquinas error:', err);
    res.status(500).json({ message: 'Error interno del servidor.' });
  }
};

// ── GET /maquinas/:id/uso ───────────────────────────────────
// Uso diario de la máquina, derivado de las notas que la usaron.
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
    // (autoservicio, tabla nota_cargas) o en sus columnas legadas
    // maquina_id / secadora_id (Por Encargo y notas viejas).
    const { rows: notas } = await pool.query(
      `SELECT n.id, DATE(n.created_at) AS fecha, n.folio, n.modalidad, n.estado,
              n.precio_total, n.estado_pago, n.cantidad_cargas, n.cliente_id,
              n.usuario_id, u.nombre AS empleado_nombre,
              c.nombre AS cliente_nombre, c.apellido AS cliente_apellido
         FROM notas n
         LEFT JOIN usuarios u ON u.id = n.usuario_id
         LEFT JOIN clientes c ON c.id = n.cliente_id
        WHERE (
                n.maquina_id = $1 OR n.secadora_id = $1
                OR EXISTS (
                     SELECT 1 FROM nota_cargas nc
                      WHERE nc.nota_id = n.id AND (nc.lavadora_id = $1 OR nc.secadora_id = $1)
                   )
              )
          AND n.estado <> 'CANCELADA'
        ORDER BY n.created_at DESC`,
      [id]
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
        WHERE (nc.lavadora_id = $1 OR nc.secadora_id = $1)
          AND n.estado <> 'CANCELADA'
        ORDER BY nc.nota_id, nc.orden`,
      [id]
    );

    // ── Agregación por día ──────────────────────────────────
    const notaPorId = new Map(notas.map((n) => [n.id, n]));
    const notasConCargas = new Set(cargas.map((c) => c.nota_id));
    const buckets = new Map();
    const getBucket = (fecha) => {
      const k = new Date(fecha).toISOString();
      if (!buckets.has(k)) {
        buckets.set(k, {
          fecha, generado: 0,
          _usos: [],               // { id, folio, modalidad, estado, cliente, precio }
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
        modalidad: n.modalidad,
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
      if (n.modalidad === 'AUTOSERVICIO') {
        b._autoservicios.push({ folio: n.folio });
      } else if (n.cliente_id) {
        b._clientesReg.set(n.cliente_id, clienteNombre || 'Cliente');
      }
      // Notas legadas sin filas en nota_cargas: cargas denormalizadas.
      if (!notasConCargas.has(n.id)) {
        const nCargas = Number(n.cantidad_cargas) || 0;
        for (let k = 0; k < nCargas; k++) {
          b._cargas.push({
            folio: n.folio,
            descripcion: maq[0].nombre,
            precio: nCargas > 0 ? (Number(n.precio_total) || 0) / nCargas : 0,
          });
        }
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
  const { nombre, tipo, tamano, modelo, capacidad, numero_serie, fecha_adquisicion, notas } = req.body;

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

  try {
    const { rows } = await pool.query(
      `INSERT INTO maquinas (nombre, tipo, tamano, modelo, capacidad, numero_serie, fecha_adquisicion, sucursal, notas)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
       RETURNING *`,
      [nombre, tipo, tamano || null, modelo, capacidad, numero_serie, fecha_adquisicion, req.sucursal, notas]
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
  const { nombre, tipo, tamano, modelo, capacidad, numero_serie, fecha_adquisicion, notas, estado } = req.body;

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

  try {
    // estado es opcional: si llega null se conserva el actual. Al cambiarlo se
    // mantiene en_uso_desde coherente, igual que en cambiarEstadoMaquina.
    const { rows } = await pool.query(
      `UPDATE maquinas
         SET nombre = $1, tipo = $2, tamano = $3, modelo = $4, capacidad = $5, numero_serie = $6, fecha_adquisicion = $7, notas = $8,
             estado = COALESCE($9::estado_maquina, estado),
             en_uso_desde = CASE
               WHEN $9::estado_maquina IS NULL THEN en_uso_desde
               WHEN $9::estado_maquina = 'en_uso'::estado_maquina THEN NOW()
               ELSE NULL
             END
       WHERE id = $10 AND sucursal = $11
       RETURNING *`,
      [nombre, tipo, tamano || null, modelo, capacidad, numero_serie, fecha_adquisicion, notas, estado ?? null, id, req.sucursal]
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
      'SELECT id, nombre, estado FROM maquinas WHERE id = $1 AND sucursal = $2 FOR UPDATE',
      [id, req.sucursal]
    );
    if (maqRows.length === 0) {
      await client.query('ROLLBACK');
      return res.status(404).json({ message: 'Máquina no encontrada.' });
    }
    const maq = maqRows[0];
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
             OR EXISTS (SELECT 1 FROM maquinas m WHERE m.id = n.maquina_id AND m.tipo <> 'secadora' AND m.estado = 'en_uso')
             THEN 'LAVANDO'
           WHEN EXISTS (SELECT 1 FROM nota_cargas nc JOIN maquinas m ON m.id = nc.secadora_id
                         WHERE nc.nota_id = n.id AND m.estado = 'en_uso')
             OR EXISTS (SELECT 1 FROM maquinas m WHERE m.id = n.secadora_id AND m.tipo = 'secadora' AND m.estado = 'en_uso')
             THEN 'SECANDO'
           ELSE 'EN_ESPERA'
         END)::estado_orden
       WHERE n.estado IN ('LAVANDO', 'SECANDO')
         AND (
           EXISTS (SELECT 1 FROM nota_cargas nc WHERE nc.nota_id = n.id AND (nc.lavadora_id = $1 OR nc.secadora_id = $1))
           OR n.maquina_id = $1 OR n.secadora_id = $1
         )`,
      [id]
    );

    if (estabaEnUso) {
      const { rows: cfg } = await client.query('SELECT alerta_ciclo_detenido FROM ajustes WHERE id = 1');
      if (cfg[0]?.alerta_ciclo_detenido) {
        const { rows: u } = await client.query('SELECT nombre FROM usuarios WHERE id = $1', [req.user.id]);
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
