// Una máquina en marcha que se suelta SIN el botón de Finalizar también cierra
// su uso (pasada) con hora de inicio y de fin (2026-10-09). Antes se quedaba
// en blanco y el ciclo salía sin horario ni tiempo encendida en Desempeño,
// Ventas e Información de uso.
import { describe, it, expect, beforeEach } from 'vitest';
import request from 'supertest';
import app from '../../app.js';
import { pool, limpiarBase, seedSucursal, seedUsuario, seedMaquina, seedMarca, seedAjustes, auth } from '../helpers.js';
import { liberarMaquinasCierreDelDia } from '../../jobs/cierreDelDia.js';

let admin;
beforeEach(async () => {
  await limpiarBase();
  await seedSucursal('centro');
  admin = await seedUsuario({ rol: 'admin', sucursal: 'centro' });
  await seedAjustes({ tiempo_carga_mediana: 30, tiempo_carga_jumbo: 45, tiempo_carga_secadora: 40 });
});
const api = (m, u, b) => request(app)[m](u).set(auth(admin.token)).send(b);

// Nota con la lavadora (y, si se pide, la secadora) asignadas; la lavadora
// arrancada hace 5 minutos.
async function lavando({ conSecadora = false } = {}) {
  await seedMarca({ nombre: 'LG', tipo: 'lavadora', tamano: 'mediana', minutos: 15 });
  await seedMarca({ nombre: 'LG', tipo: 'secadora', tamano: 'mediana', minutos: 30 });
  const lav = await seedMaquina({ nombre: 'L1', tipo: 'lavadora_mediana', marca: 'LG' });
  const sec = conSecadora ? await seedMaquina({ nombre: 'S1', tipo: 'secadora', marca: 'LG' }) : null;
  const n = await api('post', '/api/notas', {
    tipo_servicio: 'AUTOSERVICIO', tipo_prenda: 'ROPA', estado_pago: 'PAGADO', forma_pago: 'EFECTIVO',
    cargas: [conSecadora ? { lavadora_tipo: 'mediana', secadora_tipo: 'mediana' } : { lavadora_tipo: 'mediana' }],
  }).expect(201);
  const carga = n.body.cargas[0].id;
  await api('patch', `/api/notas/${n.body.id}/asignar-carga-maquina`, { carga_id: carga, slot: 'lavadora', maquina_id: lav }).expect(200);
  if (sec) await api('patch', `/api/notas/${n.body.id}/asignar-carga-maquina`, { carga_id: carga, slot: 'secadora', maquina_id: sec }).expect(200);
  await api('patch', `/api/notas/${n.body.id}/encender-maquina`, { maquina_id: lav }).expect(200);
  await pool.query("UPDATE maquinas SET en_uso_desde = NOW() - interval '5 minutes' WHERE id = $1", [lav]);
  return { lav, sec, nota: n.body.id };
}

const pasadaDe = async (maquinaId) => (await pool.query(
  `SELECT encendida_at, finalizada_at, llego_tope,
          EXTRACT(EPOCH FROM finalizada_at - encendida_at)::int AS segundos
     FROM nota_carga_maquinas WHERE maquina_id = $1`, [maquinaId]
)).rows[0];

describe('el uso de la máquina se cierra aunque nadie le dé Finalizar', () => {
  it('en el barrido de medianoche', async () => {
    const { lav } = await lavando();
    await liberarMaquinasCierreDelDia();
    const p = await pasadaDe(lav);
    expect(p.finalizada_at).not.toBeNull();
    expect(p.segundos).toBeGreaterThanOrEqual(299);
    expect(p.llego_tope).toBe(false);
  });

  it('al pasar la nota a Por Entregar', async () => {
    const { lav, nota } = await lavando();
    await api('patch', `/api/notas/${nota}/estado`, { estado: 'LISTA' }).expect(200);
    expect((await pasadaDe(lav)).finalizada_at).not.toBeNull();
  });

  it('al arrancar la secadora con la lavadora todavía en uso', async () => {
    const { lav, sec, nota } = await lavando({ conSecadora: true });
    await api('patch', `/api/notas/${nota}/encender-maquina`, { maquina_id: sec }).expect(200);
    const p = await pasadaDe(lav);
    expect(p.finalizada_at).not.toBeNull();
    expect(p.segundos).toBeGreaterThanOrEqual(299);
    // La secadora sigue corriendo: su uso todavía no se cierra.
    expect((await pasadaDe(sec)).finalizada_at).toBeNull();
  });

  it('si ya pasó su tope, el fin es el del tope', async () => {
    const { lav } = await lavando();
    await pool.query("UPDATE maquinas SET en_uso_desde = NOW() - interval '40 minutes' WHERE id = $1", [lav]);
    await liberarMaquinasCierreDelDia();
    const p = await pasadaDe(lav);
    expect(p.llego_tope).toBe(true);
    expect(p.segundos).toBe(15 * 60);
  });
});
