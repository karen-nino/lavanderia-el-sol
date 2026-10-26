import app from './app.js';
import { iniciarCierreDelDia } from './jobs/cierreDelDia.js';
import { iniciarLimpiezaNotificaciones } from './jobs/limpiezaNotificaciones.js';
import { iniciarFinalizarAlTope } from './jobs/finalizarAlTope.js';
import { iniciarListenerSonoff } from './jobs/listenerSonoff.js';
import { iniciarReconciliadorSonoff } from './jobs/reconciliarSonoff.js';
import { iniciarGuardadoLlamadas } from './services/dispositivos/ewelinkLlamadas.js';
import { ENTORNO_DEMO, verificarEntornoDemo } from './utils/entorno.js';

// Antes de escuchar: si ENTORNO_DEMO está encendido sobre una base con
// operación real, el proceso no arranca.
await verificarEntornoDemo();

const PORT = process.env.PORT || 4000;

app.listen(PORT, () => {
  console.log(`Server running on http://localhost:${PORT}`);
  // Barrido de cierre del día: libera máquinas que quedaron en uso.
  iniciarCierreDelDia();
  iniciarLimpiezaNotificaciones();
  // Máquina con nota que llega a su tope: se finaliza sola.
  iniciarFinalizarAlTope();
  // Control Sonoff: listener por evento + barrido de respaldo. No en la demo:
  // no hay interruptores y la conexión permanente no dejaría dormir a Neon.
  if (!ENTORNO_DEMO) {
    iniciarListenerSonoff();
    iniciarReconciliadorSonoff();
    iniciarGuardadoLlamadas();
  }
});
