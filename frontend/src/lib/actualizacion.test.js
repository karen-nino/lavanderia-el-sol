import { describe, it, expect } from 'vitest';
import { hayQueActualizar } from './actualizacion';

// La app instalada en un teléfono no se recarga sola: compara la versión que
// trae corriendo con la que el servidor publica en /version.json.
describe('hayQueActualizar', () => {
  it('avisa cuando la publicada es otra', () => {
    expect(hayQueActualizar('1.12.0', '1.11.0')).toBe(true);
  });

  it('no avisa cuando es la misma', () => {
    expect(hayQueActualizar('1.11.0', '1.11.0')).toBe(false);
  });

  // Un despliegue que revierte a la versión anterior también hay que recogerlo:
  // lo que importa es que sea OTRA, no que sea mayor.
  it('avisa también si el servidor volvió a una versión anterior', () => {
    expect(hayQueActualizar('1.10.0', '1.11.0')).toBe(true);
  });

  it('no avisa si no se pudo averiguar la publicada', () => {
    expect(hayQueActualizar(null, '1.11.0')).toBe(false);
    expect(hayQueActualizar('', '1.11.0')).toBe(false);
    expect(hayQueActualizar('   ', '1.11.0')).toBe(false);
    expect(hayQueActualizar(undefined, '1.11.0')).toBe(false);
  });

  // Sin versión inyectada en el bundle (desarrollo) no hay nada que comparar:
  // ofrecer "actualizar" ahí sería recargar en vano.
  it('no avisa cuando el bundle corre sin versión (dev)', () => {
    expect(hayQueActualizar('1.12.0', 'dev')).toBe(false);
  });
});
