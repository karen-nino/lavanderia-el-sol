import pool from '../db/pool.js';
import { esCronometroSql, TOPE_RELOJ } from '../db/sqlMaquina.js';
import { terminarLavadoFinal, terminarSecado } from '../controllers/notas.controller.js';

// Una máquina con nota que llega a su TOPE se finaliza sola (2026-10-11, a
// pedido): antes se quedaba con "Llegó al tope y se le cortó la luz" esperando
// a que alguien le diera FINALIZAR, y mientras tanto no se podía ocupar.
//
// Se finaliza con la MISMA función que el botón (terminarLavadoFinal /
// terminarSecado), así que pasa exactamente lo mismo: se libera la máquina, se
// cierra la carga, la nota avanza (o se cierra) y el granel se descuenta.
//
// GRACIA: 1 s después del tope (a pedido, 2026-10-11; primero eran 30 s). El
// aviso sonoro de la app (lib/avisoTope.js) suena con el reloj del equipo,
// revisándolo cada segundo con la última lista que pidió: suena en el tope y
// la tarjeta desaparece en el siguiente refresco. El sonido queda como "esta
// se finalizó por tope".
//
// Solo con cronómetro (con temporizador la tarjeta de ciclo terminado espera
// a la persona, como siempre). Las de solo fichas no tienen tope (mig. 149) y
// la encendida a mano sin nota no tiene carga que cerrar.
const INTERVALO_MS = 2 * 1000; // una consulta chica: cabe correrla seguido
const GRACIA_SEGUNDOS = 1;

export async function finalizarMaquinasAlTope() {
  const { rows } = await pool.query(
    `SELECT DISTINCT ON (m.id)
            m.id AS maquina_id, m.nombre, (m.tipo = 'secadora') AS es_secadora,
            n.id AS nota_id, n.folio, n.sucursal
       FROM maquinas m
       JOIN nota_cargas nc
         ON (m.tipo <> 'secadora' AND nc.lavadora_id = m.id AND nc.lavadora_iniciada_at IS NOT NULL)
         OR (m.tipo =  'secadora' AND nc.secadora_id = m.id AND nc.secadora_iniciada_at IS NOT NULL)
       JOIN notas n ON n.id = nc.nota_id
      WHERE ${esCronometroSql()}
        AND m.estado = 'en_uso'
        AND m.en_uso_desde IS NOT NULL
        AND m.ciclo_minutos IS NOT NULL
        AND n.estado NOT IN ('PAGADA', 'FINALIZADA', 'CANCELADA')
        AND m.en_uso_desde + make_interval(mins => ${TOPE_RELOJ('m')})
            + make_interval(secs => $1) <= NOW()
      ORDER BY m.id, GREATEST(nc.lavadora_iniciada_at, nc.secadora_iniciada_at) DESC NULLS LAST`,
    [GRACIA_SEGUNDOS]
  );

  const finalizadas = [];
  for (const r of rows) {
    // Se llama al controlador con un request armado aquí: sin usuario (lo
    // hizo el sistema) y en la sucursal de la nota.
    let estado = 200;
    let cuerpo = null;
    const req = {
      params: { id: String(r.nota_id) },
      body: r.es_secadora ? { secadora_id: r.maquina_id } : { lavadora_id: r.maquina_id },
      sucursal: r.sucursal,
      user: null,
    };
    const res = {
      status(c) { estado = c; return this; },
      json(b) { cuerpo = b; return this; },
      send() { return this; },
    };
    await (r.es_secadora ? terminarSecado : terminarLavadoFinal)(req, res);
    if (estado >= 400) {
      console.error(`[tope] no se pudo finalizar ${r.nombre} (nota ${r.folio}): ${cuerpo?.message ?? estado}`);
    } else {
      finalizadas.push({ maquina: r.nombre, nota: r.folio });
    }
  }
  return finalizadas;
}

export function iniciarFinalizarAlTope() {
  const tick = async () => {
    try {
      const hechas = await finalizarMaquinasAlTope();
      for (const f of hechas) console.log(`[tope] ${f.maquina} se finalizó sola al llegar al tope (nota ${f.nota})`);
    } catch (err) {
      console.error('[tope] error al finalizar máquinas en tope:', err.message);
    }
  };
  setInterval(tick, INTERVALO_MS);
  console.log(`Finalizar al tope: cada ${INTERVALO_MS / 1000} s (gracia ${GRACIA_SEGUNDOS} s)`);
}
