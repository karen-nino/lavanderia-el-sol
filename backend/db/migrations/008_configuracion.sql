-- Migración 008: tabla configuracion + eliminar stock_minimo de productos

-- 1. Eliminar columna stock_minimo de productos
ALTER TABLE productos DROP COLUMN IF EXISTS stock_minimo;

-- 2. Crear tabla configuracion (una sola fila, siempre id = 1)
CREATE TABLE IF NOT EXISTS configuracion (
  id                    INTEGER PRIMARY KEY DEFAULT 1,
  precio_autoservicio   NUMERIC(10,2) NOT NULL DEFAULT 70.00,
  nombre_negocio        VARCHAR(100) NOT NULL DEFAULT 'Lavandería El Sol',
  direccion             VARCHAR(255),
  telefono              VARCHAR(20),
  logo_url              VARCHAR(500),
  stock_minimo_global   INTEGER NOT NULL DEFAULT 5,
  updated_at            TIMESTAMP DEFAULT NOW(),
  CONSTRAINT solo_una_fila CHECK (id = 1)
);

-- 3. Insertar fila inicial si no existe
INSERT INTO configuracion (id) VALUES (1) ON CONFLICT DO NOTHING;
