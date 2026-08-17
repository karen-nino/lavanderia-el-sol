-- Migración 073: quitar de notas las columnas denormalizadas/legadas del
-- modelo previo a "por cargas".
-- ============================================================
-- Ya no se leen ni se escriben: la máquina de una nota vive en sus filas de
-- nota_cargas (lavadora_id / secadora_id) y el total se calcula sumando las
-- cargas. Estas columnas eran:
--   • maquina_id / secadora_id      → puntero "máquina principal" (1ª carga)
--   • precio_base / cantidad_cargas / precio_base_secadora /
--     cantidad_cargas_secadora      → fórmula de precio del flujo legado
-- El sistema aún no está en uso, así que no hay datos que preservar. Al soltar
-- la columna se sueltan también sus índices/constraints dependientes.

ALTER TABLE notas
  DROP COLUMN IF EXISTS maquina_id,
  DROP COLUMN IF EXISTS secadora_id,
  DROP COLUMN IF EXISTS precio_base,
  DROP COLUMN IF EXISTS cantidad_cargas,
  DROP COLUMN IF EXISTS cantidad_cargas_secadora,
  DROP COLUMN IF EXISTS precio_base_secadora;
