// Servicio central de sincronización Sonoff.
//
// Toma el ESTADO que la máquina tiene en la BD como fuente de verdad y ordena
// al dispositivo físico que coincida:
//   maquinas.estado = 'en_uso', o encendido manual vigente → encender.
//   cualquier otro caso                                    → apagar.
//
// Con dos excepciones, ambas del barrido periódico (`reconciliando`), y ambas
// por lo mismo: si la última orden nuestra SÍ se aplicó y el relé cambió
// después, fue una persona, y a las personas no se les lleva la contraria.
//   · La encontró apagada y debería estar encendida → la apagaron a mano; no
//     se reenciende (arrancaría un equipo que alguien detuvo, quizá con las
//     manos dentro).
//   · La encontró encendida y debería estar apagada → la prendieron a mano; no
//     se apaga, se adopta como encendido manual (mig. 104).
//
// Es idempotente: llamarlo de más no hace daño (vuelve a afirmar el mismo
// estado). Nunca lanza: al llamarse después de operaciones ya confirmadas, un
// fallo del Sonoff no debe tumbar la respuesta al usuario; solo se refleja en
// maquinas.sonoff_estado para que el indicador de la tarjeta lo muestre.
//
// Actualiza sonoff_estado según el resultado del driver:
//   sin device_id           → 'sin_enlazar'
//   driver confirmó (ok)    → 'enlazada'
//   driver no pudo (!ok)    → 'error' + sonoff_detalle con el porqué
// Excepción: con el driver de simulación no se marca 'enlazada' (ver abajo).

import pool from '../db/pool.js';
import * as dispositivos from './dispositivos/index.js';
import { resumirMotivo } from './dispositivos/mensajes.js';

// Cuánto vale un encendido manual antes de caducar (mig. 104). Un ciclo largo
// no pasa de una hora; el margen es para que nadie se quede sin máquina porque
// alguien la prendió y se olvidó, sin apagarle el lavado a nadie a media carga.
export const HORAS_ENCENDIDO_MANUAL = (() => {
  const h = Number(process.env.SONOFF_ENCENDIDO_MANUAL_HORAS);
  return Number.isFinite(h) && h > 0 ? h : 3;
})();

// ¿El encendido manual sigue vigente?
export const manualVigente = (maq) => {
  if (!maq?.encendida_manual_at) return false;
  const desde = new Date(maq.encendida_manual_at).getTime();
  return Number.isFinite(desde) && Date.now() - desde < HORAS_ENCENDIDO_MANUAL * 60 * 60 * 1000;
};

// Una máquina debe estar encendida si la está usando una nota O si alguien la
// prendió a mano y esa marca no ha caducado (mig. 104).
const estadoDeseado = (maq) =>
  maq.estado === 'en_uso' || manualVigente(maq) ? 'on' : 'off';

// ¿Hay una nota trabajando con esta máquina ahora mismo? Se pregunta antes de
// soltar un encendido manual caducado: si en el camino una nota se adueñó de la
// máquina, dejarla 'disponible' la ofrecería estando cargada.
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

// Junto al estado se guarda POR QUÉ falló (mig. 103). Este servicio corre solo
// —en cada arranque/fin de carga y en el barrido periódico—, así que casi
// siempre es él quien deja la tarjeta en rojo: sin el motivo, quien la mira al
// rato solo ve "Sin conexión" y no sabe si el problema es la cuenta de eWeLink,
// el internet o el Sonoff desenchufado.
async function marcar(id, sonoffEstado, motivo = null) {
  const { rows } = await pool.query(
    `UPDATE maquinas SET sonoff_estado = $1, sonoff_detalle = $2, sonoff_sync_at = NOW()
      WHERE id = $3 RETURNING *`,
    [sonoffEstado, sonoffEstado === 'error' ? resumirMotivo(motivo) : null, id]
  );
  return rows[0] ?? null;
}

// Registra que la máquina se prendió por fuera de la app y la deja ocupada:
// mientras esté así no se ofrece al crear notas ni en Salidas, porque de verdad
// lo está. Se avisa en la campana, que es la única forma de que alguien se
// entere de que una máquina se apartó sola.
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

  // Solo la primera vez: el barrido pasa cada pocos minutos y llenaría la
  // campana con el mismo aviso.
  if (!maq.encendida_manual_at) {
    console.warn(`[sonoff] ${maq.nombre ?? maq.id} apareció encendida sin nota: se prendió a mano. No se apaga.`);
    try {
      await pool.query(
        `INSERT INTO notificaciones (tipo, mensaje, maquina_id, sucursal)
         VALUES ('encendido_manual', $1, $2, $3)`,
        [`${maq.nombre} se encendió a mano y quedó ocupada`, maq.id, maq.sucursal]
      );
    } catch (err) {
      // El aviso es un extra: que falle no debe deshacer la adopción.
      console.error('[sonoff] no se pudo avisar del encendido manual:', err.message);
    }
  }
  return actualizada;
}

// Suelta un encendido manual: borra la marca y, si la máquina estaba ocupada
// solo por ella, la devuelve a 'disponible'. Quien llama ya comprobó que
// ninguna nota la esté usando.
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

