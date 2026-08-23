-- Migración 082: agrega "Bidón" al catálogo editable de envases
-- ============================================================
-- El envase a granel del que se rellenan las botellas. El cliente puede seguir
-- agregando/quitando envases desde Ajustes → Inventario.

INSERT INTO envases_producto (nombre) VALUES ('Bidón')
ON CONFLICT (nombre) DO NOTHING;
