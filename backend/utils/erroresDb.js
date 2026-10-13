// Fallos de CONEXIÓN (el pooler soltó el socket y la consulta nunca llegó a la
// base): repetirla no duplica nada. Los errores de la consulta misma
// (restricción, dato inválido) no entran aquí.
const CODIGOS = new Set([
  'ECONNRESET',    // el otro extremo cortó la conexión
  'ECONNREFUSED',  // la base no acepta conexiones (reiniciando)
  'EPIPE',         // se escribió en un socket ya cerrado
  'ETIMEDOUT',     // la conexión no respondió a tiempo
  'ENOTFOUND',     // el DNS del host falló
  'EHOSTUNREACH',
  'ENETUNREACH',
  '57P01',         // Postgres: terminating connection due to administrator command
  '57P03',         // Postgres: the database system is starting up
  '08006',         // Postgres: connection failure
  '08003',         // Postgres: connection does not exist
]);

/** Mensajes sin `code` de node-postgres cuando el socket muere entre consultas. */
const MENSAJES = [
  'Connection terminated unexpectedly',
  'Client has encountered a connection error',
  'connection terminated',
  'server closed the connection unexpectedly',
];

export function esErrorDeConexion(err) {
  if (!err) return false;
  if (CODIGOS.has(err.code)) return true;
  const msg = String(err.message ?? '').toLowerCase();
  return MENSAJES.some(m => msg.includes(m.toLowerCase()));
}
