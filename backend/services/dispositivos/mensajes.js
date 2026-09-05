// Traducción de los motivos técnicos del driver de dispositivos a algo que
// entienda quien está parado frente a la máquina.
//
// Los drivers devuelven { ok, estado, motivo } y el motivo es un código
// ('sin_cuenta_conectada', 'error_red', 'ewelink_40001'...). Ese código no le
// dice nada a nadie: lo que hace falta es saber QUÉ pasó y QUÉ hacer, y sobre
// todo si es algo que se arregla en la app (conectar la cuenta), en la
// lavandería (el Sonoff desconectado) o en el servidor (las credenciales).
//
// Cada detalle empieza en minúscula porque se pega después de un encabezado:
//   "No se pudo encender la máquina: la cuenta de eWeLink no está conectada..."

const DETALLE_MOTIVO = {
  sin_enlazar:
    'esta máquina no tiene un Sonoff asignado, así que la app no puede prenderla ni apagarla. ' +
    'Captura su Device ID al editar la máquina.',
  sin_cuenta_conectada:
    'la cuenta de eWeLink no está conectada, así que ningún Sonoff recibe órdenes. ' +
    'Conéctala desde el aviso que aparece arriba, en esta misma pantalla.',
  sesion_expirada:
    'el permiso de eWeLink venció y hay que darlo otra vez. ' +
    'Conecta la cuenta desde el aviso que aparece arriba, en esta misma pantalla.',
  ewelink_no_configurado:
    'faltan las credenciales de eWeLink en el servidor. ' +
    'Eso lo configura quien administra el sistema; no se arregla desde la app.',
  driver_deshabilitado:
    'el control de los Sonoff está apagado en el servidor, así que la app no puede ' +
    'encender ni apagar máquinas. Lo activa quien administra el sistema.',
  error_red:
    'no se pudo hablar con eWeLink. Puede ser el internet de la lavandería o que su ' +
    'servicio esté caído; espera un momento y vuelve a intentar.',
  estado_desconocido:
    'el Sonoff contestó algo que no se entendió. Suele pasar cuando está fuera de línea ' +
    'o cuando el canal configurado no es el suyo; revísalo en la app de eWeLink.',
};

// Los códigos de la nube de eWeLink llegan como 'ewelink_<código>'. Los de
// autenticación (402 y la familia 401xx, ver ewelinkDriver) son los únicos que
// sabemos leer con certeza; el resto se reporta con el código a la vista, sin
// inventarle un significado.
const esCodigoDeAuth = (codigo) => codigo === '402' || codigo.startsWith('401');

export function explicarMotivo(motivo) {
  if (!motivo) {
    return 'no se pudo hablar con el Sonoff y no llegó ningún detalle. Vuelve a intentar en un momento.';
  }
  if (DETALLE_MOTIVO[motivo]) return DETALLE_MOTIVO[motivo];

  if (motivo.startsWith('ewelink_')) {
    const codigo = motivo.slice('ewelink_'.length);
    if (esCodigoDeAuth(codigo)) {
      return 'eWeLink no aceptó el permiso de la app. Conecta la cuenta otra vez desde el aviso ' +
             'que aparece arriba, en esta misma pantalla.';
    }
    return `eWeLink rechazó la orden (código ${codigo}). Casi siempre es que el Sonoff está ` +
           'desconectado de la corriente o fuera de línea: revísalo en la app de eWeLink y vuelve a probar.';
  }

  return `no se pudo hablar con el Sonoff (${motivo}). Vuelve a intentar en un momento.`;
}

// Mensaje completo para la pantalla: qué se intentaba hacer + por qué falló.
export const explicarFalla = (motivo, encabezado) => `${encabezado}: ${explicarMotivo(motivo)}`;

// Versión corta para guardar en maquinas.sonoff_detalle y pintarla en la
// tarjeta: la primera frase del detalle, con mayúscula inicial.
export function resumirMotivo(motivo) {
  const detalle = explicarMotivo(motivo);
  const primeraFrase = detalle.split('. ')[0];
  return primeraFrase.charAt(0).toUpperCase() + primeraFrase.slice(1) + '.';
}
