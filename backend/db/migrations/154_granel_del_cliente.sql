-- Migración 154: el cliente trae su propio jabón o suavizante
-- Fecha: 2026-10-10
--
-- En Salidas el empleado elige, servicio por servicio, qué granel usa de cada
-- tipo (migs. 133-134). Si el cliente dejó su propio producto, no se usa nada
-- del inventario: el renglón queda marcado como "del cliente".
--
-- Se guarda en `nota_carga_pendientes` porque es justo el renglón por elegir
-- de ese servicio y tipo (con sus medidas), solo que ya resuelto:
--   · `del_cliente = TRUE` → ya no está por elegir: no bloquea iniciar la
--     lavadora, no aparta ni descuenta existencias y no cambia el precio del
--     servicio.

BEGIN;

ALTER TABLE nota_carga_pendientes
  ADD COLUMN IF NOT EXISTS del_cliente BOOLEAN NOT NULL DEFAULT FALSE;

COMMIT;
