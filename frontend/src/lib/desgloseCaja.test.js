import { describe, it, expect } from 'vitest';
import { desgloseCaja } from './desgloseCaja';

// Todo en efectivo: un solo total, como siempre.
const turno = {
  monto_inicial: 200, entradas: 100, salidas: 45,
  ventas_desglose: { total: 210, efectivo: 210, transferencia: 0 },
  ingresos: { lavadoras_medianas: 70, lavadoras_jumbo: 90, secadoras: 50, productos: 0, por_encargo: 0, edredon: 0 },
  spe_debe: 40,
};

// Una lavadora mediana de 70 pagada por transferencia: el reparto la incluye.
const conTransferencia = {
  ...turno,
  ventas_desglose: { total: 280, efectivo: 210, transferencia: 70 },
  ingresos: { ...turno.ingresos, lavadoras_medianas: 140 },
};

// Suma de los renglones que llevan al total: sin subtotales ni títulos y, en
// dos bloques, solo los de "En el cajón".
const sumaRenglones = (lineas) => {
  const i = lineas.findIndex((l) => l.label === 'En el cajón');
  return lineas.slice(i + 1)
    .filter((l) => !l.subtotal && !l.titulo)
    .reduce((a, l) => a + l.value, 0);
};

describe('desgloseCaja', () => {
  it('los renglones de Ingresos suman su total (Cómo se cobró va aparte)', () => {
    const d = desgloseCaja(turno);
    expect(sumaRenglones(d.ingresos)).toBe(d.totalIngresos);
    expect(d.totalIngresosLabel).toBe('Total ingresos');
    expect(d.comoSeCobroDentro).toBe(false);
  });

  it('Ingresos − Egresos da el esperado; el SPE Debe no cuenta', () => {
    const d = desgloseCaja(turno);
    expect(d.totalIngresos).toBe(510);   // 200 + 210 + 100
    expect(d.totalEgresos).toBe(45);     // solo los gastos
    expect(d.esperado).toBe(465);
    expect(d.desglose.map((l) => l.label)).toEqual(['Ingresos', 'Egresos']);
  });

  it('lleva las líneas en el orden pedido', () => {
    expect(desgloseCaja(turno).ingresos.map((l) => l.label)).toEqual([
      'Caja inicial', 'Entradas', 'Lav. Medianas', 'Lav. Jumbo', 'Secadoras',
      'SPE', 'Edredón', 'Productos',
    ]);
    expect(desgloseCaja(conTransferencia).comoSeCobro.map((l) => [l.label, l.value])).toEqual([
      ['Efectivo', 210], ['Transferencia', 70],
    ]);
    expect(desgloseCaja(turno).egresos.map((l) => l.label)).toEqual(['SPE Debe', 'Gastos']);
  });

  it('con transferencia: lo vendido (sin caja inicial) y aparte lo del cajón', () => {
    const d = desgloseCaja(conTransferencia);
    expect(d.ingresos.map((l) => l.label)).toEqual([
      'Lav. Medianas', 'Lav. Jumbo', 'Secadoras', 'SPE', 'Edredón', 'Productos',
      'Total vendido',
      'Cómo se cobró', 'Efectivo', 'Transferencia',
      'En el cajón', 'Caja inicial', 'Entradas', 'Ventas en efectivo',
    ]);
    expect(d.ingresos.find((l) => l.subtotal).value).toBe(280);   // 140 + 90 + 50
    expect(d.comoSeCobroDentro).toBe(true);
    expect(d.totalIngresosLabel).toBe('Total en efectivo');
    expect(d.totalIngresos).toBe(510);   // 200 + 100 + 210
    expect(sumaRenglones(d.ingresos)).toBe(d.totalIngresos);
    expect(d.esperado).toBe(465);
  });

  it('un corte congelado con el reparto solo del efectivo se lee como entonces', () => {
    const d = desgloseCaja({
      ...turno, ingresos_solo_efectivo: true,
      ventas_desglose: { total: 280, efectivo: 210, transferencia: 70 },
    });
    expect(d.ingresos.map((l) => l.label)).not.toContain('Total vendido');
    expect(d.totalIngresosLabel).toBe('Total ingresos');
    expect(sumaRenglones(d.ingresos)).toBe(d.totalIngresos);
  });

  it('sin reparto ni SPE Debe (corte viejo) omite esas líneas', () => {
    const d = desgloseCaja({ ...conTransferencia, ingresos: null, spe_debe: null });
    expect(d.ingresos.map((l) => l.label)).not.toContain('Lav. Medianas');
    expect(d.ingresos.map((l) => l.label)).toContain('Ventas en efectivo');
    expect(d.ingresos.map((l) => l.label)).not.toContain('Total vendido');
    expect(sumaRenglones(d.ingresos)).toBe(d.totalIngresos);
    expect(d.egresos.map((l) => l.label)).toEqual(['Gastos']);
    expect(d.esperado).toBe(465);
  });

  it('con la caja inicial aparte (demo), Ingresos no la lleva y el Desglose la suma', () => {
    for (const t of [turno, conTransferencia]) {
      const d = desgloseCaja(t, { cajaAparte: true });
      expect(d.cajaInicial).toBe(200);
      expect(d.ingresos.some((l) => l.label === 'Caja inicial')).toBe(false);
      expect(sumaRenglones(d.ingresos)).toBe(d.totalIngresos);
      expect(d.totalIngresos).toBe(310);  // 210 + 100
      expect(d.totalEnCajon).toBe(510);
      expect(d.desglose.map((l) => l.label)).toEqual(['Caja inicial', 'Ingresos', 'Egresos']);
      expect(d.esperado).toBe(desgloseCaja(t, { cajaAparte: false }).esperado);
    }
  });
});
