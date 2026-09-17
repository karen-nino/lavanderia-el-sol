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
// Y una regla propia, que no depende del relé sino del reloj: una máquina cuyo
// ciclo terminó hace más de MARGEN_CORTE_MINUTOS se APAGA aunque su nota siga
// abierta. Sin eso el relé quedaba cerrado hasta que alguien marcara la carga
// (o hasta el cierre del día) y en esa ventana se podía lavar otra carga sin
// nota. La nota y el estado de la máquina no se tocan: solo se corta la luz.
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

// Cuánto se le concede a una máquina DESPUÉS de que su ciclo terminó, antes de
// cortarle la corriente.
//
// Existe porque nada apagaba una lavadora al terminar: el relé seguía cerrado
// hasta que alguien marcaba la carga o hasta el cierre del día, y en esa
// ventana se podía correr otra carga sin nota y sin cobro. El interruptor de la
// lavadora funciona mientras haya corriente.
//
// El margen tiene que ser MENOR que el ciclo más corto que se cronometra: así
// nunca alcanza para colar una carga completa —quien lo intente se queda a
// medias— y al mismo tiempo le deja aire a quien tiene que apretar el botón de
// arranque, que no es automático al dar corriente.
//
// Ese ciclo más corto NO es un número fijo del código: sale de `tiempos_marca`
// (mig. 107) y lo edita el admin desde Ajustes. Cuando se escribió esto eran
// los 30 min de las secadoras, de ahí el default de 20 min; hoy son los 15 min
// de las LG, así que ese default ya no cumple la regla y producción lo
// sobreescribe. Si vuelven a bajar un tiempo de ciclo, hay que revisar este
// margen: nada lo valida automáticamente.
//
// Va en SEGUNDOS y no en minutos porque el flujo de dos ciclos (mig. 108) lo
// necesita fino: el negocio quiere que la lavadora se apague a los pocos
// segundos de terminar, no al minuto siguiente. SONOFF_MARGEN_CORTE_MINUTOS se
// sigue leyendo para no romper una configuración existente. Cero es válido
// —corte en el instante exacto en que se cumple el ciclo—, así que la
// comprobación es >= 0 y no > 0: con la de antes, un 0 caía al default de 20.
export const MARGEN_CORTE_SEGUNDOS = (() => {
  const s = Number(process.env.SONOFF_MARGEN_CORTE_SEGUNDOS);
  if (Number.isFinite(s) && s >= 0) return Math.round(s);
  const m = Number(process.env.SONOFF_MARGEN_CORTE_MINUTOS);
  if (Number.isFinite(m) && m >= 0) return Math.round(m * 60);
  return 20 * 60;
})();

// Cuántos ciclos puede correr una misma carga en su máquina (mig. 108). El
// flujo del negocio son dos ciclos de 15 min seguidos; el tope existe para que
// re-armar no se convierta en lavar indefinidamente con una nota ya cobrada.
export const MAX_CICLOS_POR_CARGA = (() => {
  const n = Number(process.env.SONOFF_MAX_CICLOS_POR_CARGA);
  return Number.isInteger(n) && n >= 1 ? n : 2;
})();

// Cuánto aguanta encendida una máquina que espera su arranque (mig. 110).
// "Encender máquina" le da corriente para que el empleado cargue la ropa y
// apriete el botón físico; el cronómetro no corre hasta "Iniciar Lavado". Si
// ese segundo paso no llega, la máquina se apaga y vuelve a quedar libre: un
// descuido no debe dejar una lavadora prendida y apartada toda la tarde.
//
// OJO con bajarlo: si el empleado ya arrancó el lavado físicamente y se olvidó
// de darle "Iniciar Lavado", esto le corta la luz a una carga en marcha. El
// Sonoff no puede distinguirlo (BASIC R2, sin medición de consumo).
export const ESPERA_ARRANQUE_MINUTOS = (() => {
  const m = Number(process.env.SONOFF_ESPERA_ARRANQUE_MINUTOS);
  return Number.isFinite(m) && m > 0 ? m : 5;
})();

// Pausa obligatoria entre el corte y el siguiente ciclo. El negocio la pidió
// explícita: la máquina se queda sin corriente un momento antes de volver a
// arrancar. Va en segundos porque son 10, no minutos.
export const PAUSA_OTRO_CICLO_SEGUNDOS = (() => {
  const s = Number(process.env.SONOFF_PAUSA_OTRO_CICLO_SEGUNDOS);
  return Number.isFinite(s) && s >= 0 ? Math.round(s) : 10;
})();

