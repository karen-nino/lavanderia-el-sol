-- Migración 105: una nota de ticket por tipo de servicio
-- Fecha: 2026-09-05
--
-- La nota al pie del ticket (mig. 094) era una sola para todos, pero el texto
-- que le sirve al cliente de autoservicio ("30 minutos de secadora...") no es el
-- que le sirve al que deja su ropa a cargo del negocio. Se parte en dos:
--
--   ticket_nota_autoservicio → tickets de Autoservicio
--   ticket_nota_encargo      → tickets de Por Encargo y de Edredón
--
-- El edredón va con Por Encargo porque el negocio lo lava y lo entrega, no lo
-- lava el cliente.
--
-- La nota que ya estaba capturada se copia a las dos columnas para no perderla:
-- desde Ajustes se ajusta cada una por separado. NULL = sin nota, el ticket
-- termina como siempre.

ALTER TABLE ajustes ADD COLUMN IF NOT EXISTS ticket_nota_autoservicio TEXT;
ALTER TABLE ajustes ADD COLUMN IF NOT EXISTS ticket_nota_encargo      TEXT;

UPDATE ajustes
   SET ticket_nota_autoservicio = COALESCE(ticket_nota_autoservicio, ticket_nota),
       ticket_nota_encargo      = COALESCE(ticket_nota_encargo,      ticket_nota)
 WHERE ticket_nota IS NOT NULL;

ALTER TABLE ajustes DROP COLUMN IF EXISTS ticket_nota;
