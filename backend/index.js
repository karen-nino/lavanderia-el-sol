import app from './app.js';
import { iniciarCierreDelDia } from './jobs/cierreDelDia.js';
import { iniciarLimpiezaNotificaciones } from './jobs/limpiezaNotificaciones.js';
import { iniciarFinalizarAlTope } from './jobs/finalizarAlTope.js';
import { iniciarListenerSonoff } from './jobs/listenerSonoff.js';
import { iniciarReconciliadorSonoff } from './jobs/reconciliarSonoff.js';
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
  // Máquina con nota que llega a su tope: se finaliza sola (2026-10-11).
  iniciarFinalizarAlTope();
  // Control Sonoff: listener por evento (enganche central) + reconciliador
  // periódico de respaldo. En la demo no se arrancan: no hay interruptores que
  // controlar, y el listener mantiene abierta una conexión permanente contra la
  // base, lo que impediría que Neon se duerma y gastaría horas de cómputo.
  if (!ENTORNO_DEMO) {
    iniciarListenerSonoff();
    iniciarReconciliadorSonoff();
  }
});
