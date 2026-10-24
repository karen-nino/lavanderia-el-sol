/**
 * Sincronización Sonoff: la base de datos manda y el relé la sigue.
 * - Máquina 'en_uso' o con encendido manual vigente → encender; si no, apagar.
 * - Al terminar su ciclo (más MARGEN_CORTE_SEGUNDOS) se corta la luz aunque la
 *   nota siga abierta, para que no se lave otra carga sin nota.
 * - El barrido periódico (`reconciliando`) respeta a las personas: si nuestra
 *   última orden sí se aplicó y el relé cambió después, alguien lo movió a mano.
 *   Apagada a mano → no se reenciende. Prendida a mano → se adopta como
 *   encendido manual.
 *
 * Idempotente y nunca lanza: un fallo solo queda en `sonoff_estado`
 * ('sin_enlazar' | 'enlazada' | 'error' + `sonoff_detalle`). En simulación no se
 * marca 'enlazada'.
 */

import pool from '../db/pool.js';
import * as dispositivos from './dispositivos/index.js';
import { resumirMotivo } from './dispositivos/mensajes.js';
import { cronometroActivo, esCronometroSql, MINUTOS_POR_FICHA, soloFichasSql } from '../db/sqlMaquina.js';

/** Horas que dura un encendido manual antes de caducar. */
export const HORAS_ENCENDIDO_MANUAL = (() => {
  const h = Number(process.env.SONOFF_ENCENDIDO_MANUAL_HORAS);
  return Number.isFinite(h) && h > 0 ? h : 3;
})();

/**
 * Segundos de corriente después de terminar el ciclo, antes del corte (5 por
 * defecto; 0 es válido). Debe ser menor que el ciclo más corto para que no
 * alcance para otra carga. Si el corte llega a media carga, lo que está mal son
 * los minutos del modelo en Ajustes, no este margen. Se suma a la pausa antes
 * de otro ciclo. Acepta también SONOFF_MARGEN_CORTE_MINUTOS.
 */
export const MARGEN_CORTE_SEGUNDOS = (() => {
  const s = Number(process.env.SONOFF_MARGEN_CORTE_SEGUNDOS);
  if (Number.isFinite(s) && s >= 0) return Math.round(s);
  const m = Number(process.env.SONOFF_MARGEN_CORTE_MINUTOS);
  if (Number.isFinite(m) && m >= 0) return Math.round(m * 60);
  return 5;
})();

/** Máximo de ciclos de una carga en un modelo de dos ciclos. */
export const MAX_CICLOS_POR_CARGA = (() => {
  const n = Number(process.env.SONOFF_MAX_CICLOS_POR_CARGA);
  return Number.isInteger(n) && n >= 1 ? n : 2;
})();

/**
 * Ciclos que puede correr la carga en esta máquina. Uno, salvo que su modelo
 * declare `dos_ciclos`. Siempre uno si: es secadora, el cronómetro está activo,
 * la máquina no tiene tiempo configurado (`minutos_ciclo`) o la vuelta es la
 * extra agregada en Salidas (`ciclo_unico`).
 *
 * @param maq fila de `maquinas` con `minutos_ciclo`, `ciclo_unico` y `marca_opciones`.
 */
export const maxCiclosDeMaquina = (maq) =>
  maq?.tipo === 'secadora'
  || cronometroActivo()
  || maq?.minutos_ciclo == null
  || maq?.ciclo_unico
  || !maq?.marca_opciones?.dos_ciclos
    ? 1 : MAX_CICLOS_POR_CARGA;

/**
 * Minutos que una máquina encendida espera su "Iniciar" antes de apagarse y
 * quedar libre. Ojo al bajarlo: si ya arrancaron el lavado sin darle Iniciar,
 * se le corta la luz (el Sonoff BASIC R2 no mide consumo).
 */
export const ESPERA_ARRANQUE_MINUTOS = (() => {
  const m = Number(process.env.SONOFF_ESPERA_ARRANQUE_MINUTOS);
  return Number.isFinite(m) && m > 0 ? m : 5;
})();

/**
 * Segundos sin corriente entre el corte y el siguiente ciclo. Con el margen de
 * corte forma la cuenta atrás de la tarjeta (5 + 5 = 10 s).
 */
