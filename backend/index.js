import app from './app.js';
import { iniciarCierreDelDia } from './jobs/cierreDelDia.js';
import { iniciarLimpiezaNotificaciones } from './jobs/limpiezaNotificaciones.js';
import { iniciarListenerSonoff } from './jobs/listenerSonoff.js';
import { iniciarReconciliadorSonoff } from './jobs/reconciliarSonoff.js';
import { verificarEntornoDemo } from './utils/entorno.js';

// Antes de escuchar: si ENTORNO_DEMO está encendido sobre una base con
// operación real, el proceso no arranca.
await verificarEntornoDemo();

const PORT = process.env.PORT || 4000;

app.listen(PORT, () => {
  console.log(`Server running on http://localhost:${PORT}`);
  // Barrido de cierre del día: libera máquinas que quedaron en uso.
  iniciarCierreDelDia();
  iniciarLimpiezaNotificaciones();
  // Control Sonoff: listener por evento (enganche central) + reconciliador
  // periódico de respaldo.
  iniciarListenerSonoff();
  iniciarReconciliadorSonoff();
});
