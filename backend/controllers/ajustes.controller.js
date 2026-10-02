import pool from '../db/pool.js';
import multer from 'multer';
import path from 'path';
import fs from 'fs';
import { esAdmin } from '../middleware/roles.js';
import { ENTORNO_DEMO } from '../utils/entorno.js';

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
    // En la DEMO el logo no se enseña nunca, ni aunque la columna traiga uno de
    // antes: su archivo vive en un disco que se recicla cada vez que la máquina
    // duerme, así que lo único que se vería es una imagen rota.
    res.json(ENTORNO_DEMO ? { ...rows[0], logo_url: null } : rows[0]);
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
  // Precio de los servicios Por Encargo (columnas `tope_carga_*`, mig. 050 y
  // 052). Nacieron como topes contra los que se comparaba lo que llevaba la
  // carga, pero desde el rediseño del alta de Por Encargo ese número ES el
  // precio del servicio: por eso son OBLIGATORIOS. Vaciarlos dejaría el
  // servicio en $0 y la nota se cobraría sola mal, así que se rechaza.
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
  // Jumbo ya no se vende: su columna solo sobrevive para las notas viejas que
  // eligieron ese tamaño. Si alguien todavía la manda, se valida como antes
  // (opcional) para no romper un cliente viejo.
  if (tope_carga_jumbo !== undefined && tope_carga_jumbo !== null && tope_carga_jumbo !== '' &&
      (!esNumero(tope_carga_jumbo) || Number(tope_carga_jumbo) < 0)) {
    return res.status(400).json({ message: `${nombreDe('tope_carga_jumbo')} debe ser un número mayor o igual a 0. Déjalo vacío para quitar el tope.` });
  }
  const topeONull = (v) => (v === null || v === '' ? null : v);

  // El edredón ya no tiene tiempo propio (mig. 107): usa el de su tamaño. Su
  // precio sí se conserva, que es lo que distingue el servicio.
  const tiempos = { tiempo_carga_mediana, tiempo_carga_jumbo,
                    tiempo_carga_secadora, tiempo_secadora_jumbo };
  for (const [campo, valor] of Object.entries(tiempos)) {
    if (valor !== undefined && (!esNumero(valor) || !Number.isInteger(Number(valor)) || Number(valor) < 1)) {
      return res.status(400).json({ message: `${nombreDe(campo)} debe ser un número entero de 1 minuto o más.` });
    }
  }
  // Lo que cada servicio trae puesto (mig. 132): medidas de cada granel ligado
  // y bolsas. Enteros; 0 = no se precarga nada de eso.
  const precargas = { precarga_medidas_chico, precarga_medidas_mediano, precarga_medidas_grande, precarga_bolsas_chico, precarga_bolsas_mediano, precarga_bolsas_grande };
  for (const [campo, valor] of Object.entries(precargas)) {
    if (valor !== undefined && (!esNumero(valor) || !Number.isInteger(Number(valor)) || Number(valor) < 0)) {
      return res.status(400).json({ message: `${nombreDe(campo)} debe ser un número entero de 0 o más.` });
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

  // Lo que la DEMO no deja tocar: los textos con los que el negocio se
  // identifica. Son de la configuración global, los ven todos los visitantes a
  // la vez y se quedan puestos hasta el reset de las 03:00, así que cualquiera
  // podría dejar ahí lo que quisiera encima de una demo que sirve de carta de
  // presentación. El nombre y las notas al pie, además, salen impresos en
  // el ticket que se manda por WhatsApp.
  //
  // Se ignoran en silencio en vez de responder 403: la pantalla manda estos
  // campos dentro del mismo guardado que las tarifas y los tiempos, y
  // rechazarlos tumbaría también lo demás, que en la demo sí se puede cambiar.
  const IDENTIDAD_DEL_NEGOCIO = [
    'nombre_negocio', 'rfc', 'ticket_nota_autoservicio', 'ticket_nota_encargo',
    'ticket_nota_productos', 'whatsapp_mensaje_encargo', 'direccion', 'telefono',
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
  // El mensaje de WhatsApp de Por Encargo (mig. 124) va con la identidad del
  // negocio: es texto libre que sale del negocio hacia el cliente, igual que
  // las notas al pie del ticket, así que en la demo tampoco se toca.
  if (editable('whatsapp_mensaje_encargo', whatsapp_mensaje_encargo)) { updates.push(`whatsapp_mensaje_encargo = $${i++}`); values.push(textoONull(whatsapp_mensaje_encargo)); }
  if (editable('direccion', direccion)) { updates.push(`direccion = $${i++}`); values.push(direccion); }
  if (editable('telefono', telefono)) { updates.push(`telefono = $${i++}`); values.push(telefono); }
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
// La DEMO es pública y anónima: el logo se queda fuera. El archivo no sobrevive
// al reciclado de la máquina (no hay volumen montado), así que solo dejaría una
// imagen rota hasta el reset, y las subidas se acumulan en el disco sin que
// nadie las borre. La pantalla tampoco ofrece el botón.
//
// Se monta como middleware, delante de multer (ver ajustes.routes.js): si se
// comprobara aquí dentro, el archivo ya estaría escrito en disco.
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