export const PAUSA_OTRO_CICLO_SEGUNDOS = (() => {
  const s = Number(process.env.SONOFF_PAUSA_OTRO_CICLO_SEGUNDOS);
  return Number.isFinite(s) && s >= 0 ? Math.round(s) : 5;
})();

/**
 * Corte por fin de ciclo, apagable solo con `SONOFF_CORTE_CICLO=off` sin tocar
 * el resto del control de Sonoff (es la única regla que apaga con nota abierta).
 */
export const CORTE_CICLO_ACTIVO = String(process.env.SONOFF_CORTE_CICLO ?? '').toLowerCase() !== 'off';

/** ¿El encendido manual sigue vigente? */
export const manualVigente = (maq) => {
  if (!maq?.encendida_manual_at) return false;
  const desde = new Date(maq.encendida_manual_at).getTime();
  return Number.isFinite(desde) && Date.now() - desde < HORAS_ENCENDIDO_MANUAL * 60 * 60 * 1000;
};

/** ¿Encendida esperando su "Iniciar" (con corriente y sin cronómetro)? */
export const esperandoArranque = (maq) => {
  if (!maq?.encendida_sin_iniciar_at) return false;
  const desde = new Date(maq.encendida_sin_iniciar_at).getTime();
  return Number.isFinite(desde) && Date.now() - desde < ESPERA_ARRANQUE_MINUTOS * 60 * 1000;
};

/** Instante (epoch ms) en que caduca su espera de arranque, o null. */
export const instanteFinEspera = (maq) => {
  if (!maq?.encendida_sin_iniciar_at) return null;
  const desde = new Date(maq.encendida_sin_iniciar_at).getTime();
  if (!Number.isFinite(desde)) return null;
  return desde + ESPERA_ARRANQUE_MINUTOS * 60 * 1000;
};

/**
 * Instante (epoch ms) en que se cumple el ciclo sellado (`ciclo_minutos` desde
 * `en_uso_desde`), o null si no corre uno. Solo el reloj: no mira el corte ni
 * el encendido manual.
 */
export const finCiclo = (maq) => {
  if (!maq || maq.estado !== 'en_uso') return null;
  if (!maq.en_uso_desde || !maq.ciclo_minutos) return null;
  const desde = new Date(maq.en_uso_desde).getTime();
  if (!Number.isFinite(desde)) return null;
  return desde + Number(maq.ciclo_minutos) * 60 * 1000;
};

/**
 * Instante (epoch ms) en que hay que cortarle la luz: fin de ciclo + margen.
 * null si el corte está apagado, si es un encendido manual o sin ciclo sellado
 * (sin ciclo no se corta a ciegas).
 */
export const instanteCorte = (maq) => {
  if (!CORTE_CICLO_ACTIVO) return null;
  if (manualVigente(maq)) return null;
  const fin = finCiclo(maq);
  return fin == null ? null : fin + MARGEN_CORTE_SEGUNDOS * 1000;
};

/**
 * Instante en que se habilita otro ciclo: fin del anterior + margen (si el corte
 * está activo) + pausa sin luz.
 */
export const instanteOtroCiclo = (maq) => {
  const fin = finCiclo(maq);
  if (fin == null) return null;
  const margen = CORTE_CICLO_ACTIVO ? MARGEN_CORTE_SEGUNDOS : 0;
  return fin + (margen + PAUSA_OTRO_CICLO_SEGUNDOS) * 1000;
};

/** ¿Ya pasó el instante de corte? */
export const cicloVencido = (maq) => {
  const corte = instanteCorte(maq);
  return corte != null && Date.now() >= corte;
};

/**
 * Temporizadores de apagado por máquina. El corte no nace de un cambio en la
 * base (el trigger no lo ve), así que se agenda al segundo. Si el proceso se
 * reinicia, el barrido periódico lo hace igual, más tarde.
 */
const cortesProgramados = new Map();

/**
 * Agenda el apagado de la máquina en el instante más cercano entre su corte y
 * el fin de su espera de arranque. Reemplaza el temporizador anterior.
 */
