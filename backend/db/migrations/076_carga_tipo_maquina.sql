-- Migración 076: tipo de máquina previsto por carga (Por Encargo)
-- Fecha: 2026-08-19
--
-- En Por Encargo, al crear la nota ya NO se elige (ni se reserva) una máquina
-- específica: se elige solo el TIPO de máquina a usar (Mediana / Jumbo /
-- Edredón), con su precio. La máquina física real se asigna después en Salidas.
--
-- Estas columnas guardan ese tipo previsto por carga. El precio (precio_lavadora
-- / precio_secadora) se deriva del tipo al crear. lavadora_id/secadora_id quedan
-- en NULL hasta que se asigne la máquina en Salidas.
--
-- NULL = autoservicio (que sigue eligiendo máquina específica al crear) o carga
-- vieja. Valores: 'mediana' | 'jumbo' | 'edredon'.

ALTER TABLE nota_cargas
  ADD COLUMN IF NOT EXISTS lavadora_tipo TEXT
    CHECK (lavadora_tipo IS NULL OR lavadora_tipo IN ('mediana', 'jumbo', 'edredon')),
  ADD COLUMN IF NOT EXISTS secadora_tipo TEXT
    CHECK (secadora_tipo IS NULL OR secadora_tipo IN ('mediana', 'jumbo', 'edredon'));
