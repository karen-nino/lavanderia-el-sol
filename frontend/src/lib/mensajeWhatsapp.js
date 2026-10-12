// El mensaje de WhatsApp que el mostrador le manda al cliente de Por Encargo
// cuando su ropa ya se procesó (mig. 124).
//
// La plantilla se escribe una vez en Ajustes → WhatsApp y lleva COMODINES
// entre asteriscos que se sustituyen al enviar. Los asteriscos se eligieron
// porque es lo que ya se teclea sin pensar; que en WhatsApp signifiquen
// negritas no estorba, porque el comodín se sustituye CON sus asteriscos y
// desaparecen con él. Una palabra entre asteriscos que no sea un comodín se
// queda tal cual y WhatsApp la pinta en negritas, que es lo esperable.
//
// El nombre del comodín no distingue mayúsculas ni acentos (*Nombre*, *nombre*
// y *NOMBRE* son el mismo): lo escribe una persona a mano.

import { formatHora12 } from './fecha';

// Qué se puede meter en el mensaje. La descripción es la que se enseña en
// Ajustes, así que vive junto al comodín y no suelta en la pantalla.
export const COMODINES_WHATSAPP = [
  { clave: 'Nombre', descripcion: 'El nombre de pila del cliente, sin apellidos' },
  { clave: 'Tiempo', descripcion: 'La hora a la que se levantó la nota' },
  { clave: 'Clave',  descripcion: 'El número de la nota, sin la fecha y con números anchos (１７９６ de 1796-260926)' },
  { clave: 'ClaveEmoji', descripcion: 'La misma clave con emojis de números (1️⃣7️⃣9️⃣6️⃣)' },
  { clave: 'Horario', descripcion: 'La hora a la que cierra HOY la sucursal, según su horario (7:00 pm)' },
];

// Hora de cierre de HOY en la sucursal de la nota (mig. 160), "7:00 pm". El
// día es el del negocio (America/Mexico_City), no el del equipo. Si ese día no
// abre o no hay horario capturado, se va en blanco como cualquier dato que
// falta.
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

// Solo el nombre de pila: en un WhatsApp se saluda "Hola Ana", no "Hola Ana
// López" (2026-09-26). Se toma la primera palabra, que es lo único que se
// puede distinguir con certeza — en "María José García" no hay forma de saber
// que el nombre son dos palabras, así que sale "María", que sigue saludando
// bien.
const primerNombre = (nombre) => String(nombre ?? '').trim().split(/\s+/)[0] ?? '';

// La clave con la que el cliente recoge su ropa: el número de la nota sin la
// fecha. El folio es `<id>-<ddmmaa>` ("1796-260926"), y al cliente solo le
// sirve la primera mitad para decir cuál es su bolsa. Sin folio se cae al id,
// que es de donde sale ese número.
const claveDeNota = (nota) => {
  const folio = String(nota?.folio ?? '').trim();
  if (folio) return folio.split('-')[0];
  return nota?.id != null ? String(nota.id) : '';
};

// Cómo se resuelve cada comodín contra una nota. Añadir uno nuevo es añadirlo
// aquí y en COMODINES_WHATSAPP; el resto de la pantalla se entera sola.
// Números de ancho completo (１５４５) para la clave (2026-10-11, a pedido):
// resaltan en el chat sin depender del formato de WhatsApp. Son caracteres
// Unicode (U+FF10–FF19), así que se ven igual en cualquier teléfono.
const anchos = (texto) => String(texto).replace(/[0-9]/g, (d) => String.fromCharCode(0xFF10 + Number(d)));

// Emoji de tecla (2026-10-11): el dígito + selector de emoji (U+FE0F) + tecla
// (U+20E3). Lo dibuja como 1️⃣ cualquier teléfono con emojis.
const emojis = (texto) => String(texto).replace(/[0-9]/g, (d) => `${d}\uFE0F\u20E3`);

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

// Sustituye los comodines de la plantilla con los datos de la nota. Un comodín
// que no existe se deja intacto —con sus asteriscos— en vez de borrarse: si
// alguien escribió *Direccion* es un error de captura que tiene que verse, no
// un hueco silencioso en el mensaje que le llega al cliente.
//
// Un comodín conocido pero sin dato (una nota sin cliente) se va en blanco: el
// mensaje no puede decir "*Nombre*" a un cliente de verdad.
// `ahora` decide el día de *Horario*; solo las pruebas lo pasan.
export function armarMensajeWhatsapp(plantilla, nota, ahora = new Date()) {
  if (!plantilla) return '';
  return String(plantilla).replace(/\*([^*\n]+)\*/g, (completo, dentro) => {
    const valor = VALORES[normalizar(dentro)];
    return valor ? valor(nota, ahora) : completo;
  });
}

// ¿La plantilla tiene algo que mandar? Un mensaje en blanco abriría WhatsApp
// con el chat vacío, que es peor que decir que falta configurarlo.
export const hayMensajeWhatsapp = (plantilla) => Boolean(String(plantilla ?? '').trim());

// El número tal como lo quiere wa.me: solo dígitos y con la lada de México si
// viene un celular de 10 dígitos. Mismo criterio que el envío del ticket.
export function telefonoWhatsapp(telefono) {
  const digits = String(telefono ?? '').replace(/\D/g, '');
  if (!digits) return '';
  return digits.startsWith('52') ? digits : `52${digits}`;
}
