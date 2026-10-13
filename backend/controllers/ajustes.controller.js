import pool from '../db/pool.js';
import multer from 'multer';
import path from 'path';
import fs from 'fs';
import { esAdmin } from '../middleware/roles.js';
import { ENTORNO_DEMO } from '../utils/entorno.js';
import { cronometroActivo } from '../db/sqlMaquina.js';

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
    // En la demo no hay logo: su disco se recicla y sería una imagen rota.
    const ajustes = ENTORNO_DEMO ? { ...rows[0], logo_url: null } : rows[0];
    // Modo de las máquinas: Ajustes esconde lo que solo sirve con temporizador.
    res.json({ ...ajustes, cronometro: cronometroActivo() });
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
    tope_carga_mediano,
    tope_carga_grande,
    tope_carga_jumbo,
    tope_carga_edredon,
    tiempo_carga_mediana,
    tiempo_carga_jumbo,
    tiempo_carga_secadora,
    tiempo_secadora_jumbo,
    precarga_medidas_chico,
    precarga_medidas_mediano,
    precarga_medidas_grande,
    precarga_bolsas_chico,
    precarga_bolsas_mediano,
    precarga_bolsas_grande,
    nombre_negocio,
    rfc,
    ticket_nota_autoservicio,
    ticket_nota_encargo,
    ticket_nota_productos,
    whatsapp_mensaje_encargo,
    whatsapp_mensaje_reaviso,
    direccion,
    telefono,
    alerta_ciclo_detenido,
    // Interruptores de alertas.
    alerta_stock,
    alerta_encendido_manual,
    alerta_tope_maquina,
    aviso_sonoro_ciclo,
  } = req.body;

  // Un texto daría 500 y un negativo descuadraría las notas.
  const esNumero = (v) => (typeof v === 'number' || (typeof v === 'string' && v.trim() !== '')) && Number.isFinite(Number(v));

  // Cada ajuste como se ve en pantalla, para los mensajes.
  const ETIQUETA = {
    precio_carga_mediana:    'El precio de la carga mediana',
    precio_carga_jumbo:      'El precio de la carga jumbo',
    precio_carga_secadora:   'El precio del secado',
    precio_secadora_jumbo:   'El precio del secado jumbo',
    precio_secadora_edredon: 'El precio del secado de edredón',
    precio_edredon_jumbo:    'El precio del edredón en jumbo',
    tope_carga_chico:        'El precio del servicio Chico',
    tope_carga_mediano:      'El precio del servicio Mediano',
    tope_carga_grande:       'El precio del servicio Grande',
    tope_carga_jumbo:        'El tope de la carga jumbo',
    tope_carga_edredon:      'El precio del servicio Edredón',
    tiempo_carga_mediana:    'El tiempo de la carga mediana',
    precarga_medidas_chico:   'Las medidas del servicio Chico',
    precarga_medidas_mediano: 'Las medidas del servicio Mediano',
    precarga_medidas_grande:  'Las medidas del servicio Grande',
    precarga_bolsas_chico:    'Las bolsas del servicio Chico',
    precarga_bolsas_mediano:  'Las bolsas del servicio Mediano',
    precarga_bolsas_grande:   'Las bolsas del servicio Grande',
    tiempo_carga_jumbo:      'El tiempo de la carga jumbo',
    tiempo_carga_secadora:   'El tiempo del secado',
    tiempo_secadora_jumbo:   'El tiempo del secado jumbo',
  };
  const nombreDe = (campo) => ETIQUETA[campo] ?? `El ajuste "${campo}"`;

  const precios = { precio_carga_mediana, precio_carga_jumbo, precio_carga_secadora,
                    precio_secadora_jumbo, precio_secadora_edredon, precio_edredon_jumbo };
  for (const [campo, valor] of Object.entries(precios)) {
    if (valor !== undefined && (!esNumero(valor) || Number(valor) < 0)) {
      return res.status(400).json({ message: `${nombreDe(campo)} debe ser un número mayor o igual a 0.` });
    }
  }
  // Precio de los servicios Por Encargo (`tope_carga_*`): obligatorio, porque
  // vacío dejaría el servicio en $0.
  const preciosServicio = { tope_carga_chico, tope_carga_mediano, tope_carga_grande, tope_carga_edredon };
  for (const [campo, valor] of Object.entries(preciosServicio)) {
    if (valor === undefined) continue; // no se manda = no se toca
    if (valor === null || valor === '') {
      return res.status(400).json({ message: `${nombreDe(campo)} es obligatorio: sin precio no se puede vender el servicio.` });
    }
    if (!esNumero(valor) || Number(valor) < 0) {
      return res.status(400).json({ message: `${nombreDe(campo)} debe ser un número mayor o igual a 0.` });
    }
  }
  // Jumbo de ropa no se vende; si llega, es opcional.
  if (tope_carga_jumbo !== undefined && tope_carga_jumbo !== null && tope_carga_jumbo !== '' &&
      (!esNumero(tope_carga_jumbo) || Number(tope_carga_jumbo) < 0)) {
    return res.status(400).json({ message: `${nombreDe('tope_carga_jumbo')} debe ser un número mayor o igual a 0. Déjalo vacío para quitar el tope.` });
  }
  const topeONull = (v) => (v === null || v === '' ? null : v);

  // Tiempos de respaldo por tamaño (el edredón usa el de su tamaño).
  const tiempos = { tiempo_carga_mediana, tiempo_carga_jumbo,
                    tiempo_carga_secadora, tiempo_secadora_jumbo };
  for (const [campo, valor] of Object.entries(tiempos)) {
    if (valor !== undefined && (!esNumero(valor) || !Number.isInteger(Number(valor)) || Number(valor) < 1)) {
      return res.status(400).json({ message: `${nombreDe(campo)} debe ser un número entero de 1 minuto o más.` });
    }
  }
  // Lo que trae puesto cada servicio: medidas de cada granel y bolsas (0 = nada).
  const precargas = { precarga_medidas_chico, precarga_medidas_mediano, precarga_medidas_grande, precarga_bolsas_chico, precarga_bolsas_mediano, precarga_bolsas_grande };
  for (const [campo, valor] of Object.entries(precargas)) {
    if (valor !== undefined && (!esNumero(valor) || !Number.isInteger(Number(valor)) || Number(valor) < 0)) {
      return res.status(400).json({ message: `${nombreDe(campo)} debe ser un número entero de 0 o más.` });
    }
  }

  // R.F.C.: texto libre en MAYÚSCULAS; vacío lo borra.
  const rfcLibre = (v) => {
    const limpio = String(v ?? '').trim().toUpperCase();
    return limpio === '' ? null : limpio;
  };

  // Texto libre tal cual (renglones y mayúsculas); vacío lo borra.
  const textoONull = (v) => {
    const limpio = String(v ?? '').trim();
    return limpio === '' ? null : limpio;
  };

  // En la demo los textos que identifican al negocio no se cambian (los ven
  // todos los visitantes). Se ignoran en silencio para no tumbar el resto del
  // guardado.
  const IDENTIDAD_DEL_NEGOCIO = [
    'nombre_negocio', 'rfc', 'ticket_nota_autoservicio', 'ticket_nota_encargo',
    'ticket_nota_productos', 'whatsapp_mensaje_encargo', 'whatsapp_mensaje_reaviso',
    'direccion', 'telefono',
  ];
  const editable = (campo, valor) =>
    valor !== undefined && !(ENTORNO_DEMO && IDENTIDAD_DEL_NEGOCIO.includes(campo));

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
  if (tope_carga_mediano    !== undefined) { updates.push(`tope_carga_mediano = $${i++}`);    values.push(topeONull(tope_carga_mediano)); }
  if (tope_carga_grande     !== undefined) { updates.push(`tope_carga_grande = $${i++}`);     values.push(topeONull(tope_carga_grande)); }
  if (tope_carga_jumbo      !== undefined) { updates.push(`tope_carga_jumbo = $${i++}`);      values.push(topeONull(tope_carga_jumbo)); }
  if (tope_carga_edredon    !== undefined) { updates.push(`tope_carga_edredon = $${i++}`);    values.push(topeONull(tope_carga_edredon)); }
  if (tiempo_carga_mediana  !== undefined) { updates.push(`tiempo_carga_mediana = $${i++}`);  values.push(tiempo_carga_mediana); }
  if (tiempo_carga_jumbo    !== undefined) { updates.push(`tiempo_carga_jumbo = $${i++}`);    values.push(tiempo_carga_jumbo); }
  if (tiempo_carga_secadora !== undefined) { updates.push(`tiempo_carga_secadora = $${i++}`); values.push(tiempo_carga_secadora); }
  if (tiempo_secadora_jumbo   !== undefined) { updates.push(`tiempo_secadora_jumbo = $${i++}`);   values.push(tiempo_secadora_jumbo); }
  for (const [campo, valor] of Object.entries(precargas)) {
    if (valor !== undefined) { updates.push(`${campo} = $${i++}`); values.push(Number(valor)); }
  }
  if (editable('nombre_negocio', nombre_negocio)) { updates.push(`nombre_negocio = $${i++}`); values.push(nombre_negocio); }
  if (editable('rfc', rfc)) { updates.push(`rfc = $${i++}`); values.push(rfcLibre(rfc)); }
  if (editable('ticket_nota_autoservicio', ticket_nota_autoservicio)) { updates.push(`ticket_nota_autoservicio = $${i++}`); values.push(textoONull(ticket_nota_autoservicio)); }
  if (editable('ticket_nota_encargo', ticket_nota_encargo)) { updates.push(`ticket_nota_encargo = $${i++}`); values.push(textoONull(ticket_nota_encargo)); }
  if (editable('ticket_nota_productos', ticket_nota_productos)) { updates.push(`ticket_nota_productos = $${i++}`); values.push(textoONull(ticket_nota_productos)); }
  // Los mensajes de WhatsApp también son identidad del negocio.
  if (editable('whatsapp_mensaje_encargo', whatsapp_mensaje_encargo)) { updates.push(`whatsapp_mensaje_encargo = $${i++}`); values.push(textoONull(whatsapp_mensaje_encargo)); }
  if (editable('whatsapp_mensaje_reaviso', whatsapp_mensaje_reaviso)) { updates.push(`whatsapp_mensaje_reaviso = $${i++}`); values.push(textoONull(whatsapp_mensaje_reaviso)); }
  if (editable('direccion', direccion)) { updates.push(`direccion = $${i++}`); values.push(direccion); }
  if (editable('telefono', telefono)) { updates.push(`telefono = $${i++}`); values.push(telefono); }
  if (alerta_ciclo_detenido !== undefined) { updates.push(`alerta_ciclo_detenido = $${i++}`); values.push(Boolean(alerta_ciclo_detenido)); }
  // Interruptores de alertas.
  for (const [col, v] of [
    ['alerta_stock', alerta_stock],
    ['alerta_encendido_manual', alerta_encendido_manual],
    ['alerta_tope_maquina', alerta_tope_maquina],
    ['aviso_sonoro_ciclo', aviso_sonoro_ciclo],
  ]) {
    if (v !== undefined) { updates.push(`${col} = $${i++}`); values.push(Boolean(v)); }
  }

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
/**
 * En la demo no se sube logo (no sobrevive y llenaría el disco). Va como
 * middleware antes de multer, para no escribir el archivo.
 */
export const bloquearLogoEnDemo = (req, res, next) => {
  if (ENTORNO_DEMO) {
    return res.status(403).json({ message: 'En la demostración no se puede cambiar el logo.' });
  }
  next();
};

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
