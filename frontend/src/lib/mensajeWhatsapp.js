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
  { clave: 'Nombre', descripcion: 'El nombre del cliente de la nota' },
  { clave: 'Tiempo', descripcion: 'La hora a la que se levantó la nota' },
];

// Cómo se resuelve cada comodín contra una nota. Añadir uno nuevo es añadirlo
// aquí y en COMODINES_WHATSAPP; el resto de la pantalla se entera sola.
const VALORES = {
  nombre: (nota) => (nota?.cliente_nombre ?? '').trim(),
  tiempo: (nota) => formatHora12(nota?.created_at),
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
export function armarMensajeWhatsapp(plantilla, nota) {
  if (!plantilla) return '';
  return String(plantilla).replace(/\*([^*\n]+)\*/g, (completo, dentro) => {
    const valor = VALORES[normalizar(dentro)];
    return valor ? valor(nota) : completo;
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
