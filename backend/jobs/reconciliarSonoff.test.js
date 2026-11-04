import { describe, it, expect, vi } from 'vitest';

vi.mock('../db/pool.js', () => ({ default: { query: vi.fn() } }));
vi.mock('../services/sincronizarSonoff.js', () => ({ sincronizarSonoff: vi.fn() }));
vi.mock('../services/dispositivos/index.js', () => ({}));

const { tocaBarrer } = await import('./reconciliarSonoff.js');

// Martes a las 23:00 de la Ciudad de México: cerrada, fuera del margen.
const noche = new Date('2026-11-03T23:00:00-06:00');
const horario_semana = Array.from({ length: 7 }, (_, dia) => (
  { dia, abierto: true, abre: '09:00', cierra: '19:00' }
));
const libre = { estado: 'disponible', encendida_manual_at: null, encendida_sin_iniciar_at: null, horario_semana };

describe('tocaBarrer', () => {
  it('de noche se salta las máquinas libres', () => {
    expect(tocaBarrer(libre, noche)).toBe(false);
  });

  it('de noche sigue revisando las encendidas', () => {
    expect(tocaBarrer({ ...libre, estado: 'en_uso' }, noche)).toBe(true);
    expect(tocaBarrer({ ...libre, encendida_manual_at: '2026-11-03T22:00:00Z' }, noche)).toBe(true);
    expect(tocaBarrer({ ...libre, encendida_sin_iniciar_at: '2026-11-03T22:00:00Z' }, noche)).toBe(true);
  });

  it('en horario revisa todas', () => {
    expect(tocaBarrer(libre, new Date('2026-11-03T12:00:00-06:00'))).toBe(true);
  });
});
