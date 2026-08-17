// Nombre de la base de datos desechable para pruebas de integración. Vive en
// el Postgres local (mismas credenciales DB_* del .env, otra base). Se recrea
// desde cero en cada corrida; nunca toca la base de desarrollo.
export const TEST_DB_NAME = process.env.TEST_DB_NAME || 'lavanderia_test';
