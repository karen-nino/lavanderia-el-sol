import { describe, it, expect } from 'vitest';
import { cargaVisibleEnTicket, maquinasDeCarga } from './ticketCargas';

// El ticket es lo que ve el cliente: solo lista las cargas que existieron y se
// cobran. Una carga a la que se le quitó la máquina se queda sin nada (en
// Salidas aparece tachada) y antes salía como "CARGA 2 · $0.00".
const carga = (extra = {}) => ({
  id: 1, orden: 1, precio_lavadora: 0, precio_secadora: 0,
  ajuste: 0, productos: [], ...extra,
});

describe('cargaVisibleEnTicket', () => {
  it('oculta la carga sin máquina, sin productos y sin cobro', () => {
    expect(cargaVisibleEnTicket(carga({ lavadora_usada_id: 7, lavadora_removida: true }))).toBe(false);
  });

  it('muestra la carga con su máquina asignada', () => {
    expect(cargaVisibleEnTicket(carga({
      lavadora_usada_id: 7, lavadora_usada_nombre: 'L1', precio_lavadora: 50,
    }))).toBe(true);
  });

  it('muestra la carga que solo tiene el TIPO elegido (aún sin máquina física)', () => {
    expect(cargaVisibleEnTicket(carga({ lavadora_tipo_previsto: 'mediana', precio_lavadora: 50 }))).toBe(true);
  });

  it('muestra la carga sin máquina pero con productos', () => {
    expect(cargaVisibleEnTicket(carga({
      lavadora_usada_id: 7, lavadora_removida: true,
      productos: [{ id: 1, nombre: 'Suavizante', unidad: 'botella', subtotal: 28 }],
    }))).toBe(true);
  });

  it('las tapas no cuentan: son información interna, no van en el ticket', () => {
    expect(cargaVisibleEnTicket(carga({
      lavadora_usada_id: 7, lavadora_removida: true,
      productos: [{ id: 1, nombre: 'Jabón', unidad: 'tapa', subtotal: 0 }],
    }))).toBe(false);
  });

  it('en Por Encargo se muestra si cobra su tope, aunque le quiten la máquina', () => {
    expect(cargaVisibleEnTicket(carga({
      lavadora_usada_id: 7, lavadora_removida: true, precio_tope: 150,
    }))).toBe(true);
  });
});

describe('maquinasDeCarga', () => {
  it('nombra el tipo de máquina, no la física, cuando ya se asignó', () => {
    const m = maquinasDeCarga(carga({
      lavadora_usada_id: 7, lavadora_usada_nombre: 'L1', lavadora_usada_tipo: 'lavadora_mediana',
      precio_lavadora: 50,
    }));
    expect(m).toEqual([{ nombre: 'Lavadora', tipo: 'Mediana', precio: 50 }]);
  });

  it('usa el tipo elegido mientras no haya máquina física', () => {
    const m = maquinasDeCarga(carga({ lavadora_tipo_previsto: 'jumbo', precio_lavadora: 70 }));
    expect(m).toEqual([{ nombre: 'Lavadora', tipo: 'Jumbo', precio: 70 }]);
  });

  it('deja fuera las máquinas quitadas de la nota', () => {
    expect(maquinasDeCarga(carga({
      lavadora_usada_id: 7, lavadora_usada_nombre: 'L1', lavadora_removida: true,
      secadora_usada_id: 9, secadora_usada_nombre: 'S1', precio_secadora: 45,
    }))).toEqual([{ nombre: 'Secadora', tipo: '', precio: 45 }]);
  });
});
