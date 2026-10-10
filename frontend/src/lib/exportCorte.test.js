import { describe, it, expect, vi } from 'vitest';

// Se captura lo que se mandaría a descargar en vez de bajar un archivo.
const capturado = vi.hoisted(() => ({}));
vi.mock('./exportUtils', async (original) => ({
  ...(await original()),
  descargarCSV: (nombre, encabezados, filas) => Object.assign(capturado, { nombre, encabezados, filas }),
}));

import { descargarCortesCSV } from './exportCorte';

const corte = (movimientos) => ({
  abierta_at: '2026-10-04T15:00:00Z', cerrada_at: '2026-10-04T23:00:00Z',
  usuario_apertura: 'Ana', usuario_cierre: 'Ana', monto_inicial: 500, ventas: 0,
  ventas_desglose: { efectivo: 0, transferencia: 0, tarjeta: 0 },
  entradas: 100, salidas: 300, esperado: 300, contado: 300, diferencia: 0,
  notas_apertura: '', notas_cierre: '', movimientos,
});

describe('descargarCortesCSV', () => {
  it('pone las entradas y salidas debajo de los cortes, una fila por movimiento', () => {
    descargarCortesCSV([corte([
      { tipo: 'entrada', concepto: 'Cambio', monto: 100, usuario: 'Ana', created_at: '2026-10-04T16:00:00Z' },
      { tipo: 'salida', concepto: 'Sueldo', monto: 300, usuario: 'Beto', created_at: '2026-10-04T17:00:00Z' },
    ])], 'hoy');

    const { filas } = capturado;
    expect(filas).toHaveLength(1 + 1 + 1 + 1 + 2); // corte, vacía, título, encabezados, 2 movimientos
    expect(filas[1]).toEqual([]);
    expect(filas[2]).toEqual(['Entradas y salidas']);
    expect(filas[3]).toEqual(['Corte', 'Fecha', 'Hora', 'Tipo', 'Concepto', 'Registró', 'Monto']);
    expect(filas[4].slice(3)).toEqual(['Entrada', 'Cambio', 'Ana', '100.00']);
    expect(filas[5].slice(3)).toEqual(['Salida', 'Sueldo', 'Beto', '-300.00']);
  });

  it('el turno en curso se exporta con su fecha de apertura y sin cierre', () => {
    descargarCortesCSV([{ ...corte([]), en_curso: true, cerrada_at: null, contado: null, diferencia: null }], 'hoy');
    const [fila] = capturado.filas;
    expect(fila[0]).toBe('2026-10-04');
    expect(fila[1]).toBe('en curso');
    expect(fila[3]).toBe('En curso');
    expect(fila[capturado.encabezados.indexOf('Estado')]).toBe('En curso');
  });

  it('exporta los ingresos por concepto, el SPE Debe y los totales (2026-10-10)', () => {
    descargarCortesCSV([{
      ...corte([]),
      ventas_desglose: { efectivo: 210, transferencia: 70, tarjeta: 0 },
      ingresos: { lavadoras_medianas: 70, lavadoras_jumbo: 90, secadoras: 50, productos: 0, por_encargo: 0, edredon: 0 },
      spe_debe: 40,
    }], 'hoy');
    const { encabezados, filas: [fila] } = capturado;
    const col = (k) => fila[encabezados.indexOf(k)];
    expect(col('Lavadoras Medianas')).toBe('70.00');
    expect(col('Lavadoras Jumbo')).toBe('90.00');
    expect(col('Secadoras')).toBe('50.00');
    expect(col('SPE Debe')).toBe('40.00');
    expect(col('Total ingresos')).toBe('810.00'); // 500 inicial + 210 efectivo + 100 entradas
    expect(col('Total egresos')).toBe('300.00');  // solo los gastos
  });

  it('un corte sin reparto ni SPE Debe (anterior a la mig. 153) deja esas columnas vacías', () => {
    descargarCortesCSV([corte([])], 'hoy');
    const { encabezados, filas: [fila] } = capturado;
    expect(fila[encabezados.indexOf('Lavadoras Medianas')]).toBe('');
    expect(fila[encabezados.indexOf('SPE Debe')]).toBe('');
  });

  it('exporta la caja final y el sobre del corte', () => {
    descargarCortesCSV([{ ...corte([]), caja_final: 300, sobre: 200 }], 'hoy');
    const { encabezados, filas: [fila] } = capturado;
    expect(fila[encabezados.indexOf('Caja final')]).toBe('300.00');
    expect(fila[encabezados.indexOf('Sobre')]).toBe('200.00');
  });

  it('la columna Tarjeta solo sale si algún corte trae cobros con tarjeta', () => {
    descargarCortesCSV([corte([])], 'hoy');
    expect(capturado.encabezados).not.toContain('Tarjeta');
    expect(capturado.filas[0]).toHaveLength(capturado.encabezados.length);

    const conTarjeta = { ...corte([]), ventas_desglose: { efectivo: 0, transferencia: 0, tarjeta: 50 } };
    descargarCortesCSV([corte([]), conTarjeta], 'hoy');
    const i = capturado.encabezados.indexOf('Tarjeta');
    expect(i).toBeGreaterThan(-1);
    expect(capturado.filas[1][i]).toBe('50.00');
  });

  it('sin movimientos no agrega la segunda tabla', () => {
    descargarCortesCSV([corte([])], 'hoy');
    expect(capturado.filas).toHaveLength(1);
  });
});