// Interruptor propio del corte, aparte del general del driver. Esta es la única
// regla que APAGA una máquina con una nota abierta, así que si en el mostrador
// se comporta raro conviene poder desactivarla sola —con `SONOFF_CORTE_CICLO=off`,
// solo config, sin build— y no tener que tumbar todo el control de Sonoff, que
// dejaría también de encender las máquinas al cobrar una nota.
export const CORTE_CICLO_ACTIVO = String(process.env.SONOFF_CORTE_CICLO ?? '').toLowerCase() !== 'off';

// ¿El encendido manual sigue vigente?
export const manualVigente = (maq) => {
  if (!maq?.encendida_manual_at) return false;
  const desde = new Date(maq.encendida_manual_at).getTime();
  return Number.isFinite(desde) && Date.now() - desde < HORAS_ENCENDIDO_MANUAL * 60 * 60 * 1000;
};

// ¿Está encendida esperando que alguien arranque su lavado (mig. 110)?
// Mientras lo esté, la máquina tiene corriente y NO tiene cronómetro: es el
// estado que vive entre "Encender máquina" e "Iniciar Lavado".
export const esperandoArranque = (maq) => {
  if (!maq?.encendida_sin_iniciar_at) return false;
  const desde = new Date(maq.encendida_sin_iniciar_at).getTime();
  return Number.isFinite(desde) && Date.now() - desde < ESPERA_ARRANQUE_MINUTOS * 60 * 1000;
};

// Instante en que se le acaba la espera y hay que apagarla, o null si no está
// esperando. Igual que el corte por fin de ciclo, se agenda al segundo en vez
// de depender del barrido de 3 min.
export const instanteFinEspera = (maq) => {
  if (!maq?.encendida_sin_iniciar_at) return null;
  const desde = new Date(maq.encendida_sin_iniciar_at).getTime();
  if (!Number.isFinite(desde)) return null;
  return desde + ESPERA_ARRANQUE_MINUTOS * 60 * 1000;
};

// ¿Su ciclo ya terminó hace rato? Se mide desde que la máquina se puso en uso,
// con los minutos que se le sellaron al arrancarla (ciclo_minutos, mig. 051:
// salen de la marca de la máquina desde la 107). Sin ciclo sellado no se corta
// nada: preferimos dejarla encendida a cortar a ciegas.
//
// Un encendido manual vigente no cuenta aquí: ese tiene su propia caducidad de
// 3 h, y quien la prendió a mano decide cuánto la usa.
// Instante exacto (epoch ms) en que a esta máquina hay que cortarle la
// corriente, o null si no hay corte que hacer. Separado de `cicloVencido`
// porque el mismo cálculo sirve para dos cosas: decidir si YA venció y saber
// CUÁNTO FALTA para programar el apagado al segundo.
// Instante (epoch ms) en que se cumple el ciclo sellado, o null si la máquina
// no está corriendo uno. Es solo el reloj: no mira el corte ni el encendido
// manual, porque lo usan tanto el apagado como el botón de "otro ciclo", y ese
// segundo tiene que funcionar aunque el corte esté desactivado.
export const finCiclo = (maq) => {
  if (!maq || maq.estado !== 'en_uso') return null;
  if (!maq.en_uso_desde || !maq.ciclo_minutos) return null;
  const desde = new Date(maq.en_uso_desde).getTime();
  if (!Number.isFinite(desde)) return null;
  return desde + Number(maq.ciclo_minutos) * 60 * 1000;
};

export const instanteCorte = (maq) => {
  if (!CORTE_CICLO_ACTIVO) return null;
  if (manualVigente(maq)) return null;
  const fin = finCiclo(maq);
  return fin == null ? null : fin + MARGEN_CORTE_SEGUNDOS * 1000;
};

// Instante en que se habilita el siguiente ciclo: cuando terminó el anterior,
// más el margen de corriente que se le concede, más la pausa en la que la
// máquina tiene que quedarse sin luz. Si el corte está desactivado no hay
// margen que esperar —nunca se apaga— y solo cuenta la pausa.
export const instanteOtroCiclo = (maq) => {
  const fin = finCiclo(maq);
  if (fin == null) return null;
  const margen = CORTE_CICLO_ACTIVO ? MARGEN_CORTE_SEGUNDOS : 0;
  return fin + (margen + PAUSA_OTRO_CICLO_SEGUNDOS) * 1000;
};

export const cicloVencido = (maq) => {
  const corte = instanteCorte(maq);
  return corte != null && Date.now() >= corte;
};

