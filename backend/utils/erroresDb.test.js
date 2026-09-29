import { describe, it, expect } from 'vitest';
import { esErrorDeConexion } from './erroresDb.js';

// El caso real que tiró las peticiones el 2026-09-29: el pooler de Supabase
// soltó las conexiones y el pool repartió sockets muertos.
const errorPg = (code) => Object.assign(new Error('read ECONNRESET'), { code, errno: -104, syscall: 'read' });

describe('esErrorDeConexion', () => {
  it('reconoce el ECONNRESET del pooler', () => {
    expect(esErrorDeConexion(errorPg('ECONNRESET'))).toBe(true);
  });

  it('reconoce la base reiniciándose', () => {
    expect(esErrorDeConexion(errorPg('ECONNREFUSED'))).toBe(true);
    expect(esErrorDeConexion(errorPg('57P01'))).toBe(true);
    expect(esErrorDeConexion(errorPg('57P03'))).toBe(true);
  });

  // Cuando el socket muere entre consultas el error llega sin `code`.
  it('reconoce el error sin código, por su mensaje', () => {
    expect(esErrorDeConexion(new Error('Connection terminated unexpectedly'))).toBe(true);
  });

  // Lo que NO debe reintentarse: la consulta sí llegó a la base y falló por lo
  // que pedía. Repetirla volvería a fallar, o peor, duplicaría un alta.
  it('no confunde un fallo de la consulta con uno de conexión', () => {
    expect(esErrorDeConexion(errorPg('23505'))).toBe(false);          // clave duplicada
    expect(esErrorDeConexion(new Error('column x does not exist'))).toBe(false);
    expect(esErrorDeConexion(null)).toBe(false);
    expect(esErrorDeConexion(undefined)).toBe(false);
  });
});
