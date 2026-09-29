import pg from 'pg';
import dotenv from 'dotenv';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { esErrorDeConexion } from '../utils/erroresDb.js';

dotenv.config();

const { Pool } = pg;

// CA raíz de Supabase (db/supabase-ca.crt, vigente hasta 2031-04): con él
// la conexión verifica el certificado del servidor en lugar de aceptar
// cualquiera. Huella sha256 del raíz, confirmada desde dos redes distintas
// (local e infraestructura de Fly) el 2026-07-11:
// 80:70:25:AD:50:D4:ED:21:9D:2C:9C:7D:29:9C:00:4F:82:4E:B0:0C:F7:F6:5A:FE:F6:07:D0:7B:72:E6:CA:FA
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ca = fs.readFileSync(path.join(__dirname, 'supabase-ca.crt'), 'utf8');

// En producción (Supabase/Fly) se usa una sola cadena de conexión con SSL.
// En local se siguen usando las variables DB_* sueltas del .env.
// Se exporta también la config para poder crear conexiones dedicadas fuera del
// pool (p. ej. el listener LISTEN/NOTIFY, que necesita una conexión persistente).
// La demo pública corre sobre Neon, que presenta un certificado de una CA
// pública: con el raíz de Supabase clavado, la conexión ahí falla. Se mira el
// host para elegir el ancla de confianza, y el caso por defecto sigue siendo
// el de siempre —el CA de Supabase— para que producción no dependa de que
// este patrón acierte. En ambos ramos se verifica el certificado del
// servidor; lo que cambia es contra qué.
const esNeon = /\.neon\.tech(:|\/|$)/.test(process.env.DATABASE_URL ?? '');

export const dbConfig = process.env.DATABASE_URL
  ? {
      connectionString: process.env.DATABASE_URL,
      ssl: esNeon ? { rejectUnauthorized: true } : { ca, rejectUnauthorized: true },
    }
  : {
      host: process.env.DB_HOST,
      port: process.env.DB_PORT,
      user: process.env.DB_USER,
      password: process.env.DB_PASSWORD,
      database: process.env.DB_NAME,
    };

// Opciones del pool, además de la conexión:
//   · keepAlive — el sistema operativo sondea el socket cada tanto, así que una
//     conexión que el pooler ya cortó se detecta antes de que una petición se
//     estrelle contra ella.
//   · connectionTimeoutMillis — si la base no contesta, la petición falla en 10
//     segundos en vez de quedarse colgada; un 503 rápido se entiende mejor que
//     una pantalla que nunca carga.
const pool = new Pool({
  ...dbConfig,
  keepAlive: true,
  connectionTimeoutMillis: 10_000,
});

// Un cliente OCIOSO puede morir sin que nadie lo esté usando (el pooler de
// Supabase suelta conexiones de vez en cuando). Ese error llega aquí, y sin
// este manejador Node lo trata como excepción no capturada y tumba el proceso
// entero. El pool ya descarta el cliente roto solo; lo único que falta es
// dejar constancia y seguir.
pool.on('error', (err) => {
  console.error('pool: conexión ociosa caída (se descarta y se abre otra):', err.message);
});

// Consulta que aguanta que la conexión se caiga por debajo.
//
// Un ECONNRESET del pooler significa que la consulta NUNCA llegó a la base, así
// que repetirla no duplica nada (ver utils/erroresDb.js). Al segundo intento el
// pool ya tiró el socket muerto y abre uno nuevo. Solo se reintenta una vez: si
// la base de verdad está caída, insistir solo alarga la espera del empleado.
//
// No sustituye a `pool.query` en todos lados: es para las consultas sueltas y
// de solo lectura que atraviesan cada petición. Lo que va dentro de una
// transacción no se puede reintentar así —la transacción entera murió con la
// conexión— y ahí el reintento tiene que ser del flujo completo.
export async function consultarReintentando(texto, valores) {
  try {
    return await pool.query(texto, valores);
  } catch (err) {
    if (!esErrorDeConexion(err)) throw err;
    // Un respiro antes de insistir: si el pooler está reiniciando, volver en el
    // mismo milisegundo encuentra lo mismo.
    await new Promise(r => setTimeout(r, 100));
    return pool.query(texto, valores);
  }
}

export default pool;
