import { describe, it, expect } from 'vitest';
import { notaAlPieDeTicket } from './ticketNotaPie.js';

const NOTAS = { autoservicio: 'Aviso de autoservicio', encargo: 'Aviso de encargo' };

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
