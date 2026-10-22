import { describe, it, expect } from 'vitest';
import { bolsasIncluidas, cobroAparteEncargo } from './cobroProductos';

const nota = (extra = {}) => ({
  cargas: [{ bolsa_producto_id: 7, bolsas_incluidas: 1 }, { bolsa_producto_id: 7, bolsas_incluidas: 1 }],
  ...extra,
});
const bolsa = (cantidad) => ({ producto_id: 7, clase: 'bolsa', se_vende_por_unidad: false,
  cantidad, precio_unitario: 5, subtotal: cantidad * 5, carga_id: null });

describe('bolsas incluidas en Por Encargo', () => {
  it('cada servicio incluye las suyas', () => {
    expect(bolsasIncluidas(nota(), 7)).toBe(2);
    expect(cobroAparteEncargo(nota(), bolsa(2))).toBe(0);
  });

  it('las de más se cobran', () => {
    expect(cobroAparteEncargo(nota(), bolsa(3))).toBe(5);
  });

  it('una nota de antes las incluye todas', () => {
    expect(cobroAparteEncargo(nota({ bolsas_todas_incluidas: true }), bolsa(5))).toBe(0);
  });

  it('marca completa y granel nada', () => {
    expect(cobroAparteEncargo(nota(), { tipo_liquido: 'marca', subtotal: 30 })).toBe(30);
    expect(cobroAparteEncargo(nota(), { tipo_liquido: 'granel', subtotal: 12 })).toBe(0);
  });
});
