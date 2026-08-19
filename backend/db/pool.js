import pg from 'pg';
import dotenv from 'dotenv';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

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
export const dbConfig = process.env.DATABASE_URL
  ? {
      connectionString: process.env.DATABASE_URL,
      ssl: { ca, rejectUnauthorized: true },
    }
  : {
      host: process.env.DB_HOST,
      port: process.env.DB_PORT,
      user: process.env.DB_USER,
      password: process.env.DB_PASSWORD,
      database: process.env.DB_NAME,
    };

const pool = new Pool(dbConfig);

export default pool;
