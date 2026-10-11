-- Migración 158: mensaje de WhatsApp para VOLVER a avisar al cliente
-- Fecha: 2026-10-11
--
-- El botón "Procesado" de una nota Por Encargo manda `whatsapp_mensaje_encargo`
-- (mig. 124). Ya procesada, el mismo botón se vuelve "Avisar" y sirve para
-- recordarle al cliente que su ropa lo espera: ese recordatorio lleva su propio
-- texto. Vacío = se manda el mensaje de Por Encargo, como hasta ahora. Admite
-- los mismos comodines (*Nombre*, *Tiempo*, *Clave*).

BEGIN;

ALTER TABLE ajustes ADD COLUMN IF NOT EXISTS whatsapp_mensaje_reaviso TEXT;

COMMIT;
