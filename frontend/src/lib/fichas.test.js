import { describe, it, expect } from 'vitest';
import { gruposDeFichas, disponiblesDeMaquina } from './fichas';

const resumen = {
  disponibles: 0,
  tipos: [{ id: 1, nombre: 'Secadora Blanca', disponibles: 4, dentro: 2 }],
  maquinas: [{ id: 71, ficha_tipo_id: 1, fichas_dentro: 2 }, { id: 72, ficha_tipo_id: null, fichas_dentro: 1 }],
};

describe('gruposDeFichas', () => {
  it('un grupo por tipo y "Sin tipo" si hay máquinas sin tipo', () => {
    const grupos = gruposDeFichas(resumen);
    expect(grupos.map(g => [g.nombre, g.disponibles, g.dentro, g.maquinas.length])).toEqual([
      ['Secadora Blanca', 4, 2, 1], ['Sin tipo', 0, 1, 1],
    ]);
  });

  it('sin máquinas sin tipo ni fichas generales, no sale "Sin tipo"', () => {
    const grupos = gruposDeFichas({ ...resumen, maquinas: [resumen.maquinas[0]] });
    expect(grupos.map(g => g.nombre)).toEqual(['Secadora Blanca']);
  });

  it('sin tipos, un solo grupo "Disponibles"', () => {
    const grupos = gruposDeFichas({ disponibles: 9, tipos: [], maquinas: [] });
    expect(grupos.map(g => [g.nombre, g.disponibles])).toEqual([['Disponibles', 9]]);
  });
});

describe('disponiblesDeMaquina', () => {
  it('las de su tipo, o las generales si no tiene', () => {
    expect(disponiblesDeMaquina(resumen, 71)).toBe(4);
    expect(disponiblesDeMaquina({ ...resumen, disponibles: 7 }, '72')).toBe(7);
    expect(disponiblesDeMaquina({ ...resumen, disponibles: 7 }, 999)).toBe(7);
  });
});
