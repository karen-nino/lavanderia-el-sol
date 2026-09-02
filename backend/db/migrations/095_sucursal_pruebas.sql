-- Migración 095: sucursal oculta de pruebas
-- Fecha: 2026-09-01
--
-- Los usuarios de prueba (es_prueba) no tenían sucursal, así que el backend
-- los mandaba a la de defecto (lopez_cotilla): sus notas, caja e inventario
-- se mezclaban con los datos reales del negocio.
--
-- Ahora existe una sucursal OCULTA ("pruebas") a la que solo entran ellos:
--   · `oculta` marca las sucursales que no se listan ni se pueden elegir.
--     Un usuario normal nunca la ve (selector, Ajustes, form de empleados);
--     un usuario de prueba solo ve esa.
--   · Los usuarios de prueba quedan atados a ella (sucursal = 'pruebas').
-- Como todo el sistema ya filtra por sucursal, con esto sus movimientos
-- quedan aislados sin tocar el resto de los módulos.

ALTER TABLE sucursales
  ADD COLUMN IF NOT EXISTS oculta BOOLEAN NOT NULL DEFAULT FALSE;

-- Sucursal de pruebas: activa (para poder operar) pero oculta. Va al final
-- del orden por si algún día se lista en alguna vista interna.
INSERT INTO sucursales (slug, nombre, activa, oculta, orden)
VALUES ('pruebas', 'Sucursal Pruebas', TRUE, TRUE, 999)
ON CONFLICT (slug) DO UPDATE SET oculta = TRUE, activa = TRUE;

-- Los usuarios de prueba dejan de ser "globales": viven en la sucursal oculta.
UPDATE usuarios SET sucursal = 'pruebas', updated_at = NOW() WHERE es_prueba = TRUE;
