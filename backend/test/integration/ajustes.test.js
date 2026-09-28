import { describe, it, expect, beforeEach } from 'vitest';
import request from 'supertest';
import app from '../../app.js';
import { limpiarBase, seedSucursal, seedUsuario, seedAjustes, auth } from '../helpers.js';

let admin;

beforeEach(async () => {
  await limpiarBase();
  await seedSucursal('centro');
  admin = await seedUsuario({ rol: 'admin', sucursal: 'centro' });
  // La BD de test trunca ajustes: se siembra la fila id=1 para poder leerla/editarla.
  await seedAjustes({ precio_carga_mediana: 70, tope_carga_grande: 150 });
});

describe('GET /api/ajustes', () => {
  it('devuelve la fila de ajustes', async () => {
    const res = await request(app).get('/api/ajustes').set(auth(admin.token));
    expect(res.status).toBe(200);
    expect(Number(res.body.precio_carga_mediana)).toBe(70);
    expect(Number(res.body.tope_carga_grande)).toBe(150);
  });
});

describe('PATCH /api/ajustes', () => {
  it('un empleado no puede modificar (403)', async () => {
    const empleado = await seedUsuario({ rol: 'operador', sucursal: 'centro', nombre: 'Empleado' });
    const res = await request(app).patch('/api/ajustes').set(auth(empleado.token))
      .send({ precio_carga_mediana: 99 });
    expect(res.status).toBe(403);
  });

  it('el admin actualiza un precio', async () => {
    const res = await request(app).patch('/api/ajustes').set(auth(admin.token))
      .send({ precio_carga_mediana: 85 });
    expect(res.status).toBe(200);
    expect(Number(res.body.precio_carga_mediana)).toBe(85);
  });

  // Estos campos están cerrados en la DEMO pública (ver integration/demo.test.js).
  // Aquí se fija lo contrario: en una instalación normal se guardan como siempre.
  it('el admin edita los textos con los que se identifica el negocio', async () => {
    const res = await request(app).patch('/api/ajustes').set(auth(admin.token))
      .send({
        nombre_negocio: 'Lavandería El Sol',
        rfc: 'xaxx010101000',
        ticket_nota_autoservicio: 'Gracias por su preferencia',
        ticket_nota_encargo: 'Conserve su ticket',
      });
    expect(res.status).toBe(200);
    expect(res.body.nombre_negocio).toBe('Lavandería El Sol');
    expect(res.body.rfc).toBe('XAXX010101000');   // se guarda en mayúsculas
    expect(res.body.ticket_nota_autoservicio).toBe('Gracias por su preferencia');
    expect(res.body.ticket_nota_encargo).toBe('Conserve su ticket');
  });

  it('rechaza un precio negativo → 400', async () => {
    const res = await request(app).patch('/api/ajustes').set(auth(admin.token))
      .send({ precio_carga_mediana: -1 });
    expect(res.status).toBe(400);
    expect(res.body.message).toMatch(/mayor o igual a 0/i);
  });

  it('rechaza un tiempo menor a 1 minuto → 400', async () => {
    const res = await request(app).patch('/api/ajustes').set(auth(admin.token))
      .send({ tiempo_carga_mediana: 0 });
    expect(res.status).toBe(400);
    expect(res.body.message).toMatch(/entero de 1 minuto o más/i);
  });

  // Las tres notas al pie del ticket: una para el que lava él mismo (mig. 105),
  // otra para el que deja su ropa a cargo del negocio y otra para la venta de
  // productos (mig. 113), que no lava nada.
  it('guarda cada nota del ticket por separado', async () => {
    const res = await request(app).patch('/api/ajustes').set(auth(admin.token)).send({
      ticket_nota_autoservicio: 'Recoja sus prendas el mismo día.',
      ticket_nota_encargo:      'Conserve esta nota para recoger.',
      ticket_nota_productos:    'Producto vendido no tiene devolución.',
    });
    expect(res.status).toBe(200);
    expect(res.body.ticket_nota_autoservicio).toBe('Recoja sus prendas el mismo día.');
    expect(res.body.ticket_nota_encargo).toBe('Conserve esta nota para recoger.');
    expect(res.body.ticket_nota_productos).toBe('Producto vendido no tiene devolución.');

    // Y tocar una no pisa las otras.
    const soloEncargo = await request(app).patch('/api/ajustes').set(auth(admin.token))
      .send({ ticket_nota_encargo: 'Otro aviso' });
    expect(soloEncargo.body.ticket_nota_autoservicio).toBe('Recoja sus prendas el mismo día.');
    expect(soloEncargo.body.ticket_nota_encargo).toBe('Otro aviso');
    expect(soloEncargo.body.ticket_nota_productos).toBe('Producto vendido no tiene devolución.');
  });

  it('una nota del ticket vacía ("") la borra (queda en null)', async () => {
    await request(app).patch('/api/ajustes').set(auth(admin.token))
      .send({ ticket_nota_autoservicio: 'Algo' }).expect(200);
    const res = await request(app).patch('/api/ajustes').set(auth(admin.token))
      .send({ ticket_nota_autoservicio: '' });
    expect(res.status).toBe(200);
    expect(res.body.ticket_nota_autoservicio).toBeNull();
  });

  // El precio del servicio Por Encargo es obligatorio: vaciarlo dejaría el
  // servicio en $0, porque ese número ES lo que se cobra.
  it('vaciar ("") el precio de un servicio Por Encargo → 400', async () => {
    const res = await request(app).patch('/api/ajustes').set(auth(admin.token))
      .send({ tope_carga_grande: '' });
    expect(res.status).toBe(400);
    expect(res.body.message).toMatch(/obligatorio/i);
  });

  // Jumbo ya no se vende: su columna sigue ahí para las notas viejas y admite
  // quedarse vacía, como cualquier tope de antes.
  it('un tope jumbo vacío ("") lo quita (queda en null)', async () => {
    const res = await request(app).patch('/api/ajustes').set(auth(admin.token))
      .send({ tope_carga_jumbo: '' });
    expect(res.status).toBe(200);
    expect(res.body.tope_carga_jumbo).toBeNull();
  });

  it('sin campos para actualizar → 400', async () => {
    const res = await request(app).patch('/api/ajustes').set(auth(admin.token))
      .send({});
    expect(res.status).toBe(400);
    expect(res.body.message).toMatch(/no hay cambios/i);
  });
});
