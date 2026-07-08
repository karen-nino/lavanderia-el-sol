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
    res.status(500).json({ message: 'Error interno del servidor.' });
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
    precio_edredon_jumbo,
    tiempo_carga_mediana,
    tiempo_carga_jumbo,
    tiempo_carga_secadora,
    nombre_negocio,
    direccion,
    telefono,
    stock_minimo_global,
    alerta_ciclo_detenido,
  } = req.body;

  const updates = [];
  const values  = [];
  let i = 1;

  if (precio_carga_mediana  !== undefined) { updates.push(`precio_carga_mediana = $${i++}`);  values.push(precio_carga_mediana); }
  if (precio_carga_jumbo    !== undefined) { updates.push(`precio_carga_jumbo = $${i++}`);    values.push(precio_carga_jumbo); }
  if (precio_carga_secadora !== undefined) { updates.push(`precio_carga_secadora = $${i++}`); values.push(precio_carga_secadora); }
  if (precio_edredon_jumbo  !== undefined) { updates.push(`precio_edredon_jumbo = $${i++}`);  values.push(precio_edredon_jumbo); }
  if (tiempo_carga_mediana  !== undefined) { updates.push(`tiempo_carga_mediana = $${i++}`);  values.push(tiempo_carga_mediana); }
  if (tiempo_carga_jumbo    !== undefined) { updates.push(`tiempo_carga_jumbo = $${i++}`);    values.push(tiempo_carga_jumbo); }
  if (tiempo_carga_secadora !== undefined) { updates.push(`tiempo_carga_secadora = $${i++}`); values.push(tiempo_carga_secadora); }
  if (nombre_negocio        !== undefined) { updates.push(`nombre_negocio = $${i++}`);        values.push(nombre_negocio); }
  if (direccion             !== undefined) { updates.push(`direccion = $${i++}`);              values.push(direccion); }
  if (telefono              !== undefined) { updates.push(`telefono = $${i++}`);               values.push(telefono); }
  if (stock_minimo_global   !== undefined) { updates.push(`stock_minimo_global = $${i++}`);   values.push(stock_minimo_global); }
  if (alerta_ciclo_detenido !== undefined) { updates.push(`alerta_ciclo_detenido = $${i++}`); values.push(Boolean(alerta_ciclo_detenido)); }

  if (updates.length === 0) {
    return res.status(400).json({ message: 'No hay campos para actualizar.' });
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
    res.status(500).json({ message: 'Error interno del servidor.' });
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
    res.status(500).json({ message: 'Error al guardar el logo.' });
  }
};
