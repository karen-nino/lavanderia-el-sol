// Las máquinas de la demo pública: solo Speed Queen jumbo (2026-10-08). La
// función es la misma que importa scripts/reset-demo.mjs; aquí corre contra la
// base de pruebas, nunca contra la demo ni producción.
import { describe, it, expect, beforeEach } from 'vitest';
import request from 'supertest';
import app from '../../app.js';
import { pool, limpiarBase, seedSucursal, seedUsuario, auth } from '../helpers.js';
import { sembrarMaquinasDemo } from '../../scripts/lib/maquinasDemo.js';

beforeEach(async () => {
  await limpiarBase();
  await seedSucursal('pruebas', 'Pruebas');
});

describe('sembrarMaquinasDemo', () => {
  it('deja solo Speed Queen jumbo, con su modelo y su tiempo', async () => {
    expect(await sembrarMaquinasDemo(pool, 'pruebas')).toBe(5);
    const { rows } = await pool.query(
      'SELECT nombre, tipo, tamano, marca, modelo FROM maquinas WHERE sucursal = $1 ORDER BY nombre', ['pruebas']);
    expect(rows.map((m) => m.nombre)).toEqual(['L1', 'L2', 'L3', 'S1', 'S2']);
    expect(rows.every((m) => m.marca === 'Speed Queen' && m.tamano === 'jumbo')).toBe(true);
    expect(rows.filter((m) => m.tipo === 'lavadora_jumbo')).toHaveLength(3);
    expect(rows.filter((m) => m.tipo === 'secadora')).toHaveLength(2);
  });

  it('es idempotente: correrla dos veces no duplica nada', async () => {
    await sembrarMaquinasDemo(pool, 'pruebas');
    expect(await sembrarMaquinasDemo(pool, 'pruebas')).toBe(0);
    const { rows } = await pool.query("SELECT COUNT(*)::int AS n FROM modelos_maquina mo JOIN marcas_maquina mm ON mm.id = mo.marca_id WHERE mm.nombre = 'Speed Queen'");
    expect(rows[0].n).toBe(2);
  });

  it('con temporizador las máquinas toman el tiempo de su modelo', async () => {
    const antes = process.env.MAQUINAS_CRONOMETRO;
    process.env.MAQUINAS_CRONOMETRO = 'off';
    try {
      await sembrarMaquinasDemo(pool, 'pruebas');
      const admin = await seedUsuario({ rol: 'admin', sucursal: 'pruebas' });
      const res = await request(app).get('/api/maquinas').set(auth(admin.token, 'pruebas')).expect(200);
      const l1 = res.body.find((m) => m.nombre === 'L1');
      const s1 = res.body.find((m) => m.nombre === 'S1');
      expect(l1.cronometro).toBe(false);
      expect(l1.minutos_ciclo).toBe(45);
      expect(s1.minutos_ciclo).toBe(40);
    } finally {
      if (antes === undefined) delete process.env.MAQUINAS_CRONOMETRO;
      else process.env.MAQUINAS_CRONOMETRO = antes;
    }
  });
});
