import pool from '../db/pool.js';
import { esCronometroSql, TOPE_RELOJ } from '../db/sqlMaquina.js';
import { terminarLavadoFinal, terminarSecado } from '../controllers/notas.controller.js';

// Una máquina con nota que llega a su tope se finaliza sola, 1 s después, con la
// misma función que el botón Finalizar (terminarLavadoFinal / terminarSecado), a
// nombre de quien tiene el turno.
// El aviso sonoro de la app suena en el tope. Solo con cronómetro; no aplica a
// las de solo fichas (sin tope) ni a las encendidas a mano sin nota.
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
    // Request armado en la sucursal de la nota, a nombre de quien tiene el turno
    // (la caja abierta); sin caja abierta, sin usuario (lo hizo el sistema).
    const { rows: turno } = await pool.query(
      `SELECT usuario_apertura_id AS id FROM cajas WHERE estado = 'abierta' AND sucursal = $1 LIMIT 1`,
      [r.sucursal]
    );
    let estado = 200;
    let cuerpo = null;
    const req = {
      params: { id: String(r.nota_id) },
      body: r.es_secadora ? { secadora_id: r.maquina_id } : { lavadora_id: r.maquina_id },
      sucursal: r.sucursal,
      user: turno[0] ? { id: turno[0].id } : null,
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
