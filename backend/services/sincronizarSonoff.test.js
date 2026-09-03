import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

// La base y el driver se sustituyen: aquí se prueba la REGLA de sincronización,
// no Postgres ni la nube de eWeLink.
const filas = { maquina: null };
const consultas = [];

vi.mock('../db/pool.js', () => ({
  default: {
    query: async (sql, params) => {
      consultas.push({ sql, params });
      if (/^SELECT/.test(sql.trim())) return { rows: filas.maquina ? [filas.maquina] : [] };
      // UPDATE ... RETURNING *
      filas.maquina = { ...filas.maquina, sonoff_estado: params[0] };
      return { rows: [filas.maquina] };
    },
  },
}));

const driver = {
  encender: vi.fn(async () => ({ ok: true, estado: 'on' })),
  apagar:   vi.fn(async () => ({ ok: true, estado: 'off' })),
  estado:   vi.fn(async () => ({ ok: true, estado: 'on' })),
  tieneDispositivo: (m) => Boolean(m?.device_id),
  esSimulacion: () => false,
};
vi.mock('./dispositivos/index.js', () => ({
  encender: (...a) => driver.encender(...a),
  apagar:   (...a) => driver.apagar(...a),
  estado:   (...a) => driver.estado(...a),
  tieneDispositivo: (...a) => driver.tieneDispositivo(...a),
  esSimulacion: (...a) => driver.esSimulacion(...a),
}));

const { sincronizarSonoff } = await import('./sincronizarSonoff.js');

const maquinaEnUso = (sonoff_estado) => ({
  id: 1, nombre: 'L8', estado: 'en_uso', device_id: '1000adaa34', device_canal: null, sonoff_estado,
});

beforeEach(() => {
  consultas.length = 0;
  vi.clearAllMocks();
  vi.spyOn(console, 'warn').mockImplementation(() => {});
});
afterEach(() => vi.restoreAllMocks());

describe('el barrido no revive una máquina que alguien apagó', () => {
  it('máquina en uso, última orden aplicada y ahora apagada → NO la enciende', async () => {
    filas.maquina = maquinaEnUso('enlazada');
    driver.estado.mockResolvedValueOnce({ ok: true, estado: 'off' });

    await sincronizarSonoff(1, { reconciliando: true });

    expect(driver.estado).toHaveBeenCalled();
    expect(driver.encender).not.toHaveBeenCalled();
  });

  it('si sigue encendida, tampoco manda nada de más', async () => {
    filas.maquina = maquinaEnUso('enlazada');
    driver.estado.mockResolvedValueOnce({ ok: true, estado: 'on' });

    await sincronizarSonoff(1, { reconciliando: true });
    expect(driver.encender).not.toHaveBeenCalled();
  });

  it('si la última orden FALLÓ, el barrido sí reintenta encender', async () => {
    // Nunca llegó a encenderse (se cayó internet al arrancar la nota): para
    // eso existe el reconciliador.
    filas.maquina = maquinaEnUso('error');

    await sincronizarSonoff(1, { reconciliando: true });
    expect(driver.encender).toHaveBeenCalledTimes(1);
  });

  it('el evento de la nota SÍ enciende, aunque la última orden se aplicara', async () => {
    // Arrancar una carga es una orden explícita de una persona.
    filas.maquina = maquinaEnUso('enlazada');

    await sincronizarSonoff(1);
    expect(driver.encender).toHaveBeenCalledTimes(1);
    expect(driver.estado).not.toHaveBeenCalled();
  });

  it('apagar se sigue reafirmando siempre: apagar de más no es peligroso', async () => {
    filas.maquina = { ...maquinaEnUso('enlazada'), estado: 'disponible' };

    await sincronizarSonoff(1, { reconciliando: true });
    expect(driver.apagar).toHaveBeenCalledTimes(1);
    expect(driver.encender).not.toHaveBeenCalled();
  });
});
