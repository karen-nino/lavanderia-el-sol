import { describe, it, expect } from 'vitest';
import { estadoVisual, contarPorEstado, filtrarPorEstado, marcaYTamano } from './estadoMaquina';

// El chip "Reservada" de Gestión de Máquinas. No sale de `maquinas.estado`
// —ahí no existe ese valor— sino de la marca `reservada` que calcula el
// backend para una máquina libre que otra nota abierta ya tiene asignada.
describe('estado visible de una máquina', () => {
  const ESTADOS = ['disponible', 'reservada', 'en_uso', 'mantenimiento'];
  const maquinas = [
    { id: 1, estado: 'disponible' },
    { id: 2, estado: 'disponible', reservada: true, reservada_folio: '0123' },
    { id: 3, estado: 'en_uso' },
    { id: 4, estado: 'mantenimiento' },
  ];

  it('una máquina libre pero apartada se muestra como Reservada', () => {
    expect(estadoVisual(maquinas[1])).toBe('reservada');
    expect(estadoVisual(maquinas[0])).toBe('disponible');
  });

  it('estar en uso manda sobre la marca: ya no está apartada, está corriendo', () => {
    // El backend solo marca `reservada` si la máquina sigue disponible, pero la
    // tarjeta no debe depender de eso para no pintar dos estados a la vez.
    expect(estadoVisual({ estado: 'en_uso', reservada: false })).toBe('en_uso');
  });

  it('el chip de Reservada cuenta las apartadas', () => {
    expect(contarPorEstado(maquinas, ESTADOS)).toEqual({
      disponible: 1, reservada: 1, en_uso: 1, mantenimiento: 1,
    });
  });

  it('filtrar por Reservada deja solo las apartadas', () => {
    expect(filtrarPorEstado(maquinas, 'reservada').map(m => m.id)).toEqual([2]);
    // Y no se cuela en Disponibles, que es el error fácil: su estado real lo es.
    expect(filtrarPorEstado(maquinas, 'disponible').map(m => m.id)).toEqual([1]);
  });

  it('"todos" no filtra nada', () => {
    expect(filtrarPorEstado(maquinas, 'todos')).toHaveLength(4);
  });
});

describe('marcaYTamano', () => {
  it('junta marca y tamaño con un punto medio', () => {
    expect(marcaYTamano({ marca: 'LG', tamano: 'mediana', tipo: 'lavadora_mediana' })).toBe('LG · Mediana');
    expect(marcaYTamano({ marca: 'Speed Queen', tamano: 'jumbo', tipo: 'secadora' })).toBe('Speed Queen · Jumbo');
  });
  it('sin columna tamano lo saca del tipo de lavadora', () => {
    expect(marcaYTamano({ marca: 'Samsung', tipo: 'lavadora_jumbo' })).toBe('Samsung · Jumbo');
  });
  it('omite lo que falta', () => {
    expect(marcaYTamano({ tipo: 'lavadora_mediana' })).toBe('Mediana');
    expect(marcaYTamano({ marca: 'LG', tipo: 'secadora' })).toBe('LG');
    expect(marcaYTamano({ tipo: 'secadora' })).toBeNull();
  });
});
