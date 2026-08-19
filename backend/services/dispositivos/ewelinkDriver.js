// ewelinkDriver — control real de los Sonoff a través de la nube eWeLink.
//
// ESQUELETO (Fase 1, paso 2): la interfaz existe pero la conexión real con la
// API de eWeLink se implementa en el paso 5, cuando se tengan las credenciales
// (EWELINK_APP_ID, EWELINK_APP_SECRET, EWELINK_EMAIL, EWELINK_PASSWORD,
// EWELINK_REGION). Hasta entonces, si se activa DISPOSITIVOS_DRIVER=ewelink,
// cada operación responde ok:false con motivo 'ewelink_no_configurado' para
// que el sonoff_estado quede en 'error' (visible) en vez de fallar en silencio.
//
// Plan de implementación (paso 5):
//   - Autenticación OAuth2 y refresco de token (cachear token en memoria).
//   - encender/apagar → POST de comando switch (usando device_id y, en
//     multi-relé, device_canal).
//   - estado → GET del estado del dispositivo, mapeado a 'on'/'off'.
//   - Manejo de errores de red / rate limit → ok:false, motivo:'error_red'.

const NO_CONFIGURADO = {
  ok: false,
  estado: null,
  motivo: 'ewelink_no_configurado',
};

function avisarPendiente(accion, maquina) {
  console.warn(
    `[dispositivos:ewelink] ${accion} solicitado para device_id=${maquina.device_id} ` +
    'pero el driver eWeLink aún no está implementado (paso 5). Revisa las credenciales.'
  );
}

export async function encender(maquina) {
  avisarPendiente('ENCENDER', maquina);
  return NO_CONFIGURADO;
}

export async function apagar(maquina) {
  avisarPendiente('APAGAR', maquina);
  return NO_CONFIGURADO;
}

export async function estado(maquina) {
  avisarPendiente('ESTADO', maquina);
  return NO_CONFIGURADO;
}
