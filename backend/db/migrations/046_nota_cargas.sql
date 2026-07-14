-- ============================================================
-- Migración 046: tabla nota_cargas — cargas con máquinas por carga
-- ============================================================
-- Autoservicio pasa de "una lavadora + una secadora por nota" a
-- "N cargas, cada una con su propia lavadora y/o secadora" (ambas
-- opcionales por carga; una misma máquina puede repetirse en varias
-- cargas). El precio de la nota es la suma por carga de la tarifa de
-- sus máquinas, más productos y ajuste.
--
-- nota_cargas es la fuente de verdad de las cargas de autoservicio.
-- notas.maquina_id / notas.secadora_id quedan como denormalización
-- (primera lavadora / primera secadora) para las vistas de lista, y
-- siguen siendo la fuente de verdad para Por Encargo (una máquina).

CREATE TABLE IF NOT EXISTS nota_cargas (
  id              SERIAL PRIMARY KEY,
  nota_id         INTEGER NOT NULL REFERENCES notas(id) ON DELETE CASCADE,
  orden           INTEGER NOT NULL,
  lavadora_id     INTEGER REFERENCES maquinas(id) ON DELETE SET NULL,
  secadora_id     INTEGER REFERENCES maquinas(id) ON DELETE SET NULL,
  precio_lavadora NUMERIC(10,2) NOT NULL DEFAULT 0,
  precio_secadora NUMERIC(10,2) NOT NULL DEFAULT 0,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (nota_id, orden)
);

CREATE INDEX IF NOT EXISTS idx_nota_cargas_lavadora ON nota_cargas(lavadora_id);
CREATE INDEX IF NOT EXISTS idx_nota_cargas_secadora ON nota_cargas(secadora_id);

-- Semilla para notas de autoservicio existentes: una fila por carga,
-- repitiendo la máquina asignada (modelo anterior: la misma máquina
-- para todas las cargas). Si maquina_id era una secadora (el selector
-- viejo las permitía), va en el slot de secadora. La secadora del
-- modelo 044/045 se reparte en las primeras cantidad_cargas_secadora
-- cargas, conservando el total. Incluye las notas legadas
-- modalidad=EDREDON sin cliente (autoservicio viejo).
INSERT INTO nota_cargas (nota_id, orden, lavadora_id, secadora_id, precio_lavadora, precio_secadora)
SELECT n.id,
       gs.i,
       CASE WHEN m.tipo = 'secadora' THEN NULL ELSE n.maquina_id END,
       CASE WHEN m.tipo = 'secadora' THEN n.maquina_id
            WHEN n.secadora_id IS NOT NULL AND gs.i <= COALESCE(n.cantidad_cargas_secadora, 1)
              THEN n.secadora_id
            ELSE NULL END,
       CASE WHEN m.tipo = 'secadora' THEN 0 ELSE COALESCE(n.precio_base, 0) END,
       CASE WHEN m.tipo = 'secadora' THEN COALESCE(n.precio_base, 0)
            WHEN n.secadora_id IS NOT NULL AND gs.i <= COALESCE(n.cantidad_cargas_secadora, 1)
              THEN COALESCE(n.precio_base_secadora, 0)
            ELSE 0 END
FROM notas n
LEFT JOIN maquinas m ON m.id = n.maquina_id
CROSS JOIN LATERAL generate_series(1, GREATEST(COALESCE(n.cantidad_cargas, 1), 1)) AS gs(i)
WHERE (n.modalidad = 'AUTOSERVICIO' OR (n.modalidad = 'EDREDON' AND n.cliente_id IS NULL))
  AND NOT EXISTS (SELECT 1 FROM nota_cargas nc WHERE nc.nota_id = n.id);