export function programarCorte(maq) {
  const id = maq?.id;
  if (id == null) return;
  const previo = cortesProgramados.get(id);
  if (previo) clearTimeout(previo);
  cortesProgramados.delete(id);

  const candidatos = [instanteCorte(maq), instanteFinEspera(maq)].filter((t) => t != null);
  if (candidatos.length === 0) return;
  const corte = Math.min(...candidatos);
  const faltan = corte - Date.now();
  if (faltan <= 0) return; // ya venció: lo resuelve esta misma pasada

  const t = setTimeout(() => {
    cortesProgramados.delete(id);
    // Al dispararse, `cicloVencido` ya es true y la sincronización apaga.
    sincronizarSonoff(id);
  }, faltan);
  t.unref?.();
  cortesProgramados.set(id, t);
}

/** Vacía la agenda de apagados (pruebas y apagado limpio). */
export function cancelarCortesProgramados() {
  for (const t of cortesProgramados.values()) clearTimeout(t);
  cortesProgramados.clear();
}

/**
 * 'on' si está en uso (incluida la que espera arranque) y su ciclo no ha
 * vencido, o con encendido manual vigente; si no, 'off'. El corte por fin de
 * ciclo no toca la nota: decidir que la carga terminó le toca a una persona.
 */
const estadoDeseado = (maq) =>
  (maq.estado === 'en_uso' && !cicloVencido(maq)) || manualVigente(maq) ? 'on' : 'off';

/** ¿Alguna nota abierta tiene esta máquina asignada? */
async function notaEnCurso(maquinaId) {
  const { rows } = await pool.query(
    `SELECT 1 FROM notas n
      WHERE n.estado IN ('EN_ESPERA', 'LAVANDO', 'SECANDO')
        AND EXISTS (
          SELECT 1 FROM nota_cargas nc
           WHERE nc.nota_id = n.id
             AND (nc.lavadora_id = $1 OR nc.secadora_id = $1)
        )
      LIMIT 1`,
    [maquinaId]
  );
  return rows.length > 0;
}

/** Guarda el estado del Sonoff y, si falló, el motivo para la tarjeta. */
async function marcar(id, sonoffEstado, motivo = null) {
  const { rows } = await pool.query(
    `UPDATE maquinas SET sonoff_estado = $1, sonoff_detalle = $2, sonoff_sync_at = NOW()
      WHERE id = $3 RETURNING *`,
    [sonoffEstado, sonoffEstado === 'error' ? resumirMotivo(motivo) : null, id]
  );
  return rows[0] ?? null;
}

/**
 * Adopta una máquina prendida por fuera de la app: queda ocupada (no se ofrece
 * a notas) y, la primera vez, se avisa en la campana.
 */
async function adoptarEncendidoManual(maq) {
  const { rows } = await pool.query(
    `UPDATE maquinas
        SET encendida_manual_at = COALESCE(encendida_manual_at, NOW()),
            estado       = CASE WHEN estado = 'disponible' THEN 'en_uso'::estado_maquina ELSE estado END,
            en_uso_desde = CASE WHEN estado = 'disponible' THEN NOW() ELSE en_uso_desde END,
            sonoff_estado = 'enlazada',
            sonoff_detalle = NULL,
            sonoff_sync_at = NOW()
      WHERE id = $1
      RETURNING *`,
    [maq.id]
  );
  const actualizada = rows[0] ?? maq;

  if (!maq.encendida_manual_at) {
    console.warn(`[sonoff] ${maq.nombre ?? maq.id} apareció encendida sin nota: se prendió a mano. No se apaga.`);
    try {
      await pool.query(
        // El aviso se apaga en Ajustes → Alertas; la adopción no.
        `INSERT INTO notificaciones (tipo, mensaje, maquina_id, sucursal)
         SELECT 'encendido_manual', $1, $2, $3
          WHERE COALESCE((SELECT alerta_encendido_manual FROM ajustes WHERE id = 1), TRUE)`,
        [`${maq.nombre} se encendió a mano y quedó ocupada`, maq.id, maq.sucursal]
      );
    } catch (err) {
      console.error('[sonoff] no se pudo avisar del encendido manual:', err.message);
    }
  }
  return actualizada;
}

/**
 * Suelta un encendido manual y deja la máquina disponible. Quien llama ya
 * comprobó que ninguna nota la usa.
 */
