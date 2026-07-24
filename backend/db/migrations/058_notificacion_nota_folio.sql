-- Guarda el folio de la nota en las notificaciones de nota (cancelada /
-- eliminada) para poder mostrarlo como dato aparte en el detalle de la alerta,
-- sin tener que extraerlo del texto del mensaje. Nulo para el resto de tipos.
ALTER TABLE notificaciones
  ADD COLUMN IF NOT EXISTS nota_folio VARCHAR(30);
