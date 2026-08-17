import app from './app.js';
import { iniciarCierreDelDia } from './jobs/cierreDelDia.js';
import { iniciarLimpiezaNotificaciones } from './jobs/limpiezaNotificaciones.js';

const PORT = process.env.PORT || 4000;

app.listen(PORT, () => {
  console.log(`Server running on http://localhost:${PORT}`);
  // Barrido de cierre del día: libera máquinas que quedaron en uso.
  iniciarCierreDelDia();
  iniciarLimpiezaNotificaciones();
});
