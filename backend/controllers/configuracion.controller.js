import pool from '../db/pool.js';
import multer from 'multer';
import path from 'path';
import fs from 'fs';

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

// ── GET /configuracion ────────────────────────────────────────
export const getConfiguracion = async (req, res) => {
  try {
    const { rows } = await pool.query('SELECT * FROM configuracion WHERE id = 1');
    res.json(rows[0]);
  } catch (err) {
    console.error('getConfiguracion error:', err);
    res.status(500).json({ message: 'Error interno del servidor.' });
  }
};

// ── PATCH /configuracion ──────────────────────────────────────
export const updateConfiguracion = async (req, res) => {
  if (req.user.rol !== 'admin') {
    return res.status(403).json({ message: 'Solo administradores pueden modificar la configuración.' });
  }

  const { precio_autoservicio, nombre_negocio, direccion, telefono, stock_minimo_global } = req.body;

  const updates = [];
  const values  = [];
  let i = 1;

  if (precio_autoservicio  !== undefined) { updates.push(`precio_autoservicio = $${i++}`);  values.push(precio_autoservicio); }
  if (nombre_negocio       !== undefined) { updates.push(`nombre_negocio = $${i++}`);       values.push(nombre_negocio); }
  if (direccion            !== undefined) { updates.push(`direccion = $${i++}`);             values.push(direccion); }
  if (telefono             !== undefined) { updates.push(`telefono = $${i++}`);              values.push(telefono); }
  if (stock_minimo_global  !== undefined) { updates.push(`stock_minimo_global = $${i++}`);  values.push(stock_minimo_global); }

  if (updates.length === 0) {
    return res.status(400).json({ message: 'No hay campos para actualizar.' });
  }
  updates.push('updated_at = NOW()');

  try {
    const { rows } = await pool.query(
      `UPDATE configuracion SET ${updates.join(', ')} WHERE id = 1 RETURNING *`,
      values
    );
    res.json(rows[0]);
  } catch (err) {
    console.error('updateConfiguracion error:', err);
    res.status(500).json({ message: 'Error interno del servidor.' });
  }
};

// ── POST /configuracion/logo ──────────────────────────────────
export const uploadLogo = async (req, res) => {
  if (req.user.rol !== 'admin') {
    return res.status(403).json({ message: 'Solo administradores pueden modificar el logo.' });
  }
  if (!req.file) {
    return res.status(400).json({ message: 'No se recibió ningún archivo.' });
  }

  const logo_url = `/uploads/logo/${req.file.filename}`;

  try {
    await pool.query(
      'UPDATE configuracion SET logo_url = $1, updated_at = NOW() WHERE id = 1',
      [logo_url]
    );
    res.json({ logo_url });
  } catch (err) {
    console.error('uploadLogo error:', err);
    res.status(500).json({ message: 'Error al guardar el logo.' });
  }
};
