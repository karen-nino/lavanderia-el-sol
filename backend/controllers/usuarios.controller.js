import pool from '../db/pool.js';
import bcrypt from 'bcrypt';
import { esAdmin } from '../middleware/roles.js';

const ROL_VALIDOS = ['admin_main', 'admin', 'operador'];

export const getEmpleados = async (req, res) => {
  try {
    // Un admin ve los empleados de TODAS las sucursales (Empleados es
    // admin-only). Si no es admin, se limita a la sucursal activa.
    const sucursalFiltro = esAdmin(req.user?.rol) ? null : req.sucursal;
    const { rows } = await pool.query(
      `SELECT id, nombre, apellido, rol, sucursal, activo, es_prueba, created_at
         FROM usuarios
        WHERE activo = TRUE
          AND ($1::text IS NULL OR sucursal = $1)
        ORDER BY sucursal ASC, nombre ASC`,
      [sucursalFiltro]
    );
    res.json(rows);
  } catch (err) {
    console.error('getEmpleados error:', err);
    res.status(500).json({ message: 'Error interno del servidor.' });
  }
};

// ── GET /usuarios/:id/desempeno ─────────────────────────────
// Desempeño diario del empleado, derivado de las notas que creó.
// "Vendido" = valor (precio_total) de todas sus notas no canceladas,
// atribuido al día en que se crearon. Métricas por día: notas, vendido,
// máquinas distintas, cargas, productos despachados y clientes (cada
// autoservicio cuenta como 1 cliente; el resto, sus clientes distintos).
export const getDesempeno = async (req, res) => {
  const id = Number(req.params.id);
  if (!id) return res.status(400).json({ message: 'Empleado inválido.' });

  try {
    const { rows: emp } = await pool.query(
      'SELECT id, nombre, apellido, rol, sucursal, es_prueba FROM usuarios WHERE id = $1',
      [id]
    );
    if (emp.length === 0) return res.status(404).json({ message: 'Empleado no encontrado.' });

    // Se traen las notas del empleado y, por separado, sus cargas y productos.
    // El desglose por día (con el detalle de cada métrica) se arma en JS para
    // que cada número y el contenido de su modal siempre coincidan.
    const { rows: notas } = await pool.query(
      `SELECT n.id, DATE(n.created_at) AS fecha, n.folio, n.modalidad, n.estado,
              n.precio_total, n.cantidad_cargas, n.cliente_id,
              c.nombre AS cliente_nombre, c.apellido AS cliente_apellido,
              n.maquina_id,  ml.nombre AS maquina_nombre,  ml.tipo AS maquina_tipo,
              n.secadora_id, ms.nombre AS secadora_nombre, ms.tipo AS secadora_tipo
         FROM notas n
         LEFT JOIN clientes c  ON c.id  = n.cliente_id
         LEFT JOIN maquinas ml ON ml.id = n.maquina_id
         LEFT JOIN maquinas ms ON ms.id = n.secadora_id
        WHERE n.usuario_id = $1 AND n.estado <> 'CANCELADA'
        ORDER BY n.created_at DESC`,
      [id]
    );

    // Cargas con la máquina que se usó: la activa (lavadora_id/secadora_id) o,
    // si ya terminó y se desvinculó, la registrada (lavadora_usada_id/…).
    const { rows: cargas } = await pool.query(
      `SELECT nc.nota_id, nc.precio_lavadora, nc.precio_secadora,
              COALESCE(nc.lavadora_id, nc.lavadora_usada_id) AS lav_id,
              ml.nombre AS lav_nombre, ml.tipo AS lav_tipo,
              COALESCE(nc.secadora_id, nc.secadora_usada_id) AS sec_id,
              ms.nombre AS sec_nombre, ms.tipo AS sec_tipo
         FROM nota_cargas nc
         JOIN notas n ON n.id = nc.nota_id
         LEFT JOIN maquinas ml ON ml.id = COALESCE(nc.lavadora_id, nc.lavadora_usada_id)
         LEFT JOIN maquinas ms ON ms.id = COALESCE(nc.secadora_id, nc.secadora_usada_id)
        WHERE n.usuario_id = $1 AND n.estado <> 'CANCELADA'
        ORDER BY nc.nota_id, nc.orden`,
      [id]
    );

    const { rows: productos } = await pool.query(
      `SELECT np.nota_id, np.cantidad, p.nombre
         FROM nota_productos np
         JOIN notas n ON n.id = np.nota_id
         JOIN productos p ON p.id = np.producto_id
        WHERE n.usuario_id = $1 AND n.estado <> 'CANCELADA'`,
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
          fecha, notas: 0, vendido: 0,
          _notas: [],              // { folio, modalidad, cliente, precio }
          _maquinas: new Map(),    // id -> { nombre, tipo, usos }
          _cargas: [],
          _productos: new Map(),   // nombre -> cantidad
          _clientesReg: new Map(), // cliente_id -> nombre
          _autoservicios: [],      // { folio }
        });
      }
      return buckets.get(k);
    };
    const sumarMaquina = (b, mid, nombre, tipo) => {
      if (!mid) return;
      const m = b._maquinas.get(mid) ?? { nombre: nombre || 'Máquina', tipo, usos: 0 };
      m.usos += 1;
      b._maquinas.set(mid, m);
    };

    for (const n of notas) {
      const b = getBucket(n.fecha);
      b.notas   += 1;
      b.vendido += Number(n.precio_total) || 0;
      const clienteNombre = `${n.cliente_nombre ?? ''}${n.cliente_apellido ? ' ' + n.cliente_apellido : ''}`.trim();
      b._notas.push({
        id:        n.id,
        folio:     n.folio,
        modalidad: n.modalidad,
        estado:    n.estado,
        cliente:   clienteNombre || null,
        precio:    Number(n.precio_total) || 0,
      });
      // Clientes: autoservicio = 1 cliente cada uno; el resto, por cliente.
      if (n.modalidad === 'AUTOSERVICIO') {
        b._autoservicios.push({ folio: n.folio });
      } else if (n.cliente_id) {
        b._clientesReg.set(n.cliente_id, clienteNombre || 'Cliente');
      }
      // Notas legadas sin filas en nota_cargas: máquinas y cargas denormalizadas.
      if (!notasConCargas.has(n.id)) {
        sumarMaquina(b, n.maquina_id,  n.maquina_nombre,  n.maquina_tipo);
        sumarMaquina(b, n.secadora_id, n.secadora_nombre, n.secadora_tipo);
        const nCargas = Number(n.cantidad_cargas) || 0;
        const desc = [n.maquina_nombre, n.secadora_nombre].filter(Boolean).join(' + ') || 'Sin máquina';
        for (let k = 0; k < nCargas; k++) {
          b._cargas.push({ folio: n.folio, descripcion: desc, precio: nCargas > 0 ? (Number(n.precio_total) || 0) / nCargas : 0 });
        }
      }
    }

    for (const c of cargas) {
      const n = notaPorId.get(c.nota_id);
      if (!n) continue;
      const b = getBucket(n.fecha);
      sumarMaquina(b, c.lav_id, c.lav_nombre, c.lav_tipo);
      sumarMaquina(b, c.sec_id, c.sec_nombre, c.sec_tipo);
      const partes = [c.lav_nombre, c.sec_nombre].filter(Boolean);
      b._cargas.push({
        folio: n.folio,
        descripcion: partes.join(' + ') || 'Sin máquina',
        precio: (Number(c.precio_lavadora) || 0) + (Number(c.precio_secadora) || 0),
      });
    }

    for (const p of productos) {
      const n = notaPorId.get(p.nota_id);
      if (!n) continue;
      const b = getBucket(n.fecha);
      b._productos.set(p.nombre, (b._productos.get(p.nombre) || 0) + Number(p.cantidad));
    }

    const diasFmt = [...buckets.values()]
      .sort((a, b) => new Date(b.fecha) - new Date(a.fecha))
      .map((b) => {
        const maquinas  = [...b._maquinas.values()].map((m) => ({ nombre: m.nombre, tipo: m.tipo, usos: m.usos }));
        const productos = [...b._productos.entries()].map(([nombre, cantidad]) => ({ nombre, cantidad }));
        const clientes  = [
          ...b._autoservicios.map((a) => ({ nombre: 'Autoservicio', folio: a.folio })),
          ...[...b._clientesReg.values()].map((nombre) => ({ nombre, folio: null })),
        ];
        return {
          fecha:     b.fecha,
          notas:     b.notas,
          vendido:   b.vendido,
          maquinas:  maquinas.length,
          cargas:    b._cargas.length,
          productos: productos.reduce((s, p) => s + p.cantidad, 0),
          clientes:  clientes.length,
          detalle:   { notas: b._notas, maquinas, cargas: b._cargas, productos, clientes },
        };
      });

    const resumen = diasFmt.reduce(
      (acc, d) => ({
        dias_activos: acc.dias_activos + 1,
        notas:        acc.notas + d.notas,
        vendido:      acc.vendido + d.vendido,
        cargas:       acc.cargas + d.cargas,
        productos:    acc.productos + d.productos,
      }),
      { dias_activos: 0, notas: 0, vendido: 0, cargas: 0, productos: 0 }
    );

    res.json({ empleado: emp[0], resumen, dias: diasFmt });
  } catch (err) {
    console.error('getDesempeno error:', err);
    res.status(500).json({ message: 'Error interno del servidor.' });
  }
};

