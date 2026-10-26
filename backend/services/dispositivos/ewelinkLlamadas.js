/**
 * Cuenta las llamadas a la nube de eWeLink, por día (hora de México) y sucursal.
 * El plan gratuito da LIMITE_MENSUAL para toda la cuenta y eWeLink no deja
 * consultar cuántas van. Se cuenta en memoria y se guarda cada minuto: así cada
 * llamada no espera a la base (y las pruebas del driver no la tocan).
 */

/** Llamadas al mes del plan gratuito (50,000 por región). */
export const LIMITE_MENSUAL = (() => {
  const n = Number(process.env.EWELINK_LIMITE_MENSUAL);
  return Number.isFinite(n) && n > 0 ? n : 50000;
})();

const ZONA = 'America/Mexico_City';
const GUARDAR_CADA_MS = 60 * 1000;

/** 'YYYY-MM-DD' de hoy en México. */
export const diaLocal = (fecha = new Date()) =>
  new Intl.DateTimeFormat('en-CA', { timeZone: ZONA, year: 'numeric', month: '2-digit', day: '2-digit' }).format(fecha);

/** Pendientes de guardar: `${dia}|${sucursal}` → llamadas. */
const pendientes = new Map();

/** Suma una llamada a la sucursal ('' si no es de ninguna). */
export function registrarLlamada(sucursal) {
  const clave = `${diaLocal()}|${String(sucursal ?? '').toLowerCase()}`;
  pendientes.set(clave, (pendientes.get(clave) ?? 0) + 1);
}

/** Pendientes del mes 'YYYY-MM', por sucursal (lo que aún no llega a la base). */
function pendientesDelMes(mes) {
  const porSucursal = new Map();
  for (const [clave, n] of pendientes) {
    const [dia, sucursal] = clave.split('|');
    if (dia.startsWith(mes)) porSucursal.set(sucursal, (porSucursal.get(sucursal) ?? 0) + n);
  }
  return porSucursal;
}

/** Pasa los pendientes a la base. Si falla, se quedan para la siguiente vuelta. No lanza. */
export async function guardarPendientes() {
  if (pendientes.size === 0) return;
  const lote = [...pendientes];
  pendientes.clear();
  try {
    const { default: pool } = await import('../../db/pool.js');
    await pool.query(
      `INSERT INTO ewelink_llamadas (dia, sucursal, llamadas)
       SELECT d::date, s, n FROM UNNEST($1::text[], $2::text[], $3::int[]) AS t(d, s, n)
       ON CONFLICT (dia, sucursal) DO UPDATE SET llamadas = ewelink_llamadas.llamadas + EXCLUDED.llamadas`,
      [lote.map(([c]) => c.split('|')[0]), lote.map(([c]) => c.split('|')[1]), lote.map(([, n]) => n)]
    );
  } catch (err) {
    console.warn('[dispositivos:ewelink] no se guardó el contador de llamadas:', err.message);
    for (const [clave, n] of lote) pendientes.set(clave, (pendientes.get(clave) ?? 0) + n);
  }
}

/** Guarda el contador cada minuto y al apagarse el servidor (cada deploy de Fly lo reinicia). */
export function iniciarGuardadoLlamadas() {
  const t = setInterval(guardarPendientes, GUARDAR_CADA_MS);
  t.unref?.();
  for (const senal of ['SIGTERM', 'SIGINT']) {
    process.once(senal, () => {
      guardarPendientes().finally(() => process.exit(0));
    });
  }
}

/**
 * Llamadas del mes en curso (México): las guardadas más las pendientes, por
 * sucursal. @returns {Promise<{mes: string, porSucursal: Map<string, number>}>}
 */
export async function llamadasDelMes() {
  const mes = diaLocal().slice(0, 7);
  const { default: pool } = await import('../../db/pool.js');
  const { rows } = await pool.query(
    `SELECT sucursal, SUM(llamadas)::int AS llamadas
       FROM ewelink_llamadas
      WHERE dia >= ($1 || '-01')::date AND dia < (($1 || '-01')::date + INTERVAL '1 month')
      GROUP BY sucursal`,
    [mes]
  );
  const porSucursal = new Map(rows.map(r => [r.sucursal, r.llamadas]));
  for (const [s, n] of pendientesDelMes(mes)) porSucursal.set(s, (porSucursal.get(s) ?? 0) + n);
  return { mes, porSucursal };
}

/** Solo para pruebas. */
export function _reset() {
  pendientes.clear();
}
export const _pendientes = () => new Map(pendientes);