async function liberarEncendidoManual(id) {
  const { rows } = await pool.query(
    `UPDATE maquinas
        SET encendida_manual_at = NULL,
            estado       = CASE WHEN estado = 'en_uso' THEN 'disponible'::estado_maquina ELSE estado END,
            en_uso_desde = CASE WHEN estado = 'en_uso' THEN NULL ELSE en_uso_desde END
      WHERE id = $1 RETURNING *`,
    [id]
  );
  return rows[0] ?? null;
}

/**
 * Suelta una espera de arranque caducada y la deja disponible, salvo que
 * entretanto la hayan iniciado (`en_uso_desde`).
 */
async function liberarEsperaArranque(id) {
  const { rows } = await pool.query(
    `UPDATE maquinas
        SET encendida_sin_iniciar_at = NULL,
            encendida_para_nota_id   = NULL,
            estado = CASE WHEN estado = 'en_uso' AND en_uso_desde IS NULL
                          THEN 'disponible'::estado_maquina ELSE estado END
      WHERE id = $1 RETURNING *`,
    [id]
  );
  return rows[0] ?? null;
}

/**
 * Aviso en la campana, una vez por encendido, de que una máquina con cronómetro
 * llegó a su tope sin que nadie la finalizara.
 */
async function avisarTopeCronometro(maq) {
  try {
    await pool.query(
      `INSERT INTO notificaciones (tipo, mensaje, maquina_id, sucursal)
       SELECT 'tope_cronometro', $1, $2, $3
        -- El aviso se apaga en Ajustes → Alertas; el corte no.
        WHERE COALESCE((SELECT alerta_tope_maquina FROM ajustes WHERE id = 1), TRUE)
          AND NOT EXISTS (
          SELECT 1 FROM notificaciones
           WHERE tipo = 'tope_cronometro' AND maquina_id = $2 AND created_at >= $4
        )`,
      [
        `${maq.nombre} llegó a ${maq.ciclo_minutos} min sin que nadie la finalizara: se le cortó la luz. Finaliza su carga.`,
        maq.id, maq.sucursal, maq.en_uso_desde,
      ]
    );
  } catch (err) {
    console.error('[sonoff] no se pudo avisar del tope del cronómetro:', err.message);
  }
}

/**
 * Aviso en la campana de que una máquina que debía prender para una nota no
 * encendió (p. ej. se acabó el límite de eWeLink): el cronómetro corre aunque la
 * máquina no tenga luz. Una vez por arranque.
 */
async function avisarNoEncendio(maq, motivo) {
  try {
    await pool.query(
      `INSERT INTO notificaciones (tipo, mensaje, maquina_id, sucursal)
       SELECT 'sonoff_no_encendio', $1, $2, $3
        WHERE NOT EXISTS (
          SELECT 1 FROM notificaciones
           WHERE tipo = 'sonoff_no_encendio' AND maquina_id = $2
             AND created_at >= COALESCE($4::timestamptz, NOW() - INTERVAL '1 hour')
        )`,
      [
        `${maq.nombre} no encendió: ${resumirMotivo(motivo)}`,
        maq.id, maq.sucursal, maq.en_uso_desde ?? maq.encendida_sin_iniciar_at ?? null,
      ]
    );
  } catch (err) {
    console.error('[sonoff] no se pudo avisar que la máquina no encendió:', err.message);
  }
}

// ── Secadoras de fichas ──
// Su Sonoff va en modo pulso: cada "on" dura 0.5 s y la secadora lo cuenta
// como una ficha. Están siempre alimentadas: solo se mandan las fichas.

/**
 * Fichas a meter al arrancar (al menos una):
 * - Con programa elegido, hacia arriba (quedarse corto deja la ropa mojada).
 * - Sin programa, las que quepan en el tope, hacia abajo (tope 35 con ficha de
 *   30 → una).
 */
