import { describe, it, expect } from 'vitest';
import { cargaVisibleEnTicket, maquinasDeCarga } from './ticketCargas';

// El ticket es lo que ve el cliente: solo lista las cargas que existieron y se
// cobran. Una carga que se quedó sin nada dentro antes salía como
// "CARGA 2 · $0.00".
const carga = (extra = {}) => ({
  id: 1, orden: 1, precio_lavadora: 0, precio_secadora: 0,
  ajuste: 0, productos: [], ...extra,
});

describe('cargaVisibleEnTicket', () => {
  it('oculta la carga sin máquina, sin productos y sin cobro', () => {
    expect(cargaVisibleEnTicket(carga())).toBe(false);
  });

  it('muestra la carga con su máquina asignada', () => {
    expect(cargaVisibleEnTicket(carga({
      lavadora_usada_id: 7, lavadora_usada_nombre: 'L1', precio_lavadora: 50,
    }))).toBe(true);
  });

  it('en Por Encargo muestra la carga que solo tiene el TIPO elegido (aún sin máquina física)', () => {
    expect(cargaVisibleEnTicket(carga({ lavadora_tipo_previsto: 'mediana', precio_lavadora: 50 }), 'POR_ENCARGO')).toBe(true);
  });

  it('en Por Encargo muestra el servicio por su precio, sin mirar la máquina', () => {
    expect(cargaVisibleEnTicket(carga({ tamano: 'chico', precio_tope: 150 }), 'POR_ENCARGO')).toBe(true);
  });

  // El mostrador agrega una secadora en Salidas y esa máquina abre su propio
  // renglón. No cobra nada: en Por Encargo lo que se cobra es el servicio, y
  // listarla imprimiría un "SERVICIO POR ENCARGO · $0.00" que nadie compró.
  it('en Por Encargo oculta la máquina agregada en Salidas, que no cobra nada', () => {
    expect(cargaVisibleEnTicket(carga({
      es_adicional: true, secadora_usada_id: 9, secadora_usada_tipo: 'secadora',
    }), 'POR_ENCARGO')).toBe(false);
  });

  it('en Autoservicio oculta la carga cuya máquina aún no se asigna en Salidas', () => {
    // Ahí la máquina se cobra al asignarla, así que la carga todavía vale $0:
    // el cliente no debe ver una máquina que no se usó.
    expect(cargaVisibleEnTicket(carga({ lavadora_tipo_previsto: 'mediana' }), 'AUTOSERVICIO')).toBe(false);
  });

  it('en Autoservicio la muestra en cuanto la máquina está asignada', () => {
    expect(cargaVisibleEnTicket(carga({
      lavadora_usada_id: 7, lavadora_usada_tipo: 'lavadora_mediana', precio_lavadora: 50,
    }), 'AUTOSERVICIO')).toBe(true);
  });

  it('muestra la carga sin máquina pero con productos', () => {
    expect(cargaVisibleEnTicket(carga({
      productos: [{ id: 1, nombre: 'Suavizante', unidad: 'botella', subtotal: 28 }],
    }))).toBe(true);
  });

  it('las tapas no cuentan: son información interna, no van en el ticket', () => {
    expect(cargaVisibleEnTicket(carga({
      productos: [{ id: 1, nombre: 'Jabón', unidad: 'tapa', subtotal: 0 }],
    }))).toBe(false);
  });

  it('en Por Encargo se muestra si cobra su tope, aunque no tenga máquina', () => {
    expect(cargaVisibleEnTicket(carga({ precio_tope: 150 }))).toBe(true);
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

  it('en Autoservicio no anuncia la máquina que aún no se asigna', () => {
    expect(maquinasDeCarga(carga({ lavadora_tipo_previsto: 'mediana' }), 'AUTOSERVICIO')).toEqual([]);
    expect(maquinasDeCarga(carga({ secadora_tipo_previsto: 'mediana' }), 'AUTOSERVICIO')).toEqual([]);
  });

  it('la secadora va sin calificativo: es de un solo tamaño', () => {
    expect(maquinasDeCarga(carga({
      secadora_usada_id: 9, secadora_usada_nombre: 'S1', precio_secadora: 45,
    }))).toEqual([{ nombre: 'Secadora', tipo: '', precio: 45 }]);
  });
});
