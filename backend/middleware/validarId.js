// Valida los :id numéricos antes del controlador (con router.param): un id
// inválido ("/notas/undefined") responde 404 en vez de un 500 de Postgres.

/** Máximo de un SERIAL (integer de 4 bytes). */
const MAX_ID = 2147483647;

export const validarId = (queCosa = 'el registro') => (req, res, next, valor) => {
  if (!/^\d+$/.test(String(valor))) {
    return res.status(400).json({ message: `No se reconoció ${queCosa}.` });
  }
  const n = Number(valor);
  if (n < 1 || n > MAX_ID) {
    return res.status(404).json({ message: `No se encontró ${queCosa}.` });
  }
  next();
};
