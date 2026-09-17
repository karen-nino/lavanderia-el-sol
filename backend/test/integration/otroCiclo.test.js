// Segundo ciclo de una misma carga (mig. 108).
//
// El ciclo real de una LG son 15 min y una carga de ropa necesita dos seguidos.
// Al cumplirse el primero el temporizador llega a cero y el corte por fin de
// ciclo le quita la corriente, así que sin este endpoint el empleado se queda
// sin forma de continuar: el encendido manual de Gestión es de admin.
//
// Lo que se fija aquí: que re-armar reinicie el reloj sin tocar la nota ni el
// precio, que respete la pausa sin corriente y el tope de ciclos, y que un
// empleado pueda hacerlo.
import { describe, it, expect, beforeEach } from 'vitest';
import request from 'supertest';
import app from '../../app.js';
import {
  pool, limpiarBase, seedSucursal, seedUsuario, seedMaquina, seedAjustes, auth,
} from '../helpers.js';
import {
  MAX_CICLOS_POR_CARGA, MARGEN_CORTE_SEGUNDOS, PAUSA_OTRO_CICLO_SEGUNDOS,
} from '../../services/sincronizarSonoff.js';

// Cuánto hay que envejecer el arranque para que el siguiente ciclo esté
// permitido: el ciclo entero, más el margen de corriente que se le concede,
// más la pausa sin luz. Se calcula desde las constantes y no con un número
// fijo porque el margen por defecto (20 min) no es el de producción.
const YA_SE_PUEDE = MARGEN_CORTE_SEGUNDOS + PAUSA_OTRO_CICLO_SEGUNDOS + 5;
// Ciclo y margen cumplidos, pero la pausa no.
const FALTA_LA_PAUSA = MARGEN_CORTE_SEGUNDOS + 2;

let admin;
let operador;

beforeEach(async () => {
  await limpiarBase();
  await seedSucursal('centro');
  admin = await seedUsuario({ rol: 'admin', sucursal: 'centro' });
  operador = await seedUsuario({ rol: 'operador', sucursal: 'centro', nombre: 'Operador' });
  await seedAjustes({ tiempo_carga_mediana: 15, tiempo_carga_jumbo: 45, tiempo_carga_secadora: 30 });
});

// Crea una nota de autoservicio pagada, le asigna la lavadora y la arranca.
async function arrancar(lavadoraId) {
  const creada = await request(app).post('/api/notas').set(auth(admin.token)).send({
    tipo_servicio: 'AUTOSERVICIO',
    tipo_prenda: 'ROPA',
    estado_pago: 'PAGADO',
    forma_pago: 'EFECTIVO',
    cargas: [{ lavadora_tipo: 'mediana' }],
  });
  expect(creada.status).toBe(201);
  const cargaId = creada.body.cargas[0].id;
  await request(app).patch(`/api/notas/${creada.body.id}/asignar-carga-maquina`).set(auth(admin.token))
    .send({ carga_id: cargaId, slot: 'lavadora', maquina_id: lavadoraId }).expect(200);
  await request(app).patch(`/api/notas/${creada.body.id}/activar-pendientes`).set(auth(admin.token))
    .send({ maquina_id: lavadoraId }).expect(200);
  return { notaId: creada.body.id, cargaId };
}

// Retrasa el arranque de la máquina para simular que su ciclo ya terminó hace
// `segundos`. Es la única forma de probar los relojes sin esperar 15 minutos.
const envejecer = (maquinaId, segundos) =>
  pool.query(
    `UPDATE maquinas
        SET en_uso_desde = NOW() - (ciclo_minutos * INTERVAL '1 minute') - ($2 * INTERVAL '1 second')
      WHERE id = $1`,
    [maquinaId, segundos]
  );

const ciclosDe = async (cargaId) => {
  const { rows } = await pool.query('SELECT lavadora_ciclos FROM nota_cargas WHERE id = $1', [cargaId]);
  return rows[0].lavadora_ciclos;
};

const otroCiclo = (maquinaId, usuario) =>
  request(app).patch(`/api/maquinas/${maquinaId}/otro-ciclo`).set(auth(usuario.token));