export const fichasParaArranque = (maq) => {
  const porFicha = Number(maq?.minutos_por_ficha);
  if (!Number.isFinite(porFicha) || porFicha <= 0) return 0;
  const elegido = Number(maq.ciclo_elegido_minutos);
  if (maq.ciclo_elegido_minutos != null && Number.isFinite(elegido) && elegido > 0) {
    return Math.max(1, Math.ceil(elegido / porFicha));
  }
  const tope = Number(maq.ciclo_minutos);
  if (!Number.isFinite(tope) || tope <= 0) return 1;
  return Math.max(1, Math.floor(tope / porFicha));
};

/** Pausa entre fichas: la secadora necesita ver el relé abrirse. */
export const PAUSA_ENTRE_FICHAS_MS = (() => {
  const ms = Number(process.env.SONOFF_PAUSA_ENTRE_FICHAS_MS);
  return Number.isFinite(ms) && ms >= 0 ? ms : 2000;
})();

const AVISO_FICHAS = 'Solo entraron';

const esperarMs = (ms) => new Promise((r) => setTimeout(r, ms));

/**
 * Mete las fichas del arranque una sola vez: la sincronización corre varias
 * veces por arranque, así que se reclama con un UPDATE atómico. Si falla a
 * medias no se reintenta (podría regalar tiempo): queda en 'error' con cuántas
 * entraron, para completar a mano.
 */
async function meterFichas(maq) {
  const { rows } = await pool.query(
    `UPDATE maquinas SET fichas_para_uso = en_uso_desde
      WHERE id = $1 AND estado = 'en_uso' AND en_uso_desde IS NOT NULL
        AND encendida_manual_at IS NULL
        AND fichas_para_uso IS DISTINCT FROM en_uso_desde
      RETURNING id`,
    [maq.id]
  );
  if (rows.length === 0) return maq;
  return mandarFichas(maq, fichasParaArranque(maq));
}

/** Manda `total` fichas seguidas; si una falla, se detiene y deja el aviso. */
async function mandarFichas(maq, total) {
  console.log(`[sonoff] ${maq.nombre ?? maq.id}: se meten ${total} ficha(s).`);
  for (let i = 1; i <= total; i++) {
    const res = await dispositivos.encender(maq);
    if (!res.ok) {
      console.warn(`[sonoff] ${maq.nombre ?? maq.id}: falló la ficha ${i} de ${total} (${res.motivo}).`);
      if (dispositivos.esSimulacion(maq)) return maq;
      const { rows: upd } = await pool.query(
        `UPDATE maquinas SET sonoff_estado = 'error', sonoff_detalle = $1, sonoff_sync_at = NOW()
          WHERE id = $2 RETURNING *`,
        [`${AVISO_FICHAS} ${i - 1} de ${total} fichas: completa en la máquina. ${resumirMotivo(res.motivo)}`, maq.id]
      );
      return upd[0] ?? maq;
    }
    if (i < total) await esperarMs(PAUSA_ENTRE_FICHAS_MS);
  }
  if (dispositivos.esSimulacion(maq)) return maq;
  return marcar(maq.id, 'enlazada');
}

/**
 * Programas que caben en "Otro ciclo" de una secadora de fichas que pregunta su
 * programa: los que sumados a los minutos ya metidos (`minutos_pagados`) no
 * pasan del tope (tope 30 con 20 metidos → [10]). Lista vacía si no aplica. No
 * mira la hora: eso lo decide quien la muestra.
 */
export const opcionesMasTiempo = (maq) => {
  if (!maq || maq.estado !== 'en_uso' || !maq.en_uso_desde || !maq.cronometro) return [];
  if (!(Number(maq.minutos_por_ficha) > 0)) return [];
  const programas = (maq.modelo_tiempos?.minutos ?? []).map(Number).filter(n => Number.isInteger(n) && n > 0);
  if (!maq.modelo_tiempos?.pregunta || programas.length < 2) return [];
  const pagados = Number(maq.minutos_pagados ?? maq.ciclo_elegido_minutos);
  const tope = Number(maq.ciclo_minutos);
  if (!(pagados > 0) || !(tope > 0)) return [];
  return [...new Set(programas)].filter(p => pagados + p <= tope).sort((a, b) => a - b);
};

/** ¿Ya se cumplió el programa elegido? */
export const programaTerminado = (maq, ahora = Date.now()) =>
  Boolean(maq?.en_uso_desde) && Number(maq.ciclo_elegido_minutos) > 0
  && new Date(maq.en_uso_desde).getTime() + Number(maq.ciclo_elegido_minutos) * 60_000 <= ahora;

