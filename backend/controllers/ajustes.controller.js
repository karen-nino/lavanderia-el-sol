import pool from '../db/pool.js';
import multer from 'multer';
import path from 'path';
import fs from 'fs';
import { esAdmin } from '../middleware/roles.js';

// Crear carpeta uploads/logo/ si no existe
const uploadsDir = './uploads/logo';
if (!fs.existsSync(uploadsDir)) {
  fs.mkdirSync(uploadsDir, { recursive: true });
}

const storage = multer.diskStorage({
  destination: (req, file, cb) => cb(null, uploadsDir),
  filename: (req, file, cb) => {
    const ext = path.extname(file.originalname).toLowerCase();
    cb(null, `logo-${Date.now()}${ext}`);
  },
});

const fileFilter = (req, file, cb) => {
  const allowed = ['.jpg', '.jpeg', '.png', '.webp'];
  const ext = path.extname(file.originalname).toLowerCase();
  if (allowed.includes(ext)) {
    cb(null, true);
  } else {
    cb(new Error('Formato no permitido. Use jpg, jpeg, png o webp.'));
  }
};

export const upload = multer({
  storage,
  fileFilter,
  limits: { fileSize: 2 * 1024 * 1024 }, // 2MB
});

// ── GET /ajustes ──────────────────────────────────────────────
export const getAjustes = async (req, res) => {
  try {
    const { rows } = await pool.query('SELECT * FROM ajustes WHERE id = 1');
    res.json(rows[0]);
  } catch (err) {
    console.error('getAjustes error:', err);
    res.status(500).json({ message: 'No se pudieron cargar los ajustes. Intenta de nuevo.' });
  }
};