describe('otro ciclo — camino normal', () => {
  it('reinicia el reloj y sube el contador de la carga', async () => {
    const id = await seedMaquina({ nombre: 'L1', tipo: 'lavadora_mediana', tamano: 'mediana' });
    const { cargaId } = await arrancar(id);
    expect(await ciclosDe(cargaId)).toBe(1);

    // Terminó hace rato: margen y pausa cumplidos.
    await envejecer(id, YA_SE_PUEDE);
    const r = await otroCiclo(id, admin);

    expect(r.status).toBe(200);
    expect(r.body.ciclo).toBe(2);
    expect(await ciclosDe(cargaId)).toBe(2);

    // El reloj arranca de nuevo: le vuelven a quedar ~15 min.
    const { rows } = await pool.query(
      `SELECT EXTRACT(EPOCH FROM (NOW() - en_uso_desde)) AS seg FROM maquinas WHERE id = $1`,
      [id]
    );
    expect(Number(rows[0].seg)).toBeLessThan(5);
  });

  it('un operador puede darlo: es quien está en el mostrador', async () => {
    const id = await seedMaquina({ nombre: 'L2', tipo: 'lavadora_mediana', tamano: 'mediana' });
    await arrancar(id);
    await envejecer(id, YA_SE_PUEDE);

    await otroCiclo(id, operador).expect(200);
  });

  it('la nota sigue abierta y la máquina en uso: solo cambia el reloj', async () => {
    const id = await seedMaquina({ nombre: 'L3', tipo: 'lavadora_mediana', tamano: 'mediana' });
    const { notaId } = await arrancar(id);
    await envejecer(id, YA_SE_PUEDE);

    await otroCiclo(id, admin).expect(200);

    const { rows: n } = await pool.query('SELECT estado FROM notas WHERE id = $1', [notaId]);
    expect(n[0].estado).toBe('LAVANDO');
    const { rows: m } = await pool.query('SELECT estado FROM maquinas WHERE id = $1', [id]);
    expect(m[0].estado).toBe('en_uso');
  });
});

describe('otro ciclo — candados', () => {
  it('no se puede a mitad del ciclo', async () => {
    const id = await seedMaquina({ nombre: 'L4', tipo: 'lavadora_mediana', tamano: 'mediana' });
    const { cargaId } = await arrancar(id);

    const r = await otroCiclo(id, admin);

    expect(r.status).toBe(400);
    expect(r.body.message).toMatch(/sigue en su ciclo/i);
    expect(await ciclosDe(cargaId)).toBe(1);
  });

  it('no se puede antes de que pase la pausa sin corriente', async () => {
    const id = await seedMaquina({ nombre: 'L5', tipo: 'lavadora_mediana', tamano: 'mediana' });
    await arrancar(id);
    // El ciclo terminó y el margen también, pero la pausa no.
    await envejecer(id, FALTA_LA_PAUSA);

    const r = await otroCiclo(id, admin);

    expect(r.status).toBe(400);
    expect(r.body.message).toMatch(/sin corriente/i);
  });

  it('se agota en el tope de ciclos de la carga', async () => {
    const id = await seedMaquina({ nombre: 'L6', tipo: 'lavadora_mediana', tamano: 'mediana' });
    const { cargaId } = await arrancar(id);

    // Gasta todos los ciclos permitidos después del primero.
    for (let i = 1; i < MAX_CICLOS_POR_CARGA; i++) {
      await envejecer(id, YA_SE_PUEDE);
      await otroCiclo(id, admin).expect(200);
    }
    expect(await ciclosDe(cargaId)).toBe(MAX_CICLOS_POR_CARGA);

    await envejecer(id, YA_SE_PUEDE);
    const r = await otroCiclo(id, admin);

    expect(r.status).toBe(400);
    expect(r.body.message).toMatch(/ya corrió sus/i);
    expect(await ciclosDe(cargaId)).toBe(MAX_CICLOS_POR_CARGA);
  });

  it('una máquina disponible no acepta otro ciclo', async () => {
    const id = await seedMaquina({ nombre: 'L7', tipo: 'lavadora_mediana', tamano: 'mediana' });

    const r = await otroCiclo(id, admin);

    expect(r.status).toBe(400);
    expect(r.body.message).toMatch(/no está corriendo/i);
  });

  it('una máquina de otra sucursal no se encuentra', async () => {
    await seedSucursal('norte', 'Norte');
    const id = await seedMaquina({ nombre: 'L8', tipo: 'lavadora_mediana', tamano: 'mediana', sucursal: 'norte' });

    const r = await otroCiclo(id, admin);

    expect(r.status).toBe(404);
  });
});

describe('otro ciclo — lo que expone la lista de máquinas', () => {
  it('trae los ciclos de la carga y cuándo se habilita el siguiente', async () => {
    const id = await seedMaquina({ nombre: 'L9', tipo: 'lavadora_mediana', tamano: 'mediana' });
    await arrancar(id);

    const r = await request(app).get('/api/maquinas').set(auth(admin.token)).expect(200);
    const m = r.body.find(x => String(x.id) === String(id));

    expect(m.ciclos_carga).toBe(1);
    expect(m.ciclos_max).toBe(MAX_CICLOS_POR_CARGA);
    expect(typeof m.otro_ciclo_desde).toBe('string');
  });

  it('una máquina libre no ofrece otro ciclo', async () => {
    const id = await seedMaquina({ nombre: 'L10', tipo: 'lavadora_mediana', tamano: 'mediana' });

    const r = await request(app).get('/api/maquinas').set(auth(admin.token)).expect(200);
    const m = r.body.find(x => String(x.id) === String(id));

    expect(m.ciclos_carga).toBeNull();
    expect(m.otro_ciclo_desde).toBeNull();
  });
});
