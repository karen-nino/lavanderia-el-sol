-- Migración 147: secadoras de MONEDAS — el Sonoff mete monedas, no da corriente
-- Fecha: 2026-10-06
--
-- Las dos secadoras Speed Queen de Retiro (S2, modelo Sec50, y S4, modelo
-- Sec49) son de monedas y siempre están alimentadas. Su Sonoff va en modo
-- pulso (0.5 s): cada "on" equivale a meter UNA moneda, igual que el
-- monedero. La S4 da 10 min por moneda y la S2 da 30 (medido en sitio el
-- 2026-10-06). Tratarlas como relé de corriente —lo que hace la app con las
-- lavadoras— no sirve: "encender" mete una sola moneda y "apagar" no les
-- quita nada.
--
-- El modelo dice cuántos minutos da cada moneda (`minutos_por_moneda`). Si lo
-- tiene, al INICIAR la máquina la app manda tantos pulsos como monedas hagan
-- falta para el programa elegido (Sec49: 10/20/30 → 1/2/3 monedas) o, si el
-- modelo no pregunta, para su tope (Sec50: 30 → 1 moneda). Nunca le manda
-- "apagar" ni la adopta como encendida a mano. Vacío = máquina normal.
--
-- `maquinas.monedas_para_uso` guarda el `en_uso_desde` del arranque al que ya
-- se le metieron las monedas: la sincronización corre varias veces por
-- arranque (el evento, la llamada explícita, el barrido) y cada pulso de más
-- es tiempo regalado. El UPDATE que lo reclama solo lo gana una.
--
-- El trigger de la mig. 075 pasa a avisar también cuando cambia
-- `en_uso_desde`: "Iniciar" sobre una máquina que esperaba arranque
-- (mig. 110) no cambia el estado —ya era 'en_uso'— y sin esto nadie se
-- enteraba de que había que meter las monedas.

BEGIN;

ALTER TABLE modelos_maquina
  ADD COLUMN IF NOT EXISTS minutos_por_moneda INTEGER CHECK (minutos_por_moneda > 0);

ALTER TABLE maquinas
  ADD COLUMN IF NOT EXISTS monedas_para_uso TIMESTAMP;

-- Lo medido en sitio. Si el modelo no existe con ese nombre no pasa nada: se
-- captura desde Ajustes.
UPDATE modelos_maquina mo
   SET minutos_por_moneda = v.minutos
  FROM marcas_maquina mm,
       (VALUES ('sec49', 10), ('sec50', 30)) AS v(modelo, minutos)
 WHERE mo.marca_id = mm.id
   AND LOWER(TRIM(mm.nombre)) = 'speed queen'
   AND LOWER(TRIM(mo.nombre)) = v.modelo
   AND mo.minutos_por_moneda IS NULL;

CREATE OR REPLACE FUNCTION notificar_sync_maquina()
RETURNS TRIGGER AS $$
BEGIN
  IF (TG_OP = 'INSERT')
     OR NEW.estado       IS DISTINCT FROM OLD.estado
     OR NEW.device_id    IS DISTINCT FROM OLD.device_id
     OR NEW.device_canal IS DISTINCT FROM OLD.device_canal
     OR NEW.en_uso_desde IS DISTINCT FROM OLD.en_uso_desde
  THEN
    PERFORM pg_notify('maquina_sync', NEW.id::text);
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_notificar_sync_maquina ON maquinas;

CREATE TRIGGER trg_notificar_sync_maquina
  AFTER INSERT OR UPDATE OF estado, device_id, device_canal, en_uso_desde ON maquinas
  FOR EACH ROW EXECUTE FUNCTION notificar_sync_maquina();

COMMIT;