// ── PATCH /ajustes ────────────────────────────────────────────
export const updateAjustes = async (req, res) => {
  if (!esAdmin(req.user.rol)) {
    return res.status(403).json({ message: 'Solo administradores pueden modificar los ajustes.' });
  }

  const {
    precio_carga_mediana,
    precio_carga_jumbo,
    precio_carga_secadora,
    precio_secadora_jumbo,
    precio_secadora_edredon,
    precio_edredon_jumbo,
    tope_carga_chico,
    tope_carga_grande,
    tope_carga_jumbo,
    tope_carga_edredon,
    tiempo_carga_mediana,
    tiempo_carga_jumbo,
    tiempo_edredon_jumbo,
    tiempo_carga_secadora,
    tiempo_secadora_jumbo,
    tiempo_secadora_edredon,
    nombre_negocio,
    rfc,
    ticket_nota,
    direccion,
    telefono,
    stock_minimo_global,
    alerta_ciclo_detenido,
  } = req.body;

  // Validación numérica: sin esto, un precio negativo o texto llega a la
  // base (texto produce un 500 y un negativo descuadra todas las notas).
  const esNumero = (v) => (typeof v === 'number' || (typeof v === 'string' && v.trim() !== '')) && Number.isFinite(Number(v));

  // Los mensajes nombran el ajuste como lo ve el usuario en la pantalla, no
  // como se llama la columna en la base.
  const ETIQUETA = {
    precio_carga_mediana:    'El precio de la carga mediana',
    precio_carga_jumbo:      'El precio de la carga jumbo',
    precio_carga_secadora:   'El precio del secado',
    precio_secadora_jumbo:   'El precio del secado jumbo',
    precio_secadora_edredon: 'El precio del secado de edredón',
    precio_edredon_jumbo:    'El precio del edredón en jumbo',
    tope_carga_chico:        'El tope de la carga chica',
    tope_carga_grande:       'El tope de la carga grande',
    tope_carga_jumbo:        'El tope de la carga jumbo',
    tope_carga_edredon:      'El tope de la carga de edredón',
    tiempo_carga_mediana:    'El tiempo de la carga mediana',
    tiempo_carga_jumbo:      'El tiempo de la carga jumbo',
    tiempo_edredon_jumbo:    'El tiempo del edredón en jumbo',
    tiempo_carga_secadora:   'El tiempo del secado',
    tiempo_secadora_jumbo:   'El tiempo del secado jumbo',
    tiempo_secadora_edredon: 'El tiempo del secado de edredón',
  };
  const nombreDe = (campo) => ETIQUETA[campo] ?? `El ajuste "${campo}"`;

  const precios = { precio_carga_mediana, precio_carga_jumbo, precio_carga_secadora,
                    precio_secadora_jumbo, precio_secadora_edredon, precio_edredon_jumbo };
  for (const [campo, valor] of Object.entries(precios)) {
    if (valor !== undefined && (!esNumero(valor) || Number(valor) < 0)) {
      return res.status(400).json({ message: `${nombreDe(campo)} debe ser un número mayor o igual a 0.` });
    }
  }
  // Topes de precio por tamaño de carga: opcionales. null o '' los borra
  // (sin tope); si viene un valor debe ser un número mayor o igual a 0.
  const topes = { tope_carga_chico, tope_carga_grande, tope_carga_jumbo, tope_carga_edredon };
  for (const [campo, valor] of Object.entries(topes)) {
    if (valor !== undefined && valor !== null && valor !== '' &&
        (!esNumero(valor) || Number(valor) < 0)) {
      return res.status(400).json({ message: `${nombreDe(campo)} debe ser un número mayor o igual a 0. Déjalo vacío para quitar el tope.` });
    }
  }
  const topeONull = (v) => (v === null || v === '' ? null : v);

  const tiempos = { tiempo_carga_mediana, tiempo_carga_jumbo, tiempo_edredon_jumbo,
                    tiempo_carga_secadora, tiempo_secadora_jumbo, tiempo_secadora_edredon };
  for (const [campo, valor] of Object.entries(tiempos)) {
    if (valor !== undefined && (!esNumero(valor) || !Number.isInteger(Number(valor)) || Number(valor) < 1)) {
      return res.status(400).json({ message: `${nombreDe(campo)} debe ser un número entero de 1 minuto o más.` });
    }
  }
  if (stock_minimo_global !== undefined &&
      (!esNumero(stock_minimo_global) || !Number.isInteger(Number(stock_minimo_global)) || Number(stock_minimo_global) < 0)) {
    return res.status(400).json({ message: 'La existencia mínima debe ser un número entero de 0 o más.' });
  }

  // R.F.C.: texto libre (palabras, números y espacios, sin límite de largo),
  // siempre en MAYÚSCULAS y sin espacios sobrantes; vacío lo borra.
  const rfcLibre = (v) => {
    const limpio = String(v ?? '').trim().toUpperCase();
    return limpio === '' ? null : limpio;
  };

  // Nota al pie del ticket: texto libre tal cual lo escribe el negocio (respeta
  // renglones y mayúsculas); vacía la borra.
  const textoONull = (v) => {
    const limpio = String(v ?? '').trim();
    return limpio === '' ? null : limpio;
  };

  const updates = [];
  const values  = [];
  let i = 1;

  if (precio_carga_mediana  !== undefined) { updates.push(`precio_carga_mediana = $${i++}`);  values.push(precio_carga_mediana); }
  if (precio_carga_jumbo    !== undefined) { updates.push(`precio_carga_jumbo = $${i++}`);    values.push(precio_carga_jumbo); }
  if (precio_carga_secadora !== undefined) { updates.push(`precio_carga_secadora = $${i++}`); values.push(precio_carga_secadora); }
  if (precio_secadora_jumbo   !== undefined) { updates.push(`precio_secadora_jumbo = $${i++}`);   values.push(precio_secadora_jumbo); }
  if (precio_secadora_edredon !== undefined) { updates.push(`precio_secadora_edredon = $${i++}`); values.push(precio_secadora_edredon); }
  if (precio_edredon_jumbo  !== undefined) { updates.push(`precio_edredon_jumbo = $${i++}`);  values.push(precio_edredon_jumbo); }
  if (tope_carga_chico      !== undefined) { updates.push(`tope_carga_chico = $${i++}`);      values.push(topeONull(tope_carga_chico)); }
  if (tope_carga_grande     !== undefined) { updates.push(`tope_carga_grande = $${i++}`);     values.push(topeONull(tope_carga_grande)); }
  if (tope_carga_jumbo      !== undefined) { updates.push(`tope_carga_jumbo = $${i++}`);      values.push(topeONull(tope_carga_jumbo)); }
  if (tope_carga_edredon    !== undefined) { updates.push(`tope_carga_edredon = $${i++}`);    values.push(topeONull(tope_carga_edredon)); }
  if (tiempo_carga_mediana  !== undefined) { updates.push(`tiempo_carga_mediana = $${i++}`);  values.push(tiempo_carga_mediana); }
  if (tiempo_carga_jumbo    !== undefined) { updates.push(`tiempo_carga_jumbo = $${i++}`);    values.push(tiempo_carga_jumbo); }
  if (tiempo_edredon_jumbo  !== undefined) { updates.push(`tiempo_edredon_jumbo = $${i++}`);  values.push(tiempo_edredon_jumbo); }
  if (tiempo_carga_secadora !== undefined) { updates.push(`tiempo_carga_secadora = $${i++}`); values.push(tiempo_carga_secadora); }
  if (tiempo_secadora_jumbo   !== undefined) { updates.push(`tiempo_secadora_jumbo = $${i++}`);   values.push(tiempo_secadora_jumbo); }
  if (tiempo_secadora_edredon !== undefined) { updates.push(`tiempo_secadora_edredon = $${i++}`); values.push(tiempo_secadora_edredon); }
  if (nombre_negocio        !== undefined) { updates.push(`nombre_negocio = $${i++}`);        values.push(nombre_negocio); }
  if (rfc                   !== undefined) { updates.push(`rfc = $${i++}`);                   values.push(rfcLibre(rfc)); }
  if (ticket_nota           !== undefined) { updates.push(`ticket_nota = $${i++}`);           values.push(textoONull(ticket_nota)); }
  if (direccion             !== undefined) { updates.push(`direccion = $${i++}`);              values.push(direccion); }
  if (telefono              !== undefined) { updates.push(`telefono = $${i++}`);               values.push(telefono); }
  if (stock_minimo_global   !== undefined) { updates.push(`stock_minimo_global = $${i++}`);   values.push(stock_minimo_global); }
  if (alerta_ciclo_detenido !== undefined) { updates.push(`alerta_ciclo_detenido = $${i++}`); values.push(Boolean(alerta_ciclo_detenido)); }

  if (updates.length === 0) {
    return res.status(400).json({ message: 'No hay cambios que guardar.' });
  }
  updates.push('updated_at = NOW()');

  try {
    const { rows } = await pool.query(
      `UPDATE ajustes SET ${updates.join(', ')} WHERE id = 1 RETURNING *`,
      values
    );
    res.json(rows[0]);
  } catch (err) {
    console.error('updateAjustes error:', err);
    res.status(500).json({ message: 'No se pudieron guardar los ajustes. Intenta de nuevo.' });
  }
};

// ── POST /ajustes/logo ────────────────────────────────────────
export const uploadLogo = async (req, res) => {
  if (!esAdmin(req.user.rol)) {
    return res.status(403).json({ message: 'Solo administradores pueden modificar el logo.' });
  }
  if (!req.file) {
    return res.status(400).json({ message: 'No se recibió ningún archivo.' });
  }

  const logo_url = `/uploads/logo/${req.file.filename}`;

  try {
    await pool.query(
      'UPDATE ajustes SET logo_url = $1, updated_at = NOW() WHERE id = 1',
      [logo_url]
    );
    res.json({ logo_url });
  } catch (err) {
    console.error('uploadLogo error:', err);
    res.status(500).json({ message: 'No se pudo guardar el logo. Intenta de nuevo.' });
  }
};