// Apagado programado a la hora exacta.
//
// El corte es la única regla que no nace de un cambio en la base, así que el
// trigger LISTEN/NOTIFY no lo puede disparar: hasta ahora solo lo veía el
// barrido periódico, cada 3 min. Con un margen de segundos eso no sirve —el
// negocio pide que la lavadora se apague a los 10 s de terminar y el barrido lo
// convertía en cualquier cosa entre 10 s y 3 min—, así que al arrancar una
// máquina se agenda su apagado al instante que le toca.
//
// El barrido sigue siendo la red de seguridad: si el proceso se reinicia se
// pierden los temporizadores en memoria, y el corte llega tarde pero llega.
// `unref` evita que un temporizador pendiente mantenga vivo el proceso.
const cortesProgramados = new Map();

export function programarCorte(maq) {
  const id = maq?.id;
  if (id == null) return;
  const previo = cortesProgramados.get(id);
  if (previo) clearTimeout(previo);
  cortesProgramados.delete(id);

  // Dos relojes pueden apagar esta máquina: el fin de su ciclo y, si está
  // esperando arranque (mig. 110), el fin de esa espera. Manda el más cercano.
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

// Para pruebas y apagado limpio: deja la agenda vacía.
export function cancelarCortesProgramados() {
  for (const t of cortesProgramados.values()) clearTimeout(t);
  cortesProgramados.clear();
}

// Una máquina debe estar encendida si la está usando una nota, si alguien la
// prendió a mano y esa marca no ha caducado (mig. 104), o si está esperando que
// arranquen su lavado (mig. 110). Con una excepción: si su ciclo terminó hace
// más del margen, se le corta la corriente aunque la nota siga abierta. La nota
// NO se toca —sigue en Lavando hasta que alguien la marque— porque decidir que
// una carga terminó, y a qué secadora pasa, le toca a una persona: aquí solo se
// quita la corriente para que nadie meta otra carga.
//
// La que espera arranque ya entra por la primera condición (queda 'en_uso' sin
// `en_uso_desde`, así que no tiene ciclo que vencer). Lo que la apaga es la
// caducidad de la espera, que la suelta a 'disponible' antes de llegar aquí.
const estadoDeseado = (maq) =>
  (maq.estado === 'en_uso' && !cicloVencido(maq)) || manualVigente(maq) ? 'on' : 'off';

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

// Suelta una espera de arranque caducada (mig. 110): borra las marcas y, si la
// máquina seguía apartada solo por eso, la devuelve a 'disponible'. El guardo
// de `en_uso_desde IS NULL` es por si "Iniciar Lavado" entró mientras tanto:
// esa máquina ya está lavando y soltarla la ofrecería con ropa dentro.
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

// Sincroniza UNA máquina (por id). Devuelve la fila actualizada, o null si no
// existe. No lanza.
//
// `reconciliando` distingue quién llama: el barrido periódico (true) o el
// evento real de la nota al arrancar o terminar una máquina (false). Solo el
// evento enciende de forma incondicional; ver la regla abajo.
export async function sincronizarSonoff(maquinaId, { reconciliando = false } = {}) {
  try {
    const { rows } = await pool.query(
      `SELECT id, nombre, estado, sucursal, device_id, device_canal, sonoff_estado,
              encendida_manual_at, en_uso_desde, ciclo_minutos,
              encendida_sin_iniciar_at, encendida_para_nota_id
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

    // Espera de arranque caducada (mig. 110): nadie inició el lavado, así que se
    // apaga y vuelve a quedar libre. No se pregunta por `notaEnCurso` como en la
    // caducidad de arriba: la nota que la tiene asignada es justo la que la
    // encendió, y esperarla sería no caducar nunca.
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
    // `cicloVencido` excluye el corte por fin de ciclo, y por la misma razón que
    // `liberadaPorCaducidad`: esa máquina está encendida porque NOSOTROS la
    // encendimos para su carga, no porque alguien la prendiera. Sin esta
    // salvedad el barrido la adoptaría como encendido manual en vez de
    // apagarla, y el corte no ocurriría nunca.
    if (deseado === 'off' && reconciliando && !liberadaPorCaducidad && !esperaCaducada
        && !cicloVencido(maq) && maq.sonoff_estado === 'enlazada') {
      const real = await dispositivos.estado(maq);
      if (dispositivos.esSimulacion()) return maq;
      if (real.ok && real.estado === 'on') {
        return adoptarEncendidoManual(maq);
      }
      return marcar(maq.id, real.ok ? 'enlazada' : 'error', real.motivo);
    }

    // Si queda encendida, se agenda su apagado para el instante exacto en que
    // se cumpla el ciclo. Idempotente: cada pasada reemplaza el temporizador
    // anterior de esa máquina, así que re-armarla para otro ciclo mueve la cita
    // en vez de dejar dos.
    if (deseado === 'on') programarCorte(maq);

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
