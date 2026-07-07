-- ============================================================
-- Migración 038: soporte multi-sucursal (Fase 1)
-- ============================================================
-- El negocio opera dos sucursales: "Sucursal López Cotilla" y
-- "Sucursal Retiro". Cada una lleva su propia información
-- (máquinas, notas/ventas, caja, inventario, clientes y
-- empleados). Los precios/ajustes siguen compartidos.
--
-- Las tablas `maquinas` y `notas` ya tenían la columna `sucursal`
-- (migración 002, VARCHAR con default 'lopez_cotilla'). Aquí:
--   1. Se crea el catálogo `sucursales` y se siembran las dos.
--   2. Se agrega `sucursal` a las tablas que faltaban.
--   3. Se ata cada columna `sucursal` al catálogo por FK.
--   4. La caja pasa de "una abierta en todo el negocio" a
--      "una abierta por sucursal".
--
-- Backfill: al ser NOT NULL DEFAULT 'lopez_cotilla', todas las
-- filas existentes quedan asignadas a López Cotilla; Retiro
-- arranca vacía.
-- ============================================================

-- ── 1. Catálogo de sucursales ───────────────────────────────
CREATE TABLE sucursales (
  slug        VARCHAR(50) PRIMARY KEY,
  nombre      VARCHAR(100) NOT NULL,
  activa      BOOLEAN NOT NULL DEFAULT TRUE,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

INSERT INTO sucursales (slug, nombre) VALUES
  ('lopez_cotilla', 'Sucursal López Cotilla'),
  ('retiro',        'Sucursal Retiro');

-- ── 2. Columna `sucursal` en las tablas que faltaban ────────
--    (maquinas y notas ya la tienen desde la migración 002)
ALTER TABLE clientes
  ADD COLUMN sucursal VARCHAR(50) NOT NULL DEFAULT 'lopez_cotilla';

ALTER TABLE insumos
  ADD COLUMN sucursal VARCHAR(50) NOT NULL DEFAULT 'lopez_cotilla';

ALTER TABLE productos
  ADD COLUMN sucursal VARCHAR(50) NOT NULL DEFAULT 'lopez_cotilla';

ALTER TABLE usuarios
  ADD COLUMN sucursal VARCHAR(50) NOT NULL DEFAULT 'lopez_cotilla';

ALTER TABLE cajas
  ADD COLUMN sucursal VARCHAR(50) NOT NULL DEFAULT 'lopez_cotilla';

-- ── 3. Integridad referencial contra el catálogo ────────────
--    Todas las columnas sucursal (nuevas y las de la mig. 002)
--    quedan atadas a sucursales(slug). El backfill garantiza
--    que todos los valores actuales ('lopez_cotilla') existen.
ALTER TABLE maquinas ADD CONSTRAINT fk_maquinas_sucursal FOREIGN KEY (sucursal) REFERENCES sucursales(slug);
ALTER TABLE notas    ADD CONSTRAINT fk_notas_sucursal    FOREIGN KEY (sucursal) REFERENCES sucursales(slug);
ALTER TABLE clientes ADD CONSTRAINT fk_clientes_sucursal FOREIGN KEY (sucursal) REFERENCES sucursales(slug);
ALTER TABLE insumos  ADD CONSTRAINT fk_insumos_sucursal  FOREIGN KEY (sucursal) REFERENCES sucursales(slug);
ALTER TABLE productos ADD CONSTRAINT fk_productos_sucursal FOREIGN KEY (sucursal) REFERENCES sucursales(slug);
ALTER TABLE usuarios ADD CONSTRAINT fk_usuarios_sucursal FOREIGN KEY (sucursal) REFERENCES sucursales(slug);
ALTER TABLE cajas    ADD CONSTRAINT fk_cajas_sucursal    FOREIGN KEY (sucursal) REFERENCES sucursales(slug);

-- ── 4. Índices por sucursal (los de maquinas/notas ya existen)
CREATE INDEX idx_clientes_sucursal  ON clientes(sucursal);
CREATE INDEX idx_insumos_sucursal   ON insumos(sucursal);
CREATE INDEX idx_productos_sucursal ON productos(sucursal);
CREATE INDEX idx_usuarios_sucursal  ON usuarios(sucursal);
CREATE INDEX idx_cajas_sucursal     ON cajas(sucursal);

-- ── 5. Caja por sucursal ────────────────────────────────────
--    Antes: una sola caja abierta en todo el negocio.
--    Ahora: una caja abierta por sucursal a la vez.
DROP INDEX IF EXISTS idx_una_caja_abierta;
CREATE UNIQUE INDEX idx_una_caja_abierta_por_sucursal
  ON cajas (sucursal) WHERE estado = 'abierta';
