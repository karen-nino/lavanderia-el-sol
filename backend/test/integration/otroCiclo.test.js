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
  pool, limpiarBase, seedSucursal, seedUsuario, seedMaquina, seedMarca, seedAjustes, auth, conTemporizador,
} from '../helpers.js';
import {
  MAX_CICLOS_POR_CARGA, MARGEN_CORTE_SEGUNDOS, PAUSA_OTRO_CICLO_SEGUNDOS,
} from '../../services/sincronizarSonoff.js';

// Prueba la mecánica del TEMPORIZADOR (dos pasos, otro ciclo): desde el
// 2026-10-02 vive detrás de MAQUINAS_CRONOMETRO=off.
conTemporizador();

// Cuánto hay que envejecer el arranque para que el siguiente ciclo esté
// permitido: el ciclo entero, más el margen de corriente que se le concede,
// más la pausa sin luz. Se calcula desde las constantes y no con un número
// fijo porque los dos valores se configuran por entorno.
const YA_SE_PUEDE = MARGEN_CORTE_SEGUNDOS + PAUSA_OTRO_CICLO_SEGUNDOS + 5;
// El ciclo acaba de cumplirse: no ha pasado ni el margen ni la pausa.
//
// Antes esto envejecía hasta justo después del margen, para probar que la
// pausa se exige aparte. Con margen y pausa en 5 s eso dejaba 3 s de holgura
// para arrancar la app, sembrar y llamar al endpoint, y la prueba se volvía
// intermitente. El candado que se comprueba es el mismo —`instanteOtroCiclo`
// suma los dos relojes— y desde aquí quedan los 10 s enteros.
const RECIEN_TERMINADO = 0;

let admin;
let operador;

beforeEach(async () => {
  await limpiarBase();
  await seedSucursal('centro');
  admin = await seedUsuario({ rol: 'admin', sucursal: 'centro' });
  operador = await seedUsuario({ rol: 'operador', sucursal: 'centro', nombre: 'Operador' });
  await seedAjustes({ tiempo_carga_mediana: 15, tiempo_carga_jumbo: 45, tiempo_carga_secadora: 30 });
  // Las lavadoras de estas pruebas son LG con su tiempo configurado y con un
  // MODELO marcado como de dos ciclos (mig. 123): sin eso —o sin tiempo de
  // marca— la carga corre uno solo y no habría segundo que probar (ver el
  // describe del final).
  await seedMarca({
    nombre: 'Whirlpool', tipo: 'lavadora', tamano: 'mediana', minutos: 15,
    modelo: 'WM-2C', dos_ciclos: true,
  });
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
    const id = await seedMaquina({ nombre: 'L1', tipo: 'lavadora_mediana', tamano: 'mediana', marca: 'Whirlpool', modelo: 'WM-2C' });
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
    const id = await seedMaquina({ nombre: 'L2', tipo: 'lavadora_mediana', tamano: 'mediana', marca: 'Whirlpool', modelo: 'WM-2C' });
    await arrancar(id);
    await envejecer(id, YA_SE_PUEDE);

    await otroCiclo(id, operador).expect(200);
  });

  it('la nota sigue abierta y la máquina en uso: solo cambia el reloj', async () => {
    const id = await seedMaquina({ nombre: 'L3', tipo: 'lavadora_mediana', tamano: 'mediana', marca: 'Whirlpool', modelo: 'WM-2C' });
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
    const id = await seedMaquina({ nombre: 'L4', tipo: 'lavadora_mediana', tamano: 'mediana', marca: 'Whirlpool', modelo: 'WM-2C' });
    const { cargaId } = await arrancar(id);

    const r = await otroCiclo(id, admin);

    expect(r.status).toBe(400);
    expect(r.body.message).toMatch(/sigue en su ciclo/i);
    expect(await ciclosDe(cargaId)).toBe(1);
  });

  it('no se puede antes de que pase la pausa sin corriente', async () => {
    const id = await seedMaquina({ nombre: 'L5', tipo: 'lavadora_mediana', tamano: 'mediana', marca: 'Whirlpool', modelo: 'WM-2C' });
    await arrancar(id);
    // El ciclo terminó, pero la máquina todavía no ha estado sin corriente.
    await envejecer(id, RECIEN_TERMINADO);

    const r = await otroCiclo(id, admin);

    expect(r.status).toBe(400);
    expect(r.body.message).toMatch(/sin corriente/i);
  });

  it('se agota en el tope de ciclos de la carga', async () => {
    const id = await seedMaquina({ nombre: 'L6', tipo: 'lavadora_mediana', tamano: 'mediana', marca: 'Whirlpool', modelo: 'WM-2C' });
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
    const id = await seedMaquina({ nombre: 'L7', tipo: 'lavadora_mediana', tamano: 'mediana', marca: 'Whirlpool', modelo: 'WM-2C' });

    const r = await otroCiclo(id, admin);

    expect(r.status).toBe(400);
    expect(r.body.message).toMatch(/no está corriendo/i);
  });

  it('una máquina de otra sucursal no se encuentra', async () => {
    await seedSucursal('norte', 'Norte');
    const id = await seedMaquina({ nombre: 'L8', tipo: 'lavadora_mediana', tamano: 'mediana', marca: 'Whirlpool', modelo: 'WM-2C', sucursal: 'norte' });

    const r = await otroCiclo(id, admin);

    expect(r.status).toBe(404);
  });
});

