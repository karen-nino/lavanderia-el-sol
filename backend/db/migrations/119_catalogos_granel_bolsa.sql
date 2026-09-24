-- Migración 119: catálogos de Granel y Bolsas en Ajustes → Inventario
-- Fecha: 2026-09-23
--
-- Inventario ya tenía dos catálogos editables (marcas y envases de producto).
-- Faltaban las dos listas que seguían escritas en el código o a mano:
--
--   · GRANEL  → el nombre del líquido que se vende a granel ("Jabón",
--               "Suavizante"). Hoy es texto libre en cada producto, así que
--               nadie lo escribe dos veces igual y el inventario se llena de
--               "jabon" y "Jabón líquido" que cuentan por separado.
--   · BOLSAS  → el tamaño de la bolsa, que estaba clavado en el código
--               (chica/grande/jumbo) en tres sitios: el CHECK de la tabla, la
--               validación del backend y el desplegable del formulario.
--
-- Los dos tienen la forma del resto de catálogos (nombre + activo + orden), así
-- que los atiende la misma fábrica CRUD.
--
-- Ojo con las bolsas: se cobran en la nota según el TAMAÑO DE LA CARGA, y esa
-- comparación es la que las hace aparecer solas. Un tamaño que no exista como
-- tamaño de carga se podrá dar de alta, pero no se va a cobrar solo.

BEGIN;

CREATE TABLE IF NOT EXISTS graneles_producto (
  id          SERIAL PRIMARY KEY,
  nombre      VARCHAR(60) NOT NULL UNIQUE,
  activo      BOOLEAN NOT NULL DEFAULT TRUE,
  orden       INTEGER,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS tamanos_bolsa (
  id          SERIAL PRIMARY KEY,
  nombre      VARCHAR(60) NOT NULL UNIQUE,
  activo      BOOLEAN NOT NULL DEFAULT TRUE,
  orden       INTEGER,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- El catálogo de granel nace con lo que ya hay dado de alta: así la lista sale
-- llena y ningún producto existente queda fuera de ella.
INSERT INTO graneles_producto (nombre)
SELECT DISTINCT TRIM(nombre)
  FROM productos
 WHERE tipo_liquido = 'granel' AND COALESCE(TRIM(nombre), '') <> ''
ON CONFLICT (nombre) DO NOTHING;

-- Los tres tamaños de siempre, que son los mismos que los de la carga.
INSERT INTO tamanos_bolsa (nombre) VALUES ('Chica'), ('Grande'), ('Jumbo')
ON CONFLICT (nombre) DO NOTHING;

-- Mismo criterio que la mig. 069: el orden inicial es el de creación.
UPDATE graneles_producto SET orden = id WHERE orden IS NULL;
UPDATE tamanos_bolsa      SET orden = id WHERE orden IS NULL;

-- El tamaño de la bolsa deja de estar clavado en la tabla: ahora lo dice el
-- catálogo. Los productos siguen guardando el NOMBRE en minúsculas ('chica'),
-- que es como estaban y como los compara la nota.
ALTER TABLE productos DROP CONSTRAINT IF EXISTS productos_tamano_bolsa_chk;

COMMIT;
