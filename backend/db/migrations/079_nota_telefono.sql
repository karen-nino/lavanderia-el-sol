-- Migración 079: teléfono de contacto de la nota
-- Fecha: 2026-08-20
--
-- Autoservicio es anónimo (sin cliente registrado), pero se puede capturar un
-- teléfono en el ticket para enviarlo por WhatsApp. Aquí se guarda ese número a
-- nivel nota. NULL = sin teléfono capturado. En Por Encargo el teléfono vive en
-- el cliente; esta columna es para las notas sin cliente.

ALTER TABLE notas
  ADD COLUMN IF NOT EXISTS telefono TEXT;