describe('otro ciclo — lo que expone la lista de máquinas', () => {
  it('trae los ciclos de la carga y cuándo se habilita el siguiente', async () => {
    const id = await seedMaquina({ nombre: 'L9', tipo: 'lavadora_mediana', tamano: 'mediana', marca: 'Whirlpool', modelo: 'WM-2C' });
    await arrancar(id);

    const r = await request(app).get('/api/maquinas').set(auth(admin.token)).expect(200);
    const m = r.body.find(x => String(x.id) === String(id));

    expect(m.ciclos_carga).toBe(1);
    expect(m.ciclos_max).toBe(MAX_CICLOS_POR_CARGA);
    expect(typeof m.otro_ciclo_desde).toBe('string');
  });

  it('una máquina libre no ofrece otro ciclo', async () => {
    const id = await seedMaquina({ nombre: 'L10', tipo: 'lavadora_mediana', tamano: 'mediana', marca: 'Whirlpool', modelo: 'WM-2C' });

    const r = await request(app).get('/api/maquinas').set(auth(admin.token)).expect(200);
    const m = r.body.find(x => String(x.id) === String(id));

    expect(m.ciclos_carga).toBeNull();
    expect(m.otro_ciclo_desde).toBeNull();
  });
});

// Cargas de un solo ciclo (2026-09-21): las secadoras siempre, y las lavadoras
// sin tiempo de marca (mig. 107), que se cronometran con el respaldo por tamaño
// de Ajustes —un tiempo supuesto, no medido— y encadenarles otra vuelta las
// deja corriendo el doble de lo que nadie comprobó.
describe('otro ciclo — cargas de un solo ciclo', () => {
  it('el endpoint lo rechaza y dice dónde se configura', async () => {
    const id = await seedMaquina({ nombre: 'S1', tipo: 'lavadora_mediana', tamano: 'mediana' });
    const { cargaId } = await arrancar(id);
    await envejecer(id, YA_SE_PUEDE);

    const r = await otroCiclo(id, admin);

    expect(r.status).toBe(400);
    expect(r.body.message).toMatch(/un solo ciclo/i);
    expect(r.body.message).toMatch(/Ajustes/);
    expect(await ciclosDe(cargaId)).toBe(1);
  });

  it('una marca sin tiempo para ESE tamaño cuenta como sin configurar', async () => {
    // La marca existe y hasta tiene tiempo de lavadora mediana, pero esta
    // máquina es jumbo: la combinación marca+tipo+tamaño es la que manda.
    await seedMarca({ nombre: 'Speed Queen', tipo: 'lavadora', tamano: 'mediana', minutos: 35 });
    const id = await seedMaquina({
      nombre: 'S2', tipo: 'lavadora_jumbo', tamano: 'jumbo', marca: 'Speed Queen',
    });
    const { rows } = await pool.query('SELECT 1 FROM maquinas WHERE id = $1', [id]);
    expect(rows).toHaveLength(1);

    const r = await request(app).get('/api/maquinas').set(auth(admin.token)).expect(200);
    const m = r.body.find(x => String(x.id) === String(id));

    expect(m.ciclos_max).toBe(1);
  });

  it('la tarjeta no ofrece el siguiente ciclo: ni tope ni instante', async () => {
    const id = await seedMaquina({ nombre: 'S3', tipo: 'lavadora_mediana', tamano: 'mediana' });
    await arrancar(id);
    await envejecer(id, YA_SE_PUEDE);

    const r = await request(app).get('/api/maquinas').set(auth(admin.token)).expect(200);
    const m = r.body.find(x => String(x.id) === String(id));

    expect(m.ciclos_carga).toBe(1);
    expect(m.ciclos_max).toBe(1);
    expect(m.otro_ciclo_desde).toBeNull();
  });

  it('"Encender máquina" tampoco la revive para otra vuelta', async () => {
    // Es el otro camino al segundo ciclo (mig. 110): si este no respetara el
    // tope, el botón encendería la lavadora igual y el candado del endpoint
    // llegaría tarde, con la máquina ya con corriente.
    const id = await seedMaquina({ nombre: 'S4', tipo: 'lavadora_mediana', tamano: 'mediana' });
    const { notaId } = await arrancar(id);
    await envejecer(id, YA_SE_PUEDE);

    const r = await request(app).patch(`/api/notas/${notaId}/encender-maquina`)
      .set(auth(admin.token)).send({ maquina_id: id });

    expect(r.status).toBe(409);
    const { rows } = await pool.query(
      'SELECT en_uso_desde, encendida_sin_iniciar_at FROM maquinas WHERE id = $1', [id]
    );
    // Sigue con su ciclo viejo, no en el estado de "encendida esperando".
    expect(rows[0].en_uso_desde).not.toBeNull();
    expect(rows[0].encendida_sin_iniciar_at).toBeNull();
  });

  it('una secadora corre un ciclo aunque su marca tenga tiempo configurado', async () => {
    // Un secado es uno: aquí no depende de la configuración, así que la marca
    // con su tiempo no cambia nada.
    await seedMarca({ nombre: 'Samsung', tipo: 'secadora', tamano: 'mediana', minutos: 30 });
    const id = await seedMaquina({
      nombre: 'SEC1', tipo: 'secadora', tamano: 'mediana', marca: 'Samsung',
    });

    const r = await request(app).get('/api/maquinas').set(auth(admin.token)).expect(200);
    const m = r.body.find(x => String(x.id) === String(id));

    expect(m.ciclos_max).toBe(1);
  });
});
