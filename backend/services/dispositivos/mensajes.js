// Traduce los motivos del driver ('sin_cuenta_conectada', 'error_red',
// 'ewelink_40001'…) a qué pasó y qué hacer: en la app, en la lavandería o en el
// servidor. Cada detalle va en minúscula: se pega después de un encabezado.

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

const SIN_DETALLE =
  'no se pudo hablar con el Sonoff y no llegó ningún detalle. Vuelve a intentar en un momento.';

/** 402 y 401xx son de autenticación; los demás códigos se reportan tal cual. */
const esCodigoDeAuth = (codigo) => codigo === '402' || codigo.startsWith('401');

export function explicarMotivo(motivo) {
  if (!motivo) return SIN_DETALLE;
  if (DETALLE_MOTIVO[motivo]) return DETALLE_MOTIVO[motivo];

  if (motivo.startsWith('ewelink_')) {
    const codigo = motivo.slice('ewelink_'.length);
    // Sin código numérico ('ewelink_undefined') no se inventa un diagnóstico.
    if (!/^\d+$/.test(codigo)) return SIN_DETALLE;
    if (esCodigoDeAuth(codigo)) {
      return 'eWeLink no aceptó el permiso de la app. Conecta la cuenta otra vez desde el aviso ' +
             'que aparece arriba, en esta misma pantalla.';
    }
    return `eWeLink rechazó la orden (código ${codigo}). Casi siempre es que el Sonoff está ` +
           'desconectado de la corriente o fuera de línea: revísalo en la app de eWeLink y vuelve a probar.';
  }

  return `no se pudo hablar con el Sonoff (${motivo}). Vuelve a intentar en un momento.`;
}

/** "<qué se intentaba>: <por qué falló>". */
export const explicarFalla = (motivo, encabezado) => `${encabezado}: ${explicarMotivo(motivo)}`;

/** Mayúscula inicial, salvo que la palabra ya traiga las suyas ("eWeLink"). */
const capitalizar = (texto) => {
  const primeraPalabra = texto.split(' ')[0];
  if (/[A-ZÁÉÍÓÚÜÑ]/.test(primeraPalabra)) return texto;
  return texto.charAt(0).toUpperCase() + texto.slice(1);
};

/** Texto completo para `sonoff_detalle` (sin recortar: la segunda frase dice qué hacer). */
export function resumirMotivo(motivo) {
  return capitalizar(explicarMotivo(motivo));
}
