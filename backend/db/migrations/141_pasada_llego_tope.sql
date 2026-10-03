-- Migración 141: la pasada recuerda si la máquina llegó al tope del cronómetro
-- Fecha: 2026-10-03
--
-- Con cronómetro, al cumplirse el tope el corte le quita la luz a la máquina y
-- la tarjeta se queda parada en el tope, pero la carga sigue abierta hasta que
-- alguien le da Finalizar. La 140 sellaba como fin la hora de ese clic, así que
-- Ventas contaba minutos en que la máquina ya estaba apagada.
--
-- Ahora el reloj se para en el tope también aquí: si al finalizar ya se había
-- cumplido, el fin que se guarda es el del tope y esta marca queda en TRUE.
-- Ventas la usa para decir "Tope de tiempo" en lugar de solo los minutos.

ALTER TABLE nota_carga_maquinas
  ADD COLUMN IF NOT EXISTS llego_tope BOOLEAN NOT NULL DEFAULT FALSE;
