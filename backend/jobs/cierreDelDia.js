import { randomUUID } from 'crypto';
import pool from '../db/pool.js';
import { sellarPasadasVivas } from '../db/pasadas.js';
import {
  ventasDeSesion, totalesMovimientos, ingresosDeSesion, porEncargoPendienteDeSesion,
} from '../controllers/caja.controller.js';

/** Hora local del cierre del día: CIERRE_HORA (0-23) y TZ_NEGOCIO; por defecto, medianoche en México. */
const TZ = process.env.TZ_NEGOCIO || 'America/Mexico_City';
const CIERRE_HORA = (() => {
  const h = Number(process.env.CIERRE_HORA);
  return Number.isInteger(h) && h >= 0 && h <= 23 ? h : 0;
})();
const INTERVALO_MS = 5 * 60 * 1000; // revisar cada 5 minutos

const fmtHora  = new Intl.DateTimeFormat('en-US', { timeZone: TZ, hour: '2-digit', hourCycle: 'h23' });
const fmtFecha = new Intl.DateTimeFormat('en-CA', { timeZone: TZ, year: 'numeric', month: '2-digit', day: '2-digit' });

/**
 * Barrido de fin de día (idempotente; devuelve los conteos):
 * 1. Libera las máquinas en uso y saca sus notas del proceso (LISTA; Por Encargo
 *    vuelve a EN ESPERA, porque "Procesado" lo marca una persona).
 * 2. Suelta las máquinas asignadas que nunca arrancaron (la nota sigue viva).
 */
export async function liberarMaquinasCierreDelDia() {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    // Antes de soltarlas, cada máquina en marcha cierra su vuelta.
    const { rows: enMarcha } = await client.query(
      `SELECT id FROM maquinas WHERE estado = 'en_uso' AND en_uso_desde IS NOT NULL`
    );
    await sellarPasadasVivas(client, enMarcha.map(r => r.id));
    // Todas las notas en proceso; Por Encargo vuelve a EN ESPERA.
    const notas = await client.query(
      `UPDATE notas
          SET estado = (CASE WHEN tipo_servicio = 'POR_ENCARGO' THEN 'EN_ESPERA' ELSE 'LISTA' END)::estado_orden
         WHERE estado IN ('LAVANDO', 'SECANDO')
       RETURNING id`
    );
    const notaIds = notas.rows.map(r => r.id);

    // Las cargas sueltan su máquina viva y la conservan como "usada".
    if (notaIds.length > 0) {
      await client.query(
        `UPDATE nota_cargas
            SET lavadora_usada_id = COALESCE(lavadora_usada_id, lavadora_id),
                secadora_usada_id = COALESCE(secadora_usada_id, secadora_id),
                lavadora_id = NULL,
                secadora_id = NULL
          WHERE nota_id = ANY($1)`,
        [notaIds]
      );
    }

    // Se cancelan también encendidos manuales y esperas de arranque: nada
    // queda prendido. Solo se libera lo que estaba 'en_uso' (mantenimiento se queda).
    const maquinas = await client.query(
      `UPDATE maquinas
          SET estado       = CASE WHEN estado = 'en_uso' THEN 'disponible'::estado_maquina ELSE estado END,
              en_uso_desde = CASE WHEN estado = 'en_uso' THEN NULL ELSE en_uso_desde END,
              encendida_manual_at = NULL,
              encendida_sin_iniciar_at = NULL,
              encendida_para_nota_id   = NULL
        WHERE estado = 'en_uso' OR encendida_manual_at IS NOT NULL
           OR encendida_sin_iniciar_at IS NOT NULL`
    );

    // Máquinas asignadas que nunca arrancaron: se sueltan (no cuentan como
    // usadas) y la nota sigue viva para asignarle otra después.
    const { rows: [{ sueltas }] } = await client.query(
      `WITH liberadas AS (
         UPDATE nota_cargas nc
            SET lavadora_id = NULL, secadora_id = NULL,
                lavadora_usada_id = CASE WHEN nc.lavadora_usada_id = nc.lavadora_id
                                         THEN NULL ELSE nc.lavadora_usada_id END,
                secadora_usada_id = CASE WHEN nc.secadora_usada_id = nc.secadora_id
                                         THEN NULL ELSE nc.secadora_usada_id END
          FROM notas n
          WHERE n.id = nc.nota_id
            AND n.estado = 'EN_ESPERA'
            AND (nc.lavadora_id IS NOT NULL OR nc.secadora_id IS NOT NULL)
          RETURNING nc.id
       )
       SELECT COUNT(*)::int AS sueltas FROM liberadas`
    );

    await client.query('COMMIT');
    return {
      maquinasLiberadas: maquinas.rowCount,
      notasListas: notas.rowCount,
      cargasSueltas: sueltas,
    };
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
}

