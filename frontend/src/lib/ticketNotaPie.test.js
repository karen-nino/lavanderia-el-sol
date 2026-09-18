import { describe, it, expect } from 'vitest';
import { notaAlPieDeTicket } from './ticketNotaPie.js';

const NOTAS = {
  autoservicio: 'Aviso de autoservicio',
  encargo:      'Aviso de encargo',
  productos:    'Aviso de productos',
};

describe('notaAlPieDeTicket', () => {
  it('autoservicio lleva la suya', () => {
    expect(notaAlPieDeTicket('AUTOSERVICIO', NOTAS)).toBe('Aviso de autoservicio');
  });

  it('por encargo lleva la del encargo', () => {
    expect(notaAlPieDeTicket('POR_ENCARGO', NOTAS)).toBe('Aviso de encargo');
  });

  // La regla que se rompe sin que nadie se entere: el ticket saldría con el
  // texto equivocado, sin fallar.
  it('EDREDÓN lleva la del ENCARGO, no la de autoservicio', () => {
    expect(notaAlPieDeTicket('EDREDON', NOTAS)).toBe('Aviso de encargo');
  });

  // La venta de mostrador tiene la suya (mig. 113): la de autoservicio habla de
  // lavadora y secadora, que es justo lo que esa nota no lleva.
  it('PRODUCTOS lleva la suya, no la de autoservicio', () => {
    expect(notaAlPieDeTicket('PRODUCTOS', NOTAS)).toBe('Aviso de productos');
  });

  // Sin fallback: si nadie la capturó, ese ticket sale sin nota en vez de
  // heredar un texto que no le queda.
  it('PRODUCTOS sin nota capturada sale vacío, no cae en la de autoservicio', () => {
    expect(notaAlPieDeTicket('PRODUCTOS', { autoservicio: 'Aviso de autoservicio' })).toBe('');
  });

  it('un tipo de servicio nuevo hereda la del encargo', () => {
    expect(notaAlPieDeTicket('LO_QUE_SEA', NOTAS)).toBe('Aviso de encargo');
  });

  it('sin notas capturadas devuelve vacío, para que el ticket no pinte el bloque', () => {
    expect(notaAlPieDeTicket('AUTOSERVICIO', {})).toBe('');
    expect(notaAlPieDeTicket('POR_ENCARGO', undefined)).toBe('');
  });

  // La nota aún no ha cargado: el ticket se pinta sin pie en vez de reventar.
  it('sin tipo de servicio todavía, no truena', () => {
    expect(notaAlPieDeTicket(undefined, NOTAS)).toBe('Aviso de encargo');
  });
});
