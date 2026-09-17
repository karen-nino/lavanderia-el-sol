import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

// La base y el driver se sustituyen: aquí se prueba la REGLA de sincronización,
// no Postgres ni la nube de eWeLink.
const filas = { maquina: null };
const consultas = [];
const notificaciones = [];
let hayNotaEnCurso = false;

vi.mock('../db/pool.js', () => ({
  default: {
    query: async (sql, params) => {
      consultas.push({ sql, params });
      const s = sql.trim();

      // ¿Una nota está usando la máquina? (antes de soltar un manual caducado)
      if (/FROM notas/.test(s)) return { rows: hayNotaEnCurso ? [{ uno: 1 }] : [] };
      if (/^SELECT/.test(s)) return { rows: filas.maquina ? [filas.maquina] : [] };
      if (/INSERT INTO notificaciones/.test(s)) {
        notificaciones.push(params);
        return { rows: [] };
      }

      // Los UPDATE del servicio, cada uno reconocible por lo que escribe.
      if (/sonoff_estado = \$1/.test(s)) {
        filas.maquina = { ...filas.maquina, sonoff_estado: params[0], sonoff_detalle: params[1] };
      } else if (/encendida_manual_at = COALESCE/.test(s)) {
        filas.maquina = {
          ...filas.maquina,
          encendida_manual_at: filas.maquina.encendida_manual_at ?? new Date().toISOString(),
          estado: filas.maquina.estado === 'disponible' ? 'en_uso' : filas.maquina.estado,
          sonoff_estado: 'enlazada',
        };
      } else if (/encendida_manual_at = NULL/.test(s)) {
        filas.maquina = {
          ...filas.maquina,
          encendida_manual_at: null,
          estado: filas.maquina.estado === 'en_uso' ? 'disponible' : filas.maquina.estado,
        };
      }
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

const { sincronizarSonoff, HORAS_ENCENDIDO_MANUAL } = await import('./sincronizarSonoff.js');

const maquinaEnUso = (sonoff_estado) => ({
  id: 1, nombre: 'L8', estado: 'en_uso', sucursal: 'centro',
  device_id: '1000adaa34', device_canal: null, sonoff_estado, encendida_manual_at: null,
});

const haceHoras = (h) => new Date(Date.now() - h * 60 * 60 * 1000).toISOString();

beforeEach(() => {
  consultas.length = 0;
  notificaciones.length = 0;
  hayNotaEnCurso = false;
  vi.clearAllMocks();
  vi.spyOn(console, 'warn').mockImplementation(() => {});
  vi.spyOn(console, 'log').mockImplementation(() => {});
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
});

// El espejo de lo anterior (mig. 104). Antes el barrido apagaba a los 3 minutos
// cualquier máquina sin nota, incluida la que alguien acababa de prender.
describe('el barrido no apaga una máquina que alguien prendió', () => {
  it('libre, última orden aplicada y ahora encendida → la adopta en vez de apagarla', async () => {
    filas.maquina = { ...maquinaEnUso('enlazada'), estado: 'disponible' };
    driver.estado.mockResolvedValueOnce({ ok: true, estado: 'on' });

    const res = await sincronizarSonoff(1, { reconciliando: true });

    expect(driver.apagar).not.toHaveBeenCalled();
    expect(res.estado).toBe('en_uso');           // ocupada: no se ofrece en notas
    expect(res.encendida_manual_at).toBeTruthy(); // y el barrido la respeta
  });

  it('al adoptarla avisa una sola vez en la campana', async () => {
    filas.maquina = { ...maquinaEnUso('enlazada'), estado: 'disponible' };
    driver.estado.mockResolvedValue({ ok: true, estado: 'on' });

    await sincronizarSonoff(1, { reconciliando: true });
    expect(notificaciones).toHaveLength(1);

    // Segunda pasada del barrido: ya está marcada, no se repite el aviso.
    await sincronizarSonoff(1, { reconciliando: true });
    expect(notificaciones).toHaveLength(1);
  });

  it('libre y de verdad apagada → la deja como está', async () => {
    filas.maquina = { ...maquinaEnUso('enlazada'), estado: 'disponible' };
    driver.estado.mockResolvedValueOnce({ ok: true, estado: 'off' });

    await sincronizarSonoff(1, { reconciliando: true });
    expect(driver.apagar).not.toHaveBeenCalled();
    expect(driver.encender).not.toHaveBeenCalled();
  });

  it('si la última orden FALLÓ, el apagado sí se reintenta', async () => {
    // El apagado nunca llegó a ocurrir: sigue andando por eso, no porque
    // alguien la prendiera.
    filas.maquina = { ...maquinaEnUso('error'), estado: 'disponible' };

    await sincronizarSonoff(1, { reconciliando: true });
    expect(driver.apagar).toHaveBeenCalledTimes(1);
  });

  it('el evento de la nota SÍ apaga sin preguntar', async () => {
    filas.maquina = { ...maquinaEnUso('enlazada'), estado: 'disponible' };

    await sincronizarSonoff(1);
    expect(driver.apagar).toHaveBeenCalledTimes(1);
    expect(driver.estado).not.toHaveBeenCalled();
  });
});

describe('el encendido manual caduca', () => {
  it('vigente: la máquina se mantiene encendida aunque no tenga nota', async () => {
    filas.maquina = {
      ...maquinaEnUso('error'), estado: 'disponible', encendida_manual_at: haceHoras(1),
    };

    await sincronizarSonoff(1, { reconciliando: true });
    expect(driver.apagar).not.toHaveBeenCalled();
    expect(driver.encender).toHaveBeenCalledTimes(1);
  });

  it('caducado: la suelta y la apaga', async () => {
    filas.maquina = {
      ...maquinaEnUso('enlazada'), estado: 'en_uso',
      encendida_manual_at: haceHoras(HORAS_ENCENDIDO_MANUAL + 1),
    };

    const res = await sincronizarSonoff(1, { reconciliando: true });
    expect(res.encendida_manual_at).toBeNull();
    expect(res.estado).toBe('disponible');
    expect(driver.apagar).toHaveBeenCalledTimes(1);
  });

  it('la apagaron a mano antes de caducar: se suelta en el acto', async () => {
    // Prendieron la lavadora desde eWeLink (la app la adoptó y la dejó ocupada)
    // y al rato la apagaron desde ahí mismo. Sin esto se quedaba apartada las
    // 3 h del permiso: una lavadora libre que el mostrador no podía usar.
    filas.maquina = {
      ...maquinaEnUso('enlazada'), estado: 'en_uso', encendida_manual_at: haceHoras(1),
    };
    driver.estado.mockResolvedValueOnce({ ok: true, estado: 'off' });

    const res = await sincronizarSonoff(1, { reconciliando: true });

    expect(res.encendida_manual_at).toBeNull();
    expect(res.estado).toBe('disponible');
    expect(driver.encender).not.toHaveBeenCalled(); // no se le lleva la contraria
  });

  it('la apagaron a mano pero una nota la está usando: NO la suelta', async () => {
    // Aquí el estado lo manda el flujo de la nota, no el relé: soltarla
    // ofrecería una máquina cargada.
    hayNotaEnCurso = true;
    filas.maquina = {
      ...maquinaEnUso('enlazada'), estado: 'en_uso', encendida_manual_at: haceHoras(1),
    };
    driver.estado.mockResolvedValueOnce({ ok: true, estado: 'off' });

    const res = await sincronizarSonoff(1, { reconciliando: true });

    expect(res.estado).toBe('en_uso');
    expect(res.encendida_manual_at).toBeTruthy();
    expect(driver.encender).not.toHaveBeenCalled();
  });

  it('caducado pero con una nota usándola: NO la suelta', async () => {
    // Entre el encendido a mano y la caducidad, una nota se quedó la máquina.
    // Soltarla la ofrecería estando cargada.
    hayNotaEnCurso = true;
    filas.maquina = {
      ...maquinaEnUso('enlazada'), estado: 'en_uso',
      encendida_manual_at: haceHoras(HORAS_ENCENDIDO_MANUAL + 1),
    };

    const res = await sincronizarSonoff(1, { reconciliando: true });
    expect(res.estado).toBe('en_uso');
    expect(driver.apagar).not.toHaveBeenCalled();
  });
});

describe('corte por fin de ciclo', () => {
  // Una máquina que lleva `min` minutos en uso, con un ciclo sellado de
  // `ciclo` minutos. El resto igual que cualquier máquina trabajando.
  const enUsoDesdeHace = (min, ciclo, extra = {}) => ({
    ...maquinaEnUso('enlazada'),
    en_uso_desde: new Date(Date.now() - min * 60 * 1000).toISOString(),
    ciclo_minutos: ciclo,
    ...extra,
  });

  it('ciclo terminado hace más del margen → corta la corriente', async () => {
    // Ciclo de 45 (una LG) + 20 de margen = 65. Lleva 70.
    filas.maquina = enUsoDesdeHace(70, 45);

    await sincronizarSonoff(1, { reconciliando: true });

    expect(driver.apagar).toHaveBeenCalledTimes(1);
    expect(driver.encender).not.toHaveBeenCalled();
  });

  it('dentro del margen NO la corta: el cliente puede tardar en arrancarla', async () => {
    // La lavadora no arranca sola al recibir corriente: hay que apretar su
    // botón, y eso puede pasar minutos después. A los 50 de 65 no se toca.
    filas.maquina = enUsoDesdeHace(50, 45);

    await sincronizarSonoff(1, { reconciliando: true });

    expect(driver.apagar).not.toHaveBeenCalled();
  });

  it('la nota y el estado de la máquina NO se tocan: solo se va la luz', async () => {
    filas.maquina = enUsoDesdeHace(70, 45);

    await sincronizarSonoff(1, { reconciliando: true });

    // Sigue en uso: cerrar la carga (y decidir a qué secadora pasa) le toca a
    // una persona. Aquí solo se quita la corriente.
    expect(filas.maquina.estado).toBe('en_uso');
    const suelta = consultas.some(c => /encendida_manual_at = NULL/.test(c.sql));
    expect(suelta).toBe(false);
  });

  it('no la adopta como encendido manual aunque el relé siga cerrado', async () => {
    // Es el caso que rompería el corte: la máquina está encendida porque la
    // encendimos nosotros, no porque alguien la prendiera.
    filas.maquina = enUsoDesdeHace(70, 45);
    driver.estado.mockResolvedValue({ ok: true, estado: 'on' });

    await sincronizarSonoff(1, { reconciliando: true });

    expect(driver.apagar).toHaveBeenCalledTimes(1);
    expect(filas.maquina.encendida_manual_at).toBeNull();
    expect(notificaciones).toHaveLength(0);
  });

  it('sin ciclo sellado no corta nada: mejor dejarla encendida que cortar a ciegas', async () => {
    filas.maquina = enUsoDesdeHace(600, null);

    await sincronizarSonoff(1, { reconciliando: true });

    expect(driver.apagar).not.toHaveBeenCalled();
  });

  it('un encendido manual vigente manda sobre el ciclo: tiene su propia caducidad', async () => {
    // La prendió una persona hace poco; que el ciclo de su nota anterior
    // hubiera vencido no es razón para cortarle.
    filas.maquina = enUsoDesdeHace(70, 45, { encendida_manual_at: haceHoras(1) });

    await sincronizarSonoff(1, { reconciliando: true });

    expect(driver.apagar).not.toHaveBeenCalled();
  });

  it('el corte también ocurre fuera del barrido, no solo en la pasada periódica', async () => {
    filas.maquina = enUsoDesdeHace(70, 45);

    await sincronizarSonoff(1);

    expect(driver.apagar).toHaveBeenCalledTimes(1);
  });
});

describe('interruptor del corte', () => {
  it('CORTE_CICLO_ACTIVO refleja SONOFF_CORTE_CICLO y por defecto viene encendido', async () => {
    // Se lee al importar el módulo, así que aquí solo se comprueba el valor por
    // defecto; apagarlo en producción es `fly secrets set SONOFF_CORTE_CICLO=off`.
    const { CORTE_CICLO_ACTIVO, MARGEN_CORTE_SEGUNDOS } = await import('./sincronizarSonoff.js');
    expect(CORTE_CICLO_ACTIVO).toBe(true);
    // El margen vive en segundos desde la mig. 108; el default sigue siendo los
    // 20 min de antes.
    expect(MARGEN_CORTE_SEGUNDOS).toBe(20 * 60);
  });
});

describe('relojes del ciclo (mig. 108)', () => {
  const maq = (minutosEnUso, ciclo, extra = {}) => ({
    id: 1,
    estado: 'en_uso',
    en_uso_desde: new Date(Date.now() - minutosEnUso * 60 * 1000).toISOString(),
    ciclo_minutos: ciclo,
    ...extra,
  });

  it('finCiclo no mira el corte: es solo el reloj de la carga', async () => {
    const { finCiclo } = await import('./sincronizarSonoff.js');
    const m = maq(10, 15);
    // Arrancó hace 10 min con ciclo de 15: le faltan 5.
    expect(Math.round((finCiclo(m) - Date.now()) / 60000)).toBe(5);
  });

  it('finCiclo es null sin ciclo sellado o si la máquina no está en uso', async () => {
    const { finCiclo } = await import('./sincronizarSonoff.js');
    expect(finCiclo(maq(10, null))).toBeNull();
    expect(finCiclo(maq(10, 15, { estado: 'disponible' }))).toBeNull();
    expect(finCiclo(null)).toBeNull();
  });

  it('instanteCorte suma el margen al fin del ciclo', async () => {
    const { instanteCorte, finCiclo, MARGEN_CORTE_SEGUNDOS } = await import('./sincronizarSonoff.js');
    const m = maq(10, 15);
    expect(instanteCorte(m) - finCiclo(m)).toBe(MARGEN_CORTE_SEGUNDOS * 1000);
  });

  it('un encendido manual vigente cancela el corte pero no el reloj', async () => {
    const { instanteCorte, finCiclo } = await import('./sincronizarSonoff.js');
    const m = maq(10, 15, { encendida_manual_at: new Date().toISOString() });
    expect(instanteCorte(m)).toBeNull();
    expect(finCiclo(m)).not.toBeNull();
  });

  it('instanteOtroCiclo espera el margen Y la pausa sin corriente', async () => {
    const { instanteOtroCiclo, finCiclo, MARGEN_CORTE_SEGUNDOS, PAUSA_OTRO_CICLO_SEGUNDOS } =
      await import('./sincronizarSonoff.js');
    const m = maq(10, 15);
    expect(instanteOtroCiclo(m) - finCiclo(m)).toBe(
      (MARGEN_CORTE_SEGUNDOS + PAUSA_OTRO_CICLO_SEGUNDOS) * 1000
    );
  });

  it('la pausa por defecto son 10 s y el tope, 2 ciclos', async () => {
    const { PAUSA_OTRO_CICLO_SEGUNDOS, MAX_CICLOS_POR_CARGA } = await import('./sincronizarSonoff.js');
    expect(PAUSA_OTRO_CICLO_SEGUNDOS).toBe(10);
    expect(MAX_CICLOS_POR_CARGA).toBe(2);
  });
});