// Sincroniza UNA máquina (por id). Devuelve la fila actualizada, o null si no
// existe. No lanza.
//
// `reconciliando` distingue quién llama: el barrido periódico (true) o el
// evento real de la nota al arrancar o terminar una máquina (false). Solo el
// evento enciende de forma incondicional; ver la regla abajo.
export async function sincronizarSonoff(maquinaId, { reconciliando = false } = {}) {
  try {
    const { rows } = await pool.query(
      `SELECT id, nombre, estado, sucursal, device_id, device_canal, sonoff_estado, encendida_manual_at
         FROM maquinas WHERE id = $1`,
      [maquinaId]
    );
    if (rows.length === 0) return null;
    let maq = rows[0];

    if (!dispositivos.tieneDispositivo(maq)) {
      return marcar(maq.id, 'sin_enlazar');
    }

    // Encendido manual caducado: la máquina se suelta y sigue el camino normal,
    // que ahora la quiere apagada. Solo si ninguna nota se la quedó mientras
    // tanto.
    let liberadaPorCaducidad = false;
    if (maq.encendida_manual_at && !manualVigente(maq) && !(await notaEnCurso(maq.id))) {
      console.log(`[sonoff] ${maq.nombre ?? maq.id}: el encendido manual caducó; queda libre y se apaga.`);
      maq = (await liberarEncendidoManual(maq.id)) ?? maq;
      liberadaPorCaducidad = true;
    }

    const deseado = estadoDeseado(maq);

    // El barrido NO vuelve a encender una máquina que quedó apagada si la
    // última orden que le mandamos sí se aplicó ('enlazada'): en ese caso el
    // relé se abrió después, y eso solo pasa si una persona lo apagó (o se fue
    // la luz). Reencenderla arrancaría un equipo que alguien detuvo a
    // propósito, quizá con las manos dentro.
    //
    // Si la última orden falló ('error'), el encendido nunca llegó a ocurrir:
    // ahí sí se reintenta, que es para lo que existe el reconciliador.
    if (deseado === 'on' && reconciliando && maq.sonoff_estado === 'enlazada') {
      const real = await dispositivos.estado(maq);
      if (dispositivos.esSimulacion()) return maq;
      if (real.ok && real.estado === 'off') {
        // Si lo único que la tenía ocupada era un encendido manual y el relé ya
        // está abierto, quien la prendió la apagó: se suelta en el acto. Sin
        // esto la máquina se quedaba apartada hasta que caducara el permiso
        // (3 h), y en el mostrador eso es una lavadora libre que la app no deja
        // usar. Con una nota en curso no se toca: ese estado lo manda el flujo
        // de la nota, no el relé.
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

    // El espejo de la regla de arriba. El barrido tampoco APAGA una máquina que
    // encontró andando cuando la última orden nuestra —un apagado— sí se
    // aplicó: si el relé volvió a cerrarse después, fue una persona. Pasa con
    // el botón "Encender" de Gestión y con quien la prende desde la app de
    // eWeLink; hasta ahora el barrido la cortaba a los 3 minutos, con ropa
    // dentro. Se adopta como encendido manual (mig. 104) en vez de apagarla.
    //
    // Si la última orden FALLÓ ('error'), el apagado nunca ocurrió y la máquina
    // sigue andando por eso, no porque alguien la prendiera: ahí se reintenta.
    // `liberadaPorCaducidad` excluye el caso que acabamos de resolver: la
    // máquina sigue encendida justo porque se le venció el permiso, y volver a
    // adoptarla aquí lo renovaría para siempre. La caducidad tiene que ganar:
    // es la red que apaga lo que alguien prendió y olvidó.
    if (deseado === 'off' && reconciliando && !liberadaPorCaducidad && maq.sonoff_estado === 'enlazada') {
      const real = await dispositivos.estado(maq);
      if (dispositivos.esSimulacion()) return maq;
      if (real.ok && real.estado === 'on') {
        return adoptarEncendidoManual(maq);
      }
      return marcar(maq.id, real.ok ? 'enlazada' : 'error', real.motivo);
    }

    const res = deseado === 'on'
      ? await dispositivos.encender(maq)
      : await dispositivos.apagar(maq);

    // En simulación el driver siempre responde ok: marcar 'enlazada' pintaría
    // el indicador en verde sin que exista ningún Sonoff detrás. Se deja el
    // estado como estaba (la operación simulada ya quedó en el log).
    if (dispositivos.esSimulacion()) return maq;

    return marcar(maq.id, res.ok ? 'enlazada' : 'error', res.motivo);
  } catch (err) {
    console.error(`sincronizarSonoff(${maquinaId}) error:`, err);
    return null;
  }
}

// Sincroniza varias máquinas por id. Best-effort, en paralelo. No lanza.
export async function sincronizarSonoffVarias(ids) {
  if (!Array.isArray(ids) || ids.length === 0) return;
  await Promise.all([...new Set(ids)].map((id) => sincronizarSonoff(id)));
}
