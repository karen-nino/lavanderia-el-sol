// El "Edredón" de Autoservicio (2026-10-02).
//
// En "Agregar máquina" hay una casilla Edredón, hasta abajo de las lavadoras.
// Entra a la nota SIN máquina física, cobrando su tarifa de Ajustes
// (`precio_edredon_jumbo`, "Edredón $80"), y en Salidas se le asigna la
// lavadora que esté libre —cualquiera, no solo jumbo— sin que el precio cambie. Desde el mismo día el edredón tampoco exige jumbo en Por Encargo.
import { describe, it, expect, beforeEach } from 'vitest';
import request from 'supertest';
import app from '../../app.js';
import {
  pool, limpiarBase, seedSucursal, seedUsuario, seedMaquina, seedCliente, seedAjustes, auth,
} from '../helpers.js';

let admin;

beforeEach(async () => {
  await limpiarBase();
  await seedSucursal('centro');
  admin = await seedUsuario({ rol: 'admin', sucursal: 'centro' });
  await seedAjustes({ precio_carga_mediana: 70, precio_carga_jumbo: 75, precio_edredon_jumbo: 80 });
});

const crearEdredon = () => request(app).post('/api/notas').set(auth(admin.token)).send({
  tipo_servicio: 'AUTOSERVICIO',
  tipo_prenda: 'ROPA',
  estado_pago: 'PENDIENTE',
  cargas: [{ lavadora_tipo: 'jumbo', tipo_prenda: 'EDREDON' }],
});

describe('Autoservicio: el Edredón', () => {
  it('entra sin máquina y ya cobra su tarifa de Ajustes', async () => {
    const res = await crearEdredon();
    expect(res.status).toBe(201);
    expect(Number(res.body.precio_total)).toBe(80);
    const c = res.body.cargas[0];
    expect(c.lavadora_id).toBeNull();
    expect(c.tipo_prenda).toBe('EDREDON');
    expect(Number(c.precio_lavadora)).toBe(80);
  });

  it('se le asigna cualquier lavadora libre, también una mediana, y el precio no cambia', async () => {
    const mediana = await seedMaquina({ nombre: 'L1', tipo: 'lavadora_mediana', tamano: 'mediana' });
    const creada = await crearEdredon();

    const res = await request(app).patch(`/api/notas/${creada.body.id}/asignar-carga-maquina`)
      .set(auth(admin.token))
      .send({ carga_id: creada.body.cargas[0].id, slot: 'lavadora', maquina_id: mediana });
    expect(res.status).toBe(200);
    expect(res.body.cargas[0].lavadora_id).toBe(mediana);
    expect(Number(res.body.cargas[0].precio_lavadora)).toBe(80);
    expect(Number(res.body.precio_total)).toBe(80);
  });

  it('cambiarle la lavadora por otra mediana tampoco cambia el precio', async () => {
    const l1 = await seedMaquina({ nombre: 'L1', tipo: 'lavadora_mediana', tamano: 'mediana' });
    const l2 = await seedMaquina({ nombre: 'L2', tipo: 'lavadora_mediana', tamano: 'mediana' });
    const creada = await crearEdredon();
    await request(app).patch(`/api/notas/${creada.body.id}/asignar-carga-maquina`).set(auth(admin.token))
      .send({ carga_id: creada.body.cargas[0].id, slot: 'lavadora', maquina_id: l1 }).expect(200);

    await request(app).patch(`/api/notas/${creada.body.id}/cambiar-maquina`).set(auth(admin.token))
      .send({ maquina_actual_id: l1, maquina_nueva_id: l2 }).expect(200);

    const { rows } = await pool.query(
      'SELECT lavadora_id, precio_lavadora FROM nota_cargas WHERE nota_id = $1', [creada.body.id]
    );
    expect(rows[0].lavadora_id).toBe(l2);
    expect(Number(rows[0].precio_lavadora)).toBe(80);
  });

  it('en Por Encargo el edredón tampoco exige jumbo', async () => {
    const mediana = await seedMaquina({ nombre: 'L1', tipo: 'lavadora_mediana', tamano: 'mediana' });
    const clienteId = await seedCliente();
    await seedAjustes({ tope_carga_edredon: 180 });
    const creada = await request(app).post('/api/notas').set(auth(admin.token)).send({
      tipo_servicio: 'POR_ENCARGO', cliente_id: clienteId, tipo_prenda: 'EDREDON',
      estado_pago: 'PENDIENTE', cargas: [{ lavadora_tipo: 'jumbo', tipo_prenda: 'EDREDON' }],
    });
    expect(creada.status).toBe(201);

    const res = await request(app).patch(`/api/notas/${creada.body.id}/asignar-carga-maquina`)
      .set(auth(admin.token))
      .send({ carga_id: creada.body.cargas[0].id, slot: 'lavadora', maquina_id: mediana });
    expect(res.status).toBe(200);
    expect(res.body.cargas[0].lavadora_id).toBe(mediana);
  });
});
