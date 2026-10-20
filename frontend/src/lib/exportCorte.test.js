import { describe, it, expect } from 'vitest';
import { hojasCortes } from './exportCorte';

const corte = (movimientos, extra = {}) => ({
  abierta_at: '2026-10-04T15:00:00Z', cerrada_at: '2026-10-04T23:00:00Z',
  usuario_apertura: 'Ana', usuario_cierre: 'Ana', monto_inicial: 500, ventas: 0,
  ventas_desglose: { total: 0, efectivo: 0, transferencia: 0, tarjeta: 0 },
  entradas: 100, salidas: 300, esperado: 300, contado: 300, diferencia: 0,
  notas_apertura: '', notas_cierre: '', movimientos, ...extra,
});

// Encabezados de la hoja y una función para leer una columna de una fila.
const leer = (hoja) => {
  const enc = hoja.grupos.flatMap((g) => g.columnas.map((c) => c.titulo));
  return { enc, col: (fila, k) => fila[enc.indexOf(k)] };
};

describe('hojasCortes', () => {
  it('agrupa las columnas en el orden en que se lee un corte', () => {
    const [hoja] = hojasCortes([corte([])]);
    expect(hoja.grupos.map((g) => g.titulo)).toEqual(
      ['Quién y cuándo', 'Resultado', 'Lo vendido', 'Cómo se cobró', 'El cajón', 'Notas']);
    const { enc } = leer(hoja);
    expect(enc.slice(0, 11)).toEqual(['Fecha', 'Apertura', 'Cierre', 'Abrió', 'Cerró',
      'Esperado', 'Contado', 'Diferencia', 'Estado', 'Caja final', 'Sobre']);
    expect(hoja.filas[0]).toHaveLength(enc.length);
  });

  it('las entradas y gastos van en su propia hoja, con los gastos en negativo', () => {
    const hojas = hojasCortes([corte([
      { tipo: 'entrada', concepto: 'Cambio', monto: 100, usuario: 'Ana', created_at: '2026-10-04T16:00:00Z' },
      { tipo: 'salida', concepto: 'Sueldo', monto: 300, usuario: 'Beto', created_at: '2026-10-04T17:00:00Z' },
    ])]);
    expect(hojas.map((h) => h.nombre)).toEqual(['Cortes', 'Entradas y gastos']);
    const movs = hojas[1];
    expect(movs.filas.map((f) => f.slice(2))).toEqual([
      ['Entrada', 'Cambio', 'Ana', 100],
      ['Gasto', 'Sueldo', 'Beto', -300],
    ]);
    expect(movs.pie.map((f) => [f[0], f[5]])).toEqual([['Entradas', 100], ['Gastos', -300]]);
  });

  it('sin movimientos no agrega la segunda hoja', () => {
    expect(hojasCortes([corte([])])).toHaveLength(1);
  });

  it('el turno en curso sale con su fecha de apertura y sin cierre', () => {
    const [hoja] = hojasCortes([corte([], { en_curso: true, cerrada_at: null, contado: null, diferencia: null })]);
    const { col } = leer(hoja);
    const [fila] = hoja.filas;
    expect(col(fila, 'Fecha')).toBe('2026-10-04');
    expect(col(fila, 'Cierre')).toBe('en curso');
    expect(col(fila, 'Cerró')).toBe('En curso');
    expect(col(fila, 'Estado')).toBe('En curso');
  });

  it('exporta lo vendido por concepto, cómo se cobró y el total en efectivo', () => {
    const [hoja] = hojasCortes([corte([], {
      ventas: 280,
      ventas_desglose: { total: 280, efectivo: 210, transferencia: 70, tarjeta: 0 },
      ingresos: { lavadoras_medianas: 140, lavadoras_jumbo: 90, secadoras: 50, productos: 0, por_encargo: 0, edredon: 0 },
      spe_debe: 40, caja_final: 300, sobre: 200,
    })]);
    const { col } = leer(hoja);
    const [fila] = hoja.filas;
    expect(col(fila, 'Lav. Medianas')).toBe(140);
    expect(col(fila, 'Total vendido')).toBe(280);
    expect(col(fila, 'Efectivo')).toBe(210);
    expect(col(fila, 'Transferencia')).toBe(70);
    expect(col(fila, 'Total en efectivo')).toBe(810); // 500 inicial + 210 efectivo + 100 entradas
    expect(col(fila, 'SPE Debe')).toBe(40);
    expect(col(fila, 'Caja final')).toBe(300);
    expect(col(fila, 'Sobre')).toBe(200);
    expect(col(fila, 'Estado')).toBe('Cuadra');
  });

  it('un corte sin reparto ni SPE Debe (anterior a la mig. 153) deja esas celdas vacías', () => {
    const [hoja] = hojasCortes([corte([])]);
    const { col } = leer(hoja);
    expect(col(hoja.filas[0], 'Lav. Medianas')).toBeNull();
    expect(col(hoja.filas[0], 'SPE Debe')).toBeUndefined();
  });

  it('la columna Tarjeta solo sale si algún corte trae cobros con tarjeta', () => {
    expect(leer(hojasCortes([corte([])])[0]).enc).not.toContain('Tarjeta');
    const conTarjeta = corte([], { ventas_desglose: { efectivo: 0, transferencia: 0, tarjeta: 50 } });
    const [hoja] = hojasCortes([corte([]), conTarjeta]);
    const { col } = leer(hoja);
    expect(col(hoja.filas[1], 'Tarjeta')).toBe(50);
  });

  it('con varios cortes suma los importes en una fila de totales', () => {
    const [hoja] = hojasCortes([corte([]), corte([], { contado: 290, diferencia: -10 })]);
    const { col } = leer(hoja);
    const [tot] = hoja.pie;
    expect(tot[0]).toBe('Totales (2 cortes)');
    expect(col(tot, 'Contado')).toBe(590);
    expect(col(tot, 'Diferencia')).toBe(-10);
    expect(col(tot, 'Estado')).toBeNull();
  });
});
