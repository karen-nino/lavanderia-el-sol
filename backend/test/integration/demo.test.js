// El backend de la DEMO pública (ENTORNO_DEMO=1) afloja dos barreras: deja
// entrar sin contraseña y permite al usuario de prueba tocar la configuración
// global. Estas pruebas fijan la parte que no puede aflojarse: el personal que
// dé de alta un visitante tiene que nacer DENTRO del entorno de pruebas.
//
// Si naciera fuera, ese usuario podría iniciar sesión como uno normal y levantar
// notas en una sucursal real; entonces la comprobación de arranque vería
// operación real en la base de la demo y el backend dejaría de levantar
// (utils/entorno.js), sin que el reset nocturno pudiera deshacerlo.
import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import request from 'supertest';

// ENTORNO_DEMO se lee UNA vez, al cargar utils/entorno.js. Hay que ponerla
// antes de que se importe la app, y de ahí que todo lo demás entre por import
// dinámico en vez de por el import estático de siempre.
process.env.ENTORNO_DEMO = '1';

const { default: app }  = await import('../../app.js');
const helpers           = await import('../helpers.js');
const { pool, limpiarBase, seedSucursal, tokenFor, auth } = helpers;

// Se restaura para no contagiar a los demás archivos de prueba, que comparten
// proceso aunque cada uno recargue sus módulos.
afterAll(() => { delete process.env.ENTORNO_DEMO; });

// El visitante de la demo: admin del entorno de pruebas.
async function seedVisitante() {
  const { rows } = await pool.query(
    `INSERT INTO usuarios (nombre, apellido, password, rol, sucursal, activo, es_prueba)
     VALUES ('Prueba', 'Admin', 'x', 'admin', 'pruebas', TRUE, TRUE) RETURNING id`
  );
  return { id: rows[0].id, token: tokenFor(rows[0].id) };
}

beforeEach(async () => {
  await limpiarBase();
  await seedSucursal('centro');
  await seedSucursal('pruebas', 'Sucursal Pruebas');
});

describe('POST /api/usuarios con ENTORNO_DEMO', () => {
  it('el personal que da de alta un visitante nace dentro del entorno de pruebas', async () => {
    const visitante = await seedVisitante();

    const res = await request(app)
      .post('/api/usuarios')
      .set(auth(visitante.token, 'pruebas'))
      .send({ nombre: 'Nuevo', apellido: 'Empleado', password: 'secret123', rol: 'operador', sucursal: 'centro' });

    expect(res.status).toBe(201);
    // Pidió la sucursal real 'centro' y aun así queda encerrado en pruebas.
    expect(res.body.es_prueba).toBe(true);
    expect(res.body.sucursal).toBe('pruebas');
  });

  it('un admin dado de alta en la demo tampoco queda global (sucursal NULL)', async () => {
    const visitante = await seedVisitante();

    const res = await request(app)
      .post('/api/usuarios')
      .set(auth(visitante.token, 'pruebas'))
      .send({ nombre: 'Otro', apellido: 'Admin', password: 'secret123', rol: 'admin' });

    expect(res.status).toBe(201);
    expect(res.body.es_prueba).toBe(true);
    expect(res.body.sucursal).toBe('pruebas');
  });

  it('un admin normal sigue dando de alta personal real, no de prueba', async () => {
    const admin = await helpers.seedUsuario({ rol: 'admin', sucursal: 'centro' });

    const res = await request(app)
      .post('/api/usuarios')
      .set(auth(admin.token, 'centro'))
      .send({ nombre: 'Real', apellido: 'Empleado', password: 'secret123', rol: 'operador', sucursal: 'centro' });

    expect(res.status).toBe(201);
    expect(res.body.es_prueba).toBe(false);
    expect(res.body.sucursal).toBe('centro');
  });

  it('la sucursal de pruebas sigue sin aceptar personal desde fuera de la demo', async () => {
    const admin = await helpers.seedUsuario({ rol: 'admin', sucursal: 'centro' });

    const res = await request(app)
      .post('/api/usuarios')
      .set(auth(admin.token, 'centro'))
      .send({ nombre: 'Cuela', password: 'secret123', rol: 'operador', sucursal: 'pruebas' });

    expect(res.status).toBe(400);
  });
});
