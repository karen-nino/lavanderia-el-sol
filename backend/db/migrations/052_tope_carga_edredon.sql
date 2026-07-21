-- ============================================================
-- Migración 052: tope de precio para cargas de Edredón
-- ============================================================
-- Se agrega un cuarto tope, dedicado a las cargas cuya prenda es Edredón.
-- El edredón se cobra distinto (tarifa propia de lavado y secado), así que
-- también merece su propio límite, independiente del tamaño chico/grande/
-- jumbo que la carga capture. Para las cargas de edredón, este tope manda
-- sobre el de su tamaño (ver validarTopesCargas).
--
-- NULL = sin tope (comportamiento actual). Arranca en NULL para no cambiar
-- nada hasta que el admin lo configure en Ajustes → Cargas y Precios.
ALTER TABLE ajustes
  ADD COLUMN IF NOT EXISTS tope_carga_edredon NUMERIC(10,2);
