-- ============================================================
-- Migración 002 — Ajustes post-levantamiento con cliente
-- Fecha: 11 marzo 2026
-- Motivo: Respuestas del levantamiento revelaron 5 ajustes
--         necesarios antes de continuar con Fase 4
-- ============================================================

-- ------------------------------------------------------------
-- 1. ENUM tipo_maquina
--    - Eliminar 'planchadora' (servicio no ofrecido)
--    - Agregar 'lavadora_mediana' y 'lavadora_jumbo' (precios distintos)
--    - Conservar 'secadora'
--    NOTA: PostgreSQL no permite DROP VALUE en ENUMs,
--          se recrea el tipo con un rename + replace.
-- ------------------------------------------------------------

-- Renombrar el enum viejo
ALTER TYPE tipo_maquina RENAME TO tipo_maquina_old;

-- Crear el nuevo enum correcto
CREATE TYPE tipo_maquina AS ENUM ('lavadora_mediana', 'lavadora_jumbo', 'secadora');

-- Migrar la columna (cualquier registro existente de 'lavadora' → 'lavadora_mediana')
ALTER TABLE maquinas
  ALTER COLUMN tipo TYPE tipo_maquina
  USING (
    CASE tipo::text
      WHEN 'lavadora'     THEN 'lavadora_mediana'::tipo_maquina
      WHEN 'secadora'     THEN 'secadora'::tipo_maquina
      WHEN 'planchadora'  THEN 'lavadora_mediana'::tipo_maquina  -- fallback seguro
      ELSE 'lavadora_mediana'::tipo_maquina
    END
  );

-- Eliminar el enum viejo
DROP TYPE tipo_maquina_old;


-- ------------------------------------------------------------
-- 2. ENUM modalidad_orden (nuevo)
--    POR_ENCARGO: cliente registrado, insumos incluidos
--    AUTOSERVICIO: anónimo, cliente paga por ciclo
-- ------------------------------------------------------------
CREATE TYPE modalidad_orden AS ENUM ('POR_ENCARGO', 'AUTOSERVICIO');

ALTER TABLE ordenes
  ADD COLUMN modalidad modalidad_orden NOT NULL DEFAULT 'POR_ENCARGO';


-- ------------------------------------------------------------
-- 3. ENUM estado_pago (nuevo)
--    CONTADO: pago al entregar la ropa
--    DEBE:    pago al recoger (precio diferente)
--    N/A:     para autoservicio (pago en efectivo inmediato)
-- ------------------------------------------------------------
CREATE TYPE estado_pago_orden AS ENUM ('CONTADO', 'DEBE', 'N/A');

ALTER TABLE ordenes
  ADD COLUMN estado_pago estado_pago_orden NOT NULL DEFAULT 'CONTADO';


-- ------------------------------------------------------------
-- 4. cliente_id en ordenes → nullable
--    Autoservicio no registra cliente (anónimo)
-- ------------------------------------------------------------
ALTER TABLE ordenes
  ALTER COLUMN cliente_id DROP NOT NULL;


-- ------------------------------------------------------------
-- 5. Campo sucursal en maquinas y ordenes
--    Simple VARCHAR por ahora — evita migración cuando
--    llegue la Sucursal Retiro en Etapa 2.
--    Valor por defecto: 'lopez_cotilla'
-- ------------------------------------------------------------
ALTER TABLE maquinas
  ADD COLUMN sucursal VARCHAR(50) NOT NULL DEFAULT 'lopez_cotilla';

ALTER TABLE ordenes
  ADD COLUMN sucursal VARCHAR(50) NOT NULL DEFAULT 'lopez_cotilla';


-- ------------------------------------------------------------
-- Índices nuevos útiles para los campos agregados
-- ------------------------------------------------------------
CREATE INDEX idx_ordenes_modalidad  ON ordenes(modalidad);
CREATE INDEX idx_ordenes_estado_pago ON ordenes(estado_pago);
CREATE INDEX idx_ordenes_sucursal    ON ordenes(sucursal);
CREATE INDEX idx_maquinas_sucursal   ON maquinas(sucursal);
CREATE INDEX idx_maquinas_tipo       ON maquinas(tipo);


-- ------------------------------------------------------------
-- Verificación rápida (resultados visibles en psql)
-- ------------------------------------------------------------
SELECT column_name, data_type, is_nullable, column_default
FROM information_schema.columns
WHERE table_name = 'ordenes'
  AND column_name IN ('modalidad', 'estado_pago', 'cliente_id', 'sucursal')
ORDER BY column_name;

SELECT column_name, data_type, is_nullable, column_default
FROM information_schema.columns
WHERE table_name = 'maquinas'
  AND column_name IN ('tipo', 'sucursal')
ORDER BY column_name;
