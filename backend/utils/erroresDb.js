// Fallos de CONEXIÓN con la base, que no son fallos de la consulta.
//
// El pooler de Supabase suelta las conexiones de vez en cuando (un reinicio de
// su lado, o la limpieza de las que llevan rato ociosas). Cuando pasa, el pool
// de node-postgres todavía cree que sus sockets sirven y se los entrega a la
// siguiente petición, que muere con ECONNRESET sin haber llegado a la base.
//
// Son fallos de ida: la consulta nunca se ejecutó, así que repetirla no duplica
// nada. Eso es lo que hace seguro el reintento, y lo que separa estos errores
// de los de la consulta misma (una restricción violada, un dato inválido), que
// hay que dejar subir tal cual.
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

// node-postgres no siempre trae `code`: cuando el socket muere entre consultas,
// el error llega como un Error pelón con este mensaje.
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
