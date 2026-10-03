import { describe, it, expect, beforeEach } from 'vitest';
import request from 'supertest';
import app from '../../app.js';
import {
  pool, limpiarBase, seedSucursal, seedUsuario, seedMaquina, seedAjustes, auth, conTemporizador,
} from '../helpers.js';

// Prueba la mecánica del TEMPORIZADOR (dos pasos, otro ciclo): desde el
// 2026-10-02 vive detrás de MAQUINAS_CRONOMETRO=off.
conTemporizador();


// El MODELO declara si una carga corre dos ciclos (mig. 123); sin eso, una
// carga corre uno solo. La bandera de la marca "arranca sola" (mig. 122) se
// borró en la 139.
let admin;

beforeEach(async () => {
  await limpiarBase();
  await seedSucursal('centro');
  admin = await seedUsuario({ rol: 'admin', sucursal: 'centro' });
  await seedAjustes({ precio_carga_mediana: 70, tiempo_carga_mediana: 30 });
});

// Marca, su modelo —que es quien declara los dos
// ciclos— y una lavadora de ambos, con tiempo propio para que el tope de ciclos
// no caiga por "sin tiempo configurado".
async function marcaConMaquina({ dos_ciclos, nombre = 'Speed Queen', modelo = 'SQ-1' }) {
  const marca = await request(app).post('/api/etiquetas/marcas-maquina')
    .set(auth(admin.token)).send({ nombre });
  expect(marca.status).toBe(201);
  const mod = await request(app).post('/api/etiquetas/modelos-maquina')
    .set(auth(admin.token)).send({
      marca_id: marca.body.id, nombre: modelo,
      tipo: 'lavadora', tamano: 'mediana', dos_ciclos,
    });
  expect(mod.status).toBe(201);
  // Tiempo propio de la marca: sin él el tope de ciclos caería a 1 por otra
  // razón (lavadora sin tiempo configurado) y la prueba no diría nada.
  await pool.query(
    `INSERT INTO tiempos_marca (marca_id, tipo, tamano, minutos)
     VALUES ($1, 'lavadora', 'mediana', 35)`,
    [marca.body.id]
  );
  const maquinaId = await seedMaquina({
    nombre: `L-${nombre}`, tipo: 'lavadora_mediana', tamano: 'mediana',
    marca: nombre, modelo,
  });
  return { marcaId: marca.body.id, modeloId: mod.body.id, maquinaId };
}

describe('POST/PUT /api/etiquetas/marcas-maquina', () => {
  it('el modelo guarda los dos ciclos y se pueden cambiar', async () => {
    const { modeloId } = await marcaConMaquina({ dos_ciclos: true });
    const { rows } = await pool.query(
      'SELECT dos_ciclos FROM modelos_maquina WHERE id = $1', [modeloId]);
    expect(rows[0].dos_ciclos).toBe(true);

    await request(app).put(`/api/etiquetas/modelos-maquina/${modeloId}`)
      .set(auth(admin.token)).send({ dos_ciclos: false }).expect(200);
    const { rows: tras } = await pool.query(
      'SELECT dos_ciclos FROM modelos_maquina WHERE id = $1', [modeloId]);
    expect(tras[0].dos_ciclos).toBe(false);
  });
});

describe('GET /api/maquinas — lo que declaran marca y modelo', () => {
  it('la máquina trae las dos cosas juntas', async () => {
    const { maquinaId } = await marcaConMaquina({ dos_ciclos: true });
    const res = await request(app).get('/api/maquinas').set(auth(admin.token));
    expect(res.status).toBe(200);
    const m = res.body.find(x => x.id === maquinaId);
    expect(m.marca_opciones).toEqual({ dos_ciclos: true });
  });

  it('el modelo marcado con 2 ciclos sube el tope a 2', async () => {
    const { maquinaId } = await marcaConMaquina({ dos_ciclos: true });
    const res = await request(app).get('/api/maquinas').set(auth(admin.token));
    expect(res.body.find(x => x.id === maquinaId).ciclos_max).toBe(2);
  });

  it('sin marcar nada, una carga corre UN ciclo aunque la lavadora tenga tiempo', async () => {
    const { maquinaId } = await marcaConMaquina({ dos_ciclos: false });
    const res = await request(app).get('/api/maquinas').set(auth(admin.token));
    expect(res.body.find(x => x.id === maquinaId).ciclos_max).toBe(1);
  });

  it('una máquina SIN modelo capturado corre un solo ciclo', async () => {
    await request(app).post('/api/etiquetas/marcas-maquina')
      .set(auth(admin.token)).send({ nombre: 'Whirlpool' }).expect(201);
    const { rows: marca } = await pool.query("SELECT id FROM marcas_maquina WHERE nombre = 'Whirlpool'");
    await pool.query(
      `INSERT INTO tiempos_marca (marca_id, tipo, tamano, minutos) VALUES ($1, 'lavadora', 'mediana', 45)`,
      [marca[0].id]
    );
    const maquinaId = await seedMaquina({
      nombre: 'L-WH', tipo: 'lavadora_mediana', tamano: 'mediana', marca: 'Whirlpool',
    });
    const res = await request(app).get('/api/maquinas').set(auth(admin.token));
    const m = res.body.find(x => x.id === maquinaId);
    expect(m.marca_opciones).toEqual({ dos_ciclos: false });
    // Lo decidido el 2026-09-25: los dos ciclos se declaran en el modelo, así
    // que una máquina sin modelo no los ofrece.
    expect(m.ciclos_max).toBe(1);
  });
});
