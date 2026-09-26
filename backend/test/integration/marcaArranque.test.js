import { describe, it, expect, beforeEach } from 'vitest';
import request from 'supertest';
import app from '../../app.js';
import {
  pool, limpiarBase, seedSucursal, seedUsuario, seedMaquina, seedAjustes, auth,
} from '../helpers.js';

// La marca declara cómo se comportan sus máquinas (mig. 122): si arrancan solas
// al recibir corriente y si una carga corre un solo ciclo.
let admin;

beforeEach(async () => {
  await limpiarBase();
  await seedSucursal('centro');
  admin = await seedUsuario({ rol: 'admin', sucursal: 'centro' });
  await seedAjustes({ precio_carga_mediana: 70, tiempo_carga_mediana: 30 });
});

// Marca con sus dos banderas y una lavadora de esa marca, con tiempo propio
// para que el tope de ciclos no caiga por "sin tiempo configurado".
async function marcaConMaquina({ arranca_sola, ciclo_unico, nombre = 'Speed Queen' }) {
  const marca = await request(app).post('/api/etiquetas/marcas-maquina')
    .set(auth(admin.token)).send({ nombre, arranca_sola, ciclo_unico });
  expect(marca.status).toBe(201);
  // Tiempo propio de la marca: sin él el tope de ciclos caería a 1 por otra
  // razón (lavadora sin tiempo configurado) y la prueba no diría nada.
  await pool.query(
    `INSERT INTO tiempos_marca (marca_id, tipo, tamano, minutos)
     VALUES ($1, 'lavadora', 'mediana', 35)`,
    [marca.body.id]
  );
  const maquinaId = await seedMaquina({
    nombre: `L-${nombre}`, tipo: 'lavadora_mediana', tamano: 'mediana', marca: nombre,
  });
  return { marcaId: marca.body.id, maquinaId };
}

describe('POST/PUT /api/etiquetas/marcas-maquina', () => {
  it('la marca guarda sus dos banderas y se pueden cambiar', async () => {
    const { marcaId } = await marcaConMaquina({ arranca_sola: true, ciclo_unico: true });
    const { rows } = await pool.query(
      'SELECT arranca_sola, ciclo_unico FROM marcas_maquina WHERE id = $1', [marcaId]);
    expect(rows[0]).toEqual({ arranca_sola: true, ciclo_unico: true });

    await request(app).put(`/api/etiquetas/marcas-maquina/${marcaId}`)
      .set(auth(admin.token)).send({ arranca_sola: false }).expect(200);
    const { rows: tras } = await pool.query(
      'SELECT arranca_sola, ciclo_unico FROM marcas_maquina WHERE id = $1', [marcaId]);
    // Solo cambia la que se manda: la otra se queda como estaba.
    expect(tras[0]).toEqual({ arranca_sola: false, ciclo_unico: true });
  });

  it('una marca nueva nace con las dos en falso (comportamiento de siempre)', async () => {
    const res = await request(app).post('/api/etiquetas/marcas-maquina')
      .set(auth(admin.token)).send({ nombre: 'Whirlpool' });
    expect(res.status).toBe(201);
    expect(res.body.arranca_sola).toBe(false);
    expect(res.body.ciclo_unico).toBe(false);
  });
});

describe('GET /api/maquinas — lo que la marca declara', () => {
  it('la máquina trae las opciones de su marca', async () => {
    const { maquinaId } = await marcaConMaquina({ arranca_sola: true, ciclo_unico: true });
    const res = await request(app).get('/api/maquinas').set(auth(admin.token));
    expect(res.status).toBe(200);
    const m = res.body.find(x => x.id === maquinaId);
    expect(m.marca_opciones).toEqual({ arranca_sola: true, ciclo_unico: true });
  });

  it('una marca de ciclo único deja el tope en 1', async () => {
    const { maquinaId } = await marcaConMaquina({ arranca_sola: true, ciclo_unico: true });
    const res = await request(app).get('/api/maquinas').set(auth(admin.token));
    expect(res.body.find(x => x.id === maquinaId).ciclos_max).toBe(1);
  });

  it('sin la bandera, la lavadora con tiempo configurado sigue con sus dos ciclos', async () => {
    await request(app).post('/api/etiquetas/marcas-maquina')
      .set(auth(admin.token)).send({ nombre: 'LG' }).expect(201);
    const { rows: marca } = await pool.query("SELECT id FROM marcas_maquina WHERE nombre = 'LG'");
    await pool.query(
      `INSERT INTO tiempos_marca (marca_id, tipo, tamano, minutos) VALUES ($1, 'lavadora', 'mediana', 45)`,
      [marca[0].id]
    );
    const maquinaId = await seedMaquina({
      nombre: 'L-LG', tipo: 'lavadora_mediana', tamano: 'mediana', marca: 'LG',
    });
    const res = await request(app).get('/api/maquinas').set(auth(admin.token));
    const m = res.body.find(x => x.id === maquinaId);
    expect(m.marca_opciones).toEqual({ arranca_sola: false, ciclo_unico: false });
    expect(m.ciclos_max).toBe(2);
  });
});