/**
 * Manda las fichas de los minutos sumados con "Otro ciclo" (el controlador ya
 * reservó el cupo). No lanza.
 */
export async function meterFichasExtra(maquinaId, minutos) {
  try {
    const { rows } = await pool.query(
      `SELECT m.id, m.nombre, m.sucursal, m.device_id, m.device_canal,
              ${MINUTOS_POR_FICHA} AS minutos_por_ficha
         FROM maquinas m WHERE m.id = $1`,
      [maquinaId]
    );
    const maq = rows[0];
    if (!maq || !dispositivos.tieneDispositivo(maq)) return maq ?? null;
    const porFicha = Number(maq.minutos_por_ficha);
    if (!(porFicha > 0)) return maq;
    return await mandarFichas(maq, Math.max(1, Math.ceil(Number(minutos) / porFicha)));
  } catch (err) {
    console.error(`meterFichasExtra(${maquinaId}) error:`, err);
    return null;
  }
}

/**
 * Sincroniza una máquina. Devuelve la fila actualizada, o null si no existe.
 * No lanza.
 *
 * @param {object} opciones
 * @param {boolean} opciones.reconciliando  true = barrido periódico; false =
 *   evento de una nota (solo este enciende sin preguntar al relé).
 */
export async function sincronizarSonoff(maquinaId, { reconciliando = false } = {}) {
  try {
    const { rows } = await pool.query(
      `SELECT m.id, m.nombre, m.tipo, m.marca, m.estado, m.sucursal, m.device_id, m.device_canal,
              m.sonoff_estado, m.sonoff_detalle, m.encendida_manual_at, m.en_uso_desde, m.ciclo_minutos,
              m.encendida_sin_iniciar_at, m.encendida_para_nota_id,
              m.ciclo_elegido_minutos, m.fichas_para_uso,
              ${MINUTOS_POR_FICHA} AS minutos_por_ficha,
              ${esCronometroSql('m')} AS cronometro,
              ${soloFichasSql('m')} AS solo_fichas
         FROM maquinas m WHERE m.id = $1`,
      [maquinaId]
    );
    if (rows.length === 0) return null;
    let maq = rows[0];

    // Solo fichas: no se le manda nada aunque tenga Sonoff enlazado.
    if (maq.solo_fichas || !dispositivos.tieneDispositivo(maq)) {
      return marcar(maq.id, 'sin_enlazar');
    }

    // Encendido manual caducado: se suelta (si ninguna nota la tomó) y se apaga.
    let liberadaPorCaducidad = false;
    if (maq.encendida_manual_at && !manualVigente(maq) && !(await notaEnCurso(maq.id))) {
      console.log(`[sonoff] ${maq.nombre ?? maq.id}: el encendido manual caducó; queda libre y se apaga.`);
      maq = (await liberarEncendidoManual(maq.id)) ?? maq;
      liberadaPorCaducidad = true;
    }

    // Espera de arranque caducada: se suelta y se apaga. Sin preguntar por
    // notaEnCurso: la nota asignada es la que la encendió.
    let esperaCaducada = false;
    if (maq.encendida_sin_iniciar_at && !esperandoArranque(maq)) {
      console.log(
        `[sonoff] ${maq.nombre ?? maq.id}: nadie inició el lavado en ` +
        `${ESPERA_ARRANQUE_MINUTOS} min; se apaga y queda libre.`
      );
      maq = (await liberarEsperaArranque(maq.id)) ?? maq;
      esperaCaducada = true;
    }

    const deseado = estadoDeseado(maq);

    // Con cronómetro, el corte es el tope: nadie la finalizó (no aplica a fichas).
    if (deseado === 'off' && maq.estado === 'en_uso' && maq.cronometro && cicloVencido(maq)
        && maq.minutos_por_ficha == null) {
      await avisarTopeCronometro(maq);
    }

    // Secadora de fichas: solo se le mandan las fichas del arranque (un "on" de
    // más sería otra ficha). El barrido solo lee su estado para el indicador.
    if (maq.minutos_por_ficha != null) {
      if (!reconciliando) {
        if (maq.estado === 'en_uso' && maq.en_uso_desde && !maq.encendida_manual_at) {
          return meterFichas(maq);
        }
        return maq;
      }
      const real = await dispositivos.estado(maq);
      if (dispositivos.esSimulacion(maq)) return maq;
      // El aviso de fichas incompletas se queda mientras siga su carga.
      if (real.ok && maq.estado === 'en_uso'
          && String(maq.sonoff_detalle ?? '').startsWith(AVISO_FICHAS)) return maq;
      return marcar(maq.id, real.ok ? 'enlazada' : 'error', real.motivo);
    }

    // Barrido: si nuestra última orden se aplicó ('enlazada') y el relé está
    // apagado, alguien la apagó a mano: no se reenciende. Si la orden había
    // fallado ('error'), sí se reintenta.
    if (deseado === 'on' && reconciliando && maq.sonoff_estado === 'enlazada') {
      const real = await dispositivos.estado(maq);
      if (dispositivos.esSimulacion(maq)) return maq;
      if (real.ok && real.estado === 'off') {
        // Un encendido manual que ya apagaron se suelta en el acto (con una nota
        // en curso no: ese estado lo manda la nota).
        if (maq.encendida_manual_at && !(await notaEnCurso(maq.id))) {
          console.log(
            `[sonoff] ${maq.nombre ?? maq.id}: la apagaron a mano; se suelta el encendido manual.`
          );
          await liberarEncendidoManual(maq.id);
          return marcar(maq.id, 'enlazada');
        }
        console.warn(
          `[sonoff] ${maq.nombre ?? maq.id} está apagada pero su nota sigue en uso: ` +
          'la apagaron a mano. No se reenciende.'
        );
        return marcar(maq.id, 'enlazada');
      }
      return marcar(maq.id, real.ok ? 'enlazada' : 'error', real.motivo);
    }

    // Espejo de lo anterior: si nuestro último apagado se aplicó y el relé está
    // encendido, alguien la prendió (botón de Gestión o app de eWeLink): se
    // adopta como encendido manual en vez de apagarla. No aplica si la acabamos
    // de soltar por caducidad o por fin de ciclo: está encendida por nosotros y
    // adoptarla impediría apagarla. Si la orden había fallado, se reintenta.
    if (deseado === 'off' && reconciliando && !liberadaPorCaducidad && !esperaCaducada
        && !cicloVencido(maq) && maq.sonoff_estado === 'enlazada') {
      const real = await dispositivos.estado(maq);
      if (dispositivos.esSimulacion(maq)) return maq;
      if (real.ok && real.estado === 'on') {
        return adoptarEncendidoManual(maq);
      }
      return marcar(maq.id, real.ok ? 'enlazada' : 'error', real.motivo);
    }

    // Si queda encendida, se agenda su apagado.
    if (deseado === 'on') programarCorte(maq);

    // En el barrido, si la lectura en lote ya lo muestra como debe estar, no se
    // manda la orden otra vez (cada orden gasta del límite de eWeLink).
    const leido = reconciliando ? dispositivos.leidoEnLote(maq) : null;
    if (leido?.ok && leido.estado === deseado) return marcar(maq.id, 'enlazada');

    const res = deseado === 'on'
      ? await dispositivos.encender(maq)
      : await dispositivos.apagar(maq);

    // En simulación no se marca 'enlazada': no hay Sonoff detrás.
    if (dispositivos.esSimulacion(maq)) return maq;

    // Debía prender para una nota y no prendió: se avisa (el cronómetro ya corre).
    if (!res.ok && deseado === 'on' && maq.estado === 'en_uso' && !manualVigente(maq)) {
      await avisarNoEncendio(maq, res.motivo);
    }

    return marcar(maq.id, res.ok ? 'enlazada' : 'error', res.motivo);
  } catch (err) {
    console.error(`sincronizarSonoff(${maquinaId}) error:`, err);
    return null;
  }
}

/** Sincroniza varias máquinas en paralelo. No lanza. */
export async function sincronizarSonoffVarias(ids) {
  if (!Array.isArray(ids) || ids.length === 0) return;
  await Promise.all([...new Set(ids)].map((id) => sincronizarSonoff(id)));
}