export const createEmpleado = async (req, res) => {
  const { nombre, apellido, password, rol, sucursal } = req.body;

  if (!nombre?.trim()) return res.status(400).json({ message: 'El nombre es requerido.' });
  if (!password || password.length < 8) {
    return res.status(400).json({ message: 'La contraseña debe tener al menos 8 caracteres.' });
  }
  const rolFinal = ROL_VALIDOS.includes(rol) ? rol : 'operador';

  if (rolFinal === 'admin_main' && req.user.rol !== 'admin_main') {
    return res.status(403).json({ message: 'Solo el Admin Main puede asignar este rol.' });
  }

  // Un administrador es global: no se liga a ninguna sucursal (NULL). Para un
  // empleado (operador) se usa la sucursal del formulario o, si no llega, la
  // sucursal activa de quien lo crea.
  const sucursalFinal = esAdmin(rolFinal) ? null : (sucursal?.trim() || req.sucursal);

  try {
    const hashed = await bcrypt.hash(password, 10);
    const { rows } = await pool.query(
      `INSERT INTO usuarios (nombre, apellido, password, rol, sucursal)
       VALUES ($1, $2, $3, $4, $5)
       RETURNING id, nombre, apellido, rol, sucursal, activo, es_prueba, created_at`,
      [nombre.trim(), apellido?.trim() || null, hashed, rolFinal, sucursalFinal]
    );
    res.status(201).json(rows[0]);
  } catch (err) {
    console.error('createEmpleado error:', err);
    res.status(500).json({ message: 'Error interno del servidor.' });
  }
};

