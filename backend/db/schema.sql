-- ============================================================
-- Lavanderia El Sol - Schema inicial
-- ============================================================

-- Tipos ENUM
CREATE TYPE rol_usuario AS ENUM ('admin', 'operador');
CREATE TYPE estado_orden AS ENUM ('RECIBIDO', 'EN_PROCESO', 'LISTO', 'ENTREGADO');
CREATE TYPE tipo_maquina AS ENUM ('lavadora', 'secadora', 'planchadora');
CREATE TYPE estado_maquina AS ENUM ('disponible', 'en_uso', 'mantenimiento');
CREATE TYPE tipo_movimiento AS ENUM ('entrada', 'salida');

-- ============================================================
-- USUARIOS (personal del negocio)
-- ============================================================
CREATE TABLE usuarios (
  id          SERIAL PRIMARY KEY,
  nombre      VARCHAR(100) NOT NULL,
  email       VARCHAR(150) NOT NULL UNIQUE,
  password    TEXT NOT NULL,
  rol         rol_usuario NOT NULL DEFAULT 'operador',
  activo      BOOLEAN NOT NULL DEFAULT TRUE,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- ============================================================
-- CLIENTES
-- ============================================================
CREATE TABLE clientes (
  id          SERIAL PRIMARY KEY,
  nombre      VARCHAR(100) NOT NULL,
  telefono    VARCHAR(20),
  email       VARCHAR(150),
  direccion   TEXT,
  notas       TEXT,
  activo      BOOLEAN NOT NULL DEFAULT TRUE,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- ============================================================
-- MÁQUINAS
-- ============================================================
CREATE TABLE maquinas (
  id               SERIAL PRIMARY KEY,
  nombre           VARCHAR(100) NOT NULL,
  tipo             tipo_maquina NOT NULL,
  estado           estado_maquina NOT NULL DEFAULT 'disponible',
  modelo           VARCHAR(100),
  numero_serie     VARCHAR(100),
  fecha_adquisicion DATE,
  notas            TEXT,
  created_at       TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at       TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- ============================================================
-- ÓRDENES
-- ============================================================
CREATE TABLE ordenes (
  id              SERIAL PRIMARY KEY,
  cliente_id      INTEGER NOT NULL REFERENCES clientes(id) ON DELETE RESTRICT,
  usuario_id      INTEGER NOT NULL REFERENCES usuarios(id) ON DELETE RESTRICT,
  maquina_id      INTEGER REFERENCES maquinas(id) ON DELETE SET NULL,
  estado          estado_orden NOT NULL DEFAULT 'RECIBIDO',
  descripcion     TEXT,
  peso_kg         NUMERIC(6, 2),
  precio_total    NUMERIC(10, 2),
  fecha_entrega   TIMESTAMPTZ,
  notas           TEXT,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- ============================================================
-- INSUMOS (detergente, suavizante, bolsas, etc.)
-- ============================================================
CREATE TABLE insumos (
  id              SERIAL PRIMARY KEY,
  nombre          VARCHAR(100) NOT NULL,
  descripcion     TEXT,
  unidad          VARCHAR(30) NOT NULL,       -- litros, kg, piezas, etc.
  stock_actual    NUMERIC(10, 2) NOT NULL DEFAULT 0,
  stock_minimo    NUMERIC(10, 2) NOT NULL DEFAULT 0,
  precio_unitario NUMERIC(10, 2),
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT stock_no_negativo CHECK (stock_actual >= 0)
);

-- ============================================================
-- MOVIMIENTOS DE INSUMOS (entradas de compra / salidas de uso)
-- ============================================================
CREATE TABLE movimientos_insumos (
  id          SERIAL PRIMARY KEY,
  insumo_id   INTEGER NOT NULL REFERENCES insumos(id) ON DELETE RESTRICT,
  usuario_id  INTEGER NOT NULL REFERENCES usuarios(id) ON DELETE RESTRICT,
  orden_id    INTEGER REFERENCES ordenes(id) ON DELETE SET NULL,
  tipo        tipo_movimiento NOT NULL,
  cantidad    NUMERIC(10, 2) NOT NULL,
  notas       TEXT,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT cantidad_positiva CHECK (cantidad > 0)
);

-- ============================================================
-- FUNCIÓN para actualizar updated_at automáticamente
-- ============================================================
CREATE OR REPLACE FUNCTION actualizar_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Triggers updated_at
CREATE TRIGGER trg_usuarios_updated_at
  BEFORE UPDATE ON usuarios
  FOR EACH ROW EXECUTE FUNCTION actualizar_updated_at();

CREATE TRIGGER trg_clientes_updated_at
  BEFORE UPDATE ON clientes
  FOR EACH ROW EXECUTE FUNCTION actualizar_updated_at();

CREATE TRIGGER trg_maquinas_updated_at
  BEFORE UPDATE ON maquinas
  FOR EACH ROW EXECUTE FUNCTION actualizar_updated_at();

CREATE TRIGGER trg_ordenes_updated_at
  BEFORE UPDATE ON ordenes
  FOR EACH ROW EXECUTE FUNCTION actualizar_updated_at();

CREATE TRIGGER trg_insumos_updated_at
  BEFORE UPDATE ON insumos
  FOR EACH ROW EXECUTE FUNCTION actualizar_updated_at();

-- ============================================================
-- ÍNDICES
-- ============================================================
CREATE INDEX idx_ordenes_cliente    ON ordenes(cliente_id);
CREATE INDEX idx_ordenes_estado     ON ordenes(estado);
CREATE INDEX idx_ordenes_created_at ON ordenes(created_at DESC);
CREATE INDEX idx_movimientos_insumo ON movimientos_insumos(insumo_id);
CREATE INDEX idx_movimientos_orden  ON movimientos_insumos(orden_id);

-- ============================================================
-- DATOS SEMILLA (usuario admin inicial)
-- ============================================================
-- Contraseña: cambiar antes de producción
-- Hash bcrypt de 'admin1234' (cost 12):
INSERT INTO usuarios (nombre, email, password, rol)
VALUES (
  'Administrador',
  'admin@lavanderia-el-sol.com',
  '$2b$12$placeholder_reemplazar_con_hash_real',
  'admin'
);