/**
 * Invalida las sesiones de los empleados (operador) con un session_id nuevo:
 * mañana inician sesión y registran su entrada. No registra salida (queda "—").
 * Los admins conservan su sesión.
 */
export async function cerrarSesionesEmpleados() {
  const { rowCount } = await pool.query(
    `UPDATE usuarios SET session_id = $1
       WHERE activo = TRUE AND rol = 'operador' AND session_id IS NOT NULL`,
    [randomUUID()]
  );
  return rowCount;
}

/**
 * Cierra las cajas abiertas de todas las sucursales (todas o ninguna). No es un
 * corte: sin conteo (`monto_contado` y `usuario_cierre_id` NULL,
 * `cierre_automatico`). Las cifras sí se congelan, con el mismo cálculo que el
 * cierre manual; su esperado es la caja inicial del día siguiente.
 *
 * @returns las cajas cerradas. Lanza si algo falla.
 */
export async function cerrarCajasAbiertas() {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const { rows: abiertas } = await client.query(
      `SELECT id, sucursal, abierta_at FROM cajas WHERE estado = 'abierta' FOR UPDATE`
    );
    for (const c of abiertas) {
      const ventas = await ventasDeSesion(client, c.id);
      const { entradas, salidas } = await totalesMovimientos(client, c.id);
      const ingresos = await ingresosDeSesion(client, c.id);
      const speDebe  = await porEncargoPendienteDeSesion(client, c);
      await client.query(
        `UPDATE cajas
            SET estado            = 'cerrada',
                cerrada_at        = NOW(),
                cierre_automatico = TRUE,
                notas_cierre      = COALESCE(
                  notas_cierre,
                  'Cerrada automáticamente en el cierre del día. Nadie cerró la caja, así que no hubo conteo de efectivo.'
                ),
                ventas_total         = $2,
                ventas_efectivo      = $3,
                ventas_transferencia = $4,
                ventas_tarjeta       = $5,
                total_entradas       = $6,
                total_salidas        = $7,
                ingresos_detalle     = $8,
                spe_debe             = $9
          WHERE id = $1`,
        [c.id, ventas.total, ventas.efectivo, ventas.transferencia, ventas.tarjeta, entradas, salidas,
         JSON.stringify(ingresos), speDebe]
      );
    }
    await client.query('COMMIT');
    return abiertas;
  } catch (err) {
    await client.query('ROLLBACK').catch(() => {});
    throw err;
  } finally {
    client.release();
  }
}

/** Revisa cada pocos minutos y corre el cierre una vez al día, al llegar la hora. */
export function iniciarCierreDelDia() {
  let ultimaFecha = null;

  const tick = async () => {
    const hora  = Number(fmtHora.format(new Date()));
    const fecha = fmtFecha.format(new Date());
    if (hora !== CIERRE_HORA || ultimaFecha === fecha) return;
    ultimaFecha = fecha;
    try {
      const r = await liberarMaquinasCierreDelDia();
      if (r.maquinasLiberadas > 0 || r.cargasSueltas > 0) {
        console.log(`[cierre] ${fecha}: ${r.maquinasLiberadas} máquina(s) liberada(s), ${r.notasListas} nota(s) a LISTA, ` +
                    `${r.cargasSueltas} carga(s) sin arrancar liberada(s)`);
      }
    } catch (err) {
      console.error('[cierre] error al liberar máquinas:', err.message);
    }
    // Las cajas que nadie cerró.
    try {
      const cajas = await cerrarCajasAbiertas();
      if (cajas.length > 0) {
        console.log(`[cierre] ${fecha}: ${cajas.length} caja(s) cerrada(s) automáticamente sin conteo ` +
                    `(sucursal: ${cajas.map(c => c.sucursal).join(', ')})`);
      }
    } catch (err) {
      console.error('[cierre] error al cerrar cajas abiertas:', err.message);
    }

    // Las sesiones de los empleados.
    try {
      const cerradas = await cerrarSesionesEmpleados();
      if (cerradas > 0) {
        console.log(`[cierre] ${fecha}: ${cerradas} sesión(es) de empleado cerrada(s)`);
      }
    } catch (err) {
      console.error('[cierre] error al cerrar sesiones de empleados:', err.message);
    }
  };

  setInterval(tick, INTERVALO_MS);
  console.log(`Cierre del día programado a las ${String(CIERRE_HORA).padStart(2, '0')}:00 (${TZ})`);
}
