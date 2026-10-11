import { describe, it, expect } from 'vitest';
import { desgloseCaja } from './desgloseCaja';

const turno = {
  monto_inicial: 200, entradas: 100, salidas: 45,
  ventas_desglose: { efectivo: 210, transferencia: 70 },
  ingresos: { lavadoras_medianas: 70, lavadoras_jumbo: 90, secadoras: 50, productos: 0, por_encargo: 0, edredon: 0 },
  spe_debe: 40,
};

describe('desgloseCaja', () => {
  it('Ingresos − Egresos da el esperado; la transferencia y el SPE Debe no cuentan', () => {
    const d = desgloseCaja(turno);
    expect(d.totalIngresos).toBe(510);   // 200 + 210 + 100
    expect(d.totalEgresos).toBe(45);     // solo los gastos
    expect(d.esperado).toBe(465);
    expect(d.desglose.map((l) => l.label)).toEqual(['Ingresos', 'Egresos']);
  });

  it('lleva las líneas en el orden pedido', () => {
    expect(desgloseCaja(turno).ingresos.map((l) => l.label)).toEqual([
      'Caja inicial', 'Entradas', 'Lavadoras Medianas', 'Lavadoras Jumbo', 'Secadoras',
      'SPE', 'Edredón', 'Productos', 'Ventas en efectivo', 'Ventas por transferencia',
    ]);
    expect(desgloseCaja(turno).egresos.map((l) => l.label)).toEqual(['SPE Debe', 'Gastos']);
  });

  it('sin reparto ni SPE Debe (corte viejo) omite esas líneas', () => {
    const d = desgloseCaja({ ...turno, ingresos: null, spe_debe: null });
    expect(d.ingresos.map((l) => l.label)).not.toContain('Lavadoras Medianas');
    expect(d.egresos.map((l) => l.label)).toEqual(['Gastos']);
    expect(d.esperado).toBe(465);
  });
});
