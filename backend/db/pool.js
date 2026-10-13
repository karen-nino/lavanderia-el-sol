import pg from 'pg';
import dotenv from 'dotenv';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { esErrorDeConexion } from '../utils/erroresDb.js';

dotenv.config();

const { Pool } = pg;

// CA raíz de Supabase (db/supabase-ca.crt, vence en 2031-04) para verificar el
// certificado del servidor. Huella sha256:
// 80:70:25:AD:50:D4:ED:21:9D:2C:9C:7D:29:9C:00:4F:82:4E:B0:0C:F7:F6:5A:FE:F6:07:D0:7B:72:E6:CA:FA
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ca = fs.readFileSync(path.join(__dirname, 'supabase-ca.crt'), 'utf8');

// Producción: DATABASE_URL con SSL. Local: variables DB_* del .env. La config
// se exporta para conexiones fuera del pool (el listener LISTEN/NOTIFY).
// Siempre se verifica el certificado: en Neon (la demo) contra las CA públicas;
// en cualquier otro caso, contra el CA de Supabase.
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

// keepAlive detecta antes una conexión que el pooler cortó; con
// connectionTimeoutMillis la petición falla en 10 s en vez de colgarse.
const pool = new Pool({
  ...dbConfig,
  keepAlive: true,
  connectionTimeoutMillis: 10_000,
});

// Un cliente ocioso puede morir (el pooler suelta conexiones). Sin este
// manejador, Node tumbaría el proceso; el pool ya descarta el cliente roto.
pool.on('error', (err) => {
  console.error('pool: conexión ociosa caída (se descarta y se abre otra):', err.message);
});

/**
 * Consulta que se reintenta una vez si la conexión se cayó antes de llegar a la
 * base (ver utils/erroresDb.js). Solo para consultas sueltas de lectura: dentro
 * de una transacción hay que reintentar el flujo completo.
 */
export async function consultarReintentando(texto, valores) {
  try {
    return await pool.query(texto, valores);
  } catch (err) {
    if (!esErrorDeConexion(err)) throw err;
    // Un respiro antes de reintentar.
    await new Promise(r => setTimeout(r, 100));
    return pool.query(texto, valores);
  }
}

export default pool;
