import pool from '../db/pool.js';

/**
 * Lo que mueve dinero o máquinas exige la caja abierta. Se lee en cada llamada
 * para que las pruebas lo puedan apagar con `NOTA_REQUIERE_CAJA=off`.
 */
export const notaRequiereCaja = () =>
  String(process.env.NOTA_REQUIERE_CAJA ?? '').toLowerCase() !== 'off';

/**
 * Rechaza con 409 CAJA_CERRADA si la sucursal no tiene caja abierta. Va en las
 * acciones de Salidas que empiezan o agregan algo (máquinas, encender, más
 * tiempo, productos, granel); Finalizar y Detener no lo llevan, para terminar
 * las cargas que quedaron corriendo al cerrar el turno.
 */
export async function requiereCajaAbierta(req, res, next) {
  if (!notaRequiereCaja()) return next();
  try {
    const { rows } = await pool.query(
      `SELECT 1 FROM cajas WHERE estado = 'abierta' AND sucursal = $1 LIMIT 1`,
      [req.sucursal]
    );
    if (rows.length === 0) {
      return res.status(409).json({
        code: 'CAJA_CERRADA',
        message: 'La caja está cerrada. Ábrela para poder mover máquinas o productos.',
      });
    }
    return next();
  } catch (err) {
    console.error('requiereCajaAbierta error:', err);
    return res.status(500).json({ message: 'No se pudo revisar la caja. Intenta de nuevo.' });
  }
}