export const updateEmpleado = async (req, res) => {
  const targetId = Number(req.params.id);
  const { nombre, apellido, password, rol, sucursal } = req.body;
  const callerEsMain = req.user.rol === 'admin_main';

  try {
    const { rows: targetRows } = await pool.query(
      'SELECT id, rol, es_prueba FROM usuarios WHERE id = $1 AND activo = TRUE',
      [targetId]
    );
    if (targetRows.length === 0) {
      return res.status(404).json({ message: 'Empleado no encontrado.' });
    }
    const target = targetRows[0];

    // Solo el Admin Main puede modificar a un administrador (admin o admin_main);
    // cualquiera puede editar su propio usuario.
    if (esAdmin(target.rol) && !callerEsMain && targetId !== req.user.id) {
      return res.status(403).json({ message: 'Solo el Admin Main puede modificar a un administrador.' });
    }

    const updates = [];
    const values  = [];
    let i = 1;

    if (nombre !== undefined) {
      if (!nombre.trim()) return res.status(400).json({ message: 'El nombre no puede estar vacío.' });
      updates.push(`nombre = $${i++}`); values.push(nombre.trim());
    }
    if (apellido !== undefined) {
      updates.push(`apellido = $${i++}`); values.push(apellido?.trim() || null);
    }
    if (rol !== undefined) {
      if (!ROL_VALIDOS.includes(rol)) {
        return res.status(400).json({ message: 'Rol inválido.' });
      }
      if (targetId === req.user.id) {
        return res.status(400).json({ message: 'No puedes cambiar tu propio rol.' });
      }
      if (rol === 'admin_main' && !callerEsMain) {
        return res.status(403).json({ message: 'Solo el Admin Main puede asignar este rol.' });
      }
      updates.push(`rol = $${i++}`); values.push(rol);
    }
    // Un administrador y un usuario de prueba son globales (sucursal NULL); un
    // empleado normal requiere una. El rol resultante es el que venga en la
    // petición o, si no cambia, el actual.
    const rolResultante = rol !== undefined ? rol : target.rol;
    if (esAdmin(rolResultante) || target.es_prueba) {
      updates.push(`sucursal = $${i++}`); values.push(null);
    } else if (sucursal !== undefined) {
      if (!sucursal?.trim()) return res.status(400).json({ message: 'La sucursal no puede estar vacía.' });
      updates.push(`sucursal = $${i++}`); values.push(sucursal.trim());
    }
    if (password) {
      if (password.length < 8) {
        return res.status(400).json({ message: 'La contraseña debe tener al menos 8 caracteres.' });
      }
      const hashed = await bcrypt.hash(password, 10);
      updates.push(`password = $${i++}`); values.push(hashed);
    }

    if (updates.length === 0) {
      return res.status(400).json({ message: 'No hay campos para actualizar.' });
    }
    values.push(targetId);

    const { rows } = await pool.query(
      `UPDATE usuarios SET ${updates.join(', ')}
         WHERE id = $${i} AND activo = TRUE
         RETURNING id, nombre, apellido, rol, sucursal, activo, es_prueba, created_at`,
      values
    );
    if (rows.length === 0) return res.status(404).json({ message: 'Empleado no encontrado.' });
    res.json(rows[0]);
  } catch (err) {
    console.error('updateEmpleado error:', err);
    res.status(500).json({ message: 'Error interno del servidor.' });
  }
};

export const deleteEmpleado = async (req, res) => {
  const targetId = Number(req.params.id);

  if (targetId === req.user.id) {
    return res.status(400).json({ message: 'No puedes eliminar tu propio usuario.' });
  }

  try {
    const { rows: targetRows } = await pool.query(
      'SELECT id, rol FROM usuarios WHERE id = $1 AND activo = TRUE',
      [targetId]
    );
    if (targetRows.length === 0) {
      return res.status(404).json({ message: 'Empleado no encontrado.' });
    }
    // Solo el Admin Main puede eliminar a un administrador (admin o admin_main).
    if (esAdmin(targetRows[0].rol) && req.user.rol !== 'admin_main') {
      return res.status(403).json({ message: 'Solo el Admin Main puede eliminar a un administrador.' });
    }

    const { rows } = await pool.query(
      `UPDATE usuarios SET activo = FALSE
         WHERE id = $1 AND activo = TRUE
         RETURNING id`,
      [targetId]
    );
    if (rows.length === 0) return res.status(404).json({ message: 'Empleado no encontrado.' });
    res.json({ message: 'Empleado eliminado.' });
  } catch (err) {
    console.error('deleteEmpleado error:', err);
    res.status(500).json({ message: 'Error interno del servidor.' });
  }
};
