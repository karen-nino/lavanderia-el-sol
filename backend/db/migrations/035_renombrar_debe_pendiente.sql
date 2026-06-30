-- ============================================================
-- Migración 035: renombrar valor 'DEBE' a 'PENDIENTE' en estado_pago_orden
-- ============================================================
-- El estado de pago que indicaba un saldo por cobrar se llamaba 'DEBE'.
-- Se renombra a 'PENDIENTE' para reflejar mejor el lenguaje usado en la UI
-- (badge "Pendiente", filtro "Pagos Pendientes").
--
-- RENAME VALUE conserva el OID interno del valor, por lo que las notas
-- existentes que tenían 'DEBE' pasan a leerse como 'PENDIENTE' sin
-- necesidad de migrar datos. La columna notas.estado_pago no cambia.

ALTER TYPE estado_pago_orden RENAME VALUE 'DEBE' TO 'PENDIENTE';
