// globalSetup de Vitest para las pruebas de integración: recrea la base de
// prueba una vez antes de toda la suite. Los workers de test se conectan luego
// a esa base (DB_NAME lo fija vitest.integration.config.js).
import { bootstrapTestDb } from './bootstrapDb.js';

export default async function setup() {
  await bootstrapTestDb();
}
