import { describe, it, expect } from 'vitest';
import { hojasVentas } from './exportVentas';

const nota = (extra) => ({
  folio: '0066', fecha: '2026-10-19', creado_en: '2026-10-19T18:30:00Z',
  estado: 'FINALIZADA', estado_pago: 'PAGADO', tipo_servicio: 'AUTOSERVICIO',
  maquinas: [{ nombre: 'L1', cargas: 1 }], atendio: 'Ana', forma_pago: 'EFECTIVO',
  total_productos: 10, total: 60, ...extra,
});

const columna = (hoja, k) => hoja.grupos.flatMap((g) => g.columnas.map((c) => c.titulo)).indexOf(k);

describe('hojasVentas', () => {
  it('cada nota lleva su servicio y si está pagada, pendiente o cancelada; solo las pagadas suman', () => {
    const [hoja] = hojasVentas({ lista_notas: [
      nota(),
      nota({ folio: '0067', tipo_servicio: 'POR_ENCARGO', estado: 'LISTA', estado_pago: 'PENDIENTE', forma_pago: null }),
      nota({ folio: '0068', estado: 'CANCELADA', estado_pago: 'PENDIENTE' }),
    ] });
    expect(hoja.nombre).toBe('Notas');
    expect(hoja.filas.map((f) => f[columna(hoja, 'Servicio')])).toEqual(['Autoservicio', 'Por Encargo', 'Autoservicio']);
    expect(hoja.filas.map((f) => f[columna(hoja, 'Pago')])).toEqual(['Pagada', 'Pendiente', 'Cancelada']);
    expect([...hoja.atenuadas]).toEqual([1, 2]);
    const [tot] = hoja.pie;
    expect(tot[columna(hoja, 'Total')]).toBe(60);
    expect(tot[0]).toBe('Totales (1 pagadas)');
  });

  it('los abonos y los turnos van en sus propias hojas, solo si hay', () => {
    expect(hojasVentas({ lista_notas: [nota()], abonos: [], turnos: [] }).map((h) => h.nombre)).toEqual(['Notas']);
    const hojas = hojasVentas({
      lista_notas: [nota()],
      abonos: [{ folio: '0067', fecha: '2026-10-19', creado_en: '2026-10-19T19:00:00Z', monto: 30, forma_pago: 'EFECTIVO', recibio: 'Ana' }],
      turnos: [{ abierta_at: '2026-10-19T14:00:00Z', cerrada_at: '2026-10-20T03:00:00Z', monto_inicial: 500, ventas: 0,
        ventas_desglose: {}, entradas: 0, salidas: 0, esperado: 500, movimientos: [] }],
    });
    expect(hojas.map((h) => h.nombre)).toEqual(['Notas', 'Abonos', 'Turnos de caja']);
    expect(hojas[1].pie[0].at(-1)).toBe(30);
  });
});
