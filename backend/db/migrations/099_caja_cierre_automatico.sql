-- Migración 099: marcar las cajas que cerró el sistema, no una persona
-- Fecha: 2026-09-03
--
-- Hasta ahora, si un empleado abría caja y nadie la cerraba, la sesión seguía
-- viva al día siguiente: nadie podía abrir otra ("Ya hay una caja abierta"),
-- las ventas y movimientos del día nuevo se acumulaban en la sesión vieja, y al
-- cerrarla por fin el esperado sumaba dos días contra el efectivo de uno solo,
-- reportando un faltante que nadie se había llevado.
--
-- Ahora el barrido de medianoche la cierra. Pero un cierre automático NO es un
-- corte: nadie contó el cajón. Por eso `monto_contado` queda en NULL (la
-- columna ya lo permitía, y el historial ya muestra "—" y diferencia nula) y
-- esta bandera distingue "cerrada sin conteo por el sistema" de un corte real
-- hecho por una persona. Sin ella, un corte automático se vería en el historial
-- como uno normal al que alguien se le olvidó anotar el efectivo.

ALTER TABLE cajas
  ADD COLUMN IF NOT EXISTS cierre_automatico BOOLEAN NOT NULL DEFAULT FALSE;
