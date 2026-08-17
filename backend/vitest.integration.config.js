import { defineConfig } from 'vitest/config';
import { TEST_DB_NAME } from './test/config.js';

// Pruebas de INTEGRACIÓN: pegan a una base Postgres desechable (se recrea en
// globalSetup) y a la app real vía supertest. Un solo worker en serie: todas
// comparten la misma base y se limpian entre tests.
export default defineConfig({
  test: {
    environment: 'node',
    include: ['test/**/*.test.js'],
    globalSetup: ['./test/globalSetup.js'],
    // Apunta el pool (db/pool.js lee DB_NAME) a la base de prueba. dotenv no
    // pisa las variables ya definidas, así que esto gana sobre el .env.
    env: { DB_NAME: TEST_DB_NAME },
    // Serializa los archivos: todos comparten la misma base de prueba.
    fileParallelism: false,
    hookTimeout: 60000,
    testTimeout: 20000,
  },
});
