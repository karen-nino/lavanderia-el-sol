// Valida los :id numéricos de las rutas ANTES de que lleguen al controlador.
//
// Sin esto, un id que no es un número entra tal cual a la consulta y Postgres
// la rechaza ("invalid input syntax for type integer"). El catch del
// controlador lo trata como una falla del servidor: responde 500 —"algo falló
// en el servidor"— y deja un stack trace en el log, cuando lo único que pasó
// es que el registro no existe. Pasa con cualquier enlace viejo o mal escrito
// (/notas/undefined es el clásico) y ensucia el log justo donde se buscan los
// errores de verdad.
//
// Se monta con router.param('id', ...), así cubre de una vez todas las rutas
// del router que llevan ese parámetro.

// Los id son SERIAL (integer de 4 bytes). Un número más grande no cabe en la
// columna, así que tampoco puede existir.
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
