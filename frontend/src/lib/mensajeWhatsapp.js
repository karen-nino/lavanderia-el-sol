/**
 * Mensaje de WhatsApp al cliente de Por Encargo cuando su ropa está lista. La
 * plantilla (Ajustes → WhatsApp) lleva comodines entre asteriscos que se
 * sustituyen al enviar; otra palabra entre asteriscos queda tal cual (en
 * negritas). El comodín no distingue mayúsculas ni acentos.
 */

import { formatHora12 } from './fecha';

/** Comodines disponibles, con la descripción que se muestra en Ajustes. */
export const COMODINES_WHATSAPP = [
  { clave: 'Nombre', descripcion: 'El nombre de pila del cliente, sin apellidos' },
  { clave: 'Tiempo', descripcion: 'La hora a la que se levantó la nota' },
  { clave: 'Clave',  descripcion: 'El número de la nota, sin la fecha, con números anchos y en negritas (１７９６ de 1796-260926)' },
  { clave: 'ClaveEmoji', descripcion: 'La misma clave con emojis de números (1️⃣7️⃣9️⃣6️⃣)' },
  { clave: 'Horario', descripcion: 'La hora a la que cierra HOY la sucursal, según su horario (7:00 pm)' },
];

// Hora de cierre de hoy de la sucursal ("7:00 pm"), con el día del negocio. Si
// ese día no abre o no hay horario, en blanco.
const TZ_NEGOCIO = 'America/Mexico_City';
const DIA_SEMANA = { Mon: 0, Tue: 1, Wed: 2, Thu: 3, Fri: 4, Sat: 5, Sun: 6 };
const diaDeHoy = (ahora) => DIA_SEMANA[
  new Intl.DateTimeFormat('en-US', { timeZone: TZ_NEGOCIO, weekday: 'short' }).format(ahora)
];
const hora12 = (hhmm) => {
  const [h, m] = String(hhmm).split(':').map(Number);
  if (!Number.isFinite(h) || !Number.isFinite(m)) return '';
  return `${h % 12 || 12}:${String(m).padStart(2, '0')} ${h < 12 ? 'am' : 'pm'}`;
};
export function cierreDeHoy(horarioSemana, ahora = new Date()) {
  if (!Array.isArray(horarioSemana)) return '';
  const hoy = horarioSemana.find(d => Number(d?.dia) === diaDeHoy(ahora));
  return hoy?.abierto && hoy.cierra ? hora12(hoy.cierra) : '';
}

// Solo la primera palabra del nombre ("Hola Ana").
const primerNombre = (nombre) => String(nombre ?? '').trim().split(/\s+/)[0] ?? '';

// Clave para recoger la ropa: el número del folio sin la fecha ("1796-260926"
// → "1796"); sin folio, el id.
const claveDeNota = (nota) => {
  const folio = String(nota?.folio ?? '').trim();
  if (folio) return folio.split('-')[0];
  return nota?.id != null ? String(nota.id) : '';
};

// Dígitos de ancho completo (U+FF10–FF19) para la clave: resaltan sin depender
// del formato de WhatsApp.
const anchos = (texto) => String(texto).replace(/[0-9]/g, (d) => String.fromCharCode(0xFF10 + Number(d)));

// Emoji de tecla: dígito + U+FE0F + U+20E3 (1️⃣).
const emojis = (texto) => String(texto).replace(/[0-9]/g, (d) => `${d}\uFE0F\u20E3`);

// Cómo se resuelve cada comodín. Uno nuevo va aquí y en COMODINES_WHATSAPP.
const VALORES = {
  nombre:  (nota) => primerNombre(nota?.cliente_nombre),
  tiempo:  (nota) => formatHora12(nota?.created_at),
  clave:   (nota) => anchos(claveDeNota(nota)),
  claveemoji: (nota) => emojis(claveDeNota(nota)),
  horario: (nota, ahora) => cierreDeHoy(nota?.sucursal_horario_semana, ahora),
};

// Quita acentos y baja a minúsculas para comparar el nombre del comodín.
const normalizar = (s) =>
  s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().trim();

// Comodines que siempre van en negritas.
const EN_NEGRITAS = new Set(['clave']);

/**
 * Sustituye los comodines con los datos de la nota. Uno que no existe se deja
 * con sus asteriscos (un error de captura tiene que verse); uno sin dato va en
 * blanco.
 *
 * @param ahora decide el día de *Horario* (lo pasan las pruebas).
 */
export function armarMensajeWhatsapp(plantilla, nota, ahora = new Date()) {
  if (!plantilla) return '';
  const texto = String(plantilla);
  return texto.replace(/\*([^*\n]+)\*/g, (completo, dentro, pos) => {
    const clave = normalizar(dentro);
    const valor = VALORES[clave];
    if (!valor) return completo;
    const v = valor(nota, ahora);
    // Si ya lo rodea otro par (**Clave**), no se duplican los asteriscos.
    const yaRodeado = texto[pos - 1] === '*' && texto[pos + completo.length] === '*';
    return EN_NEGRITAS.has(clave) && v && !yaRodeado ? `*${v}*` : v;
  });
}

/** ¿La plantilla tiene algo? En blanco, WhatsApp abriría el chat vacío. */
export const hayMensajeWhatsapp = (plantilla) => Boolean(String(plantilla ?? '').trim());

/** Número para wa.me: solo dígitos y con lada de México si son 10 (como el ticket). */
export function telefonoWhatsapp(telefono) {
  const digits = String(telefono ?? '').replace(/\D/g, '');
  if (!digits) return '';
  return digits.startsWith('52') ? digits : `52${digits}`;
}
