import { describe, it, expect, vi } from 'vitest';

// Se captura lo que se mandaría a descargar en vez de bajar un archivo.
const capturados = vi.hoisted(() => []);
vi.mock('./exportUtils', async (original) => ({
  ...(await original()),
  descargarCSV: (nombre, encabezados, filas) => capturados.push({ nombre, encabezados, filas }),
}));

import { descargarVentasCSV } from './exportVentas';

const nota = (extra) => ({
  folio: '0066', fecha: '2026-10-19', creado_en: '2026-10-19T18:30:00Z',
  estado: 'FINALIZADA', estado_pago: 'PAGADO', tipo_servicio: 'AUTOSERVICIO',
  maquinas: [{ nombre: 'L1', cargas: 1 }], atendio: 'Ana', forma_pago: 'EFECTIVO',
  total_productos: 10, total: 60, ...extra,
});

describe('descargarVentasCSV', () => {
  it('cada nota lleva su servicio y si está pagada, pendiente o cancelada', () => {
    capturados.length = 0;
    descargarVentasCSV({ lista_notas: [
      nota(),
      nota({ folio: '0067', tipo_servicio: 'POR_ENCARGO', estado: 'LISTA', estado_pago: 'PENDIENTE', forma_pago: null }),
      nota({ folio: '0068', estado: 'CANCELADA', estado_pago: 'PENDIENTE' }),
    ] }, 'hoy');

    const [{ nombre, encabezados, filas }] = capturados;
    expect(nombre).toBe('ventas-hoy');
    const col = (fila, k) => fila[encabezados.indexOf(k)];
    expect(filas.map((f) => col(f, 'Servicio'))).toEqual(['Autoservicio', 'Por Encargo', 'Autoservicio']);
    expect(filas.map((f) => col(f, 'Pago'))).toEqual(['Pagada', 'Pendiente', 'Cancelada']);
    expect(col(filas[0], 'Total')).toBe('60.00');
    expect(filas.every((f) => f.length === encabezados.length)).toBe(true);
  });

  it('los abonos y los turnos salen en sus propios archivos solo si hay', () => {
    capturados.length = 0;
    descargarVentasCSV({ lista_notas: [nota()], abonos: [], turnos: [] }, 'hoy');
    expect(capturados.map((c) => c.nombre)).toEqual(['ventas-hoy']);
  });
});
