import { describe, it, expect } from 'vitest';
import { hayQueActualizar, esObligatoria, compararVersiones, esRutaDeConsulta, esMomentoSeguro } from './actualizacion';

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

// Versión mínima: las apps anteriores quedan obligadas a actualizarse.
describe('esObligatoria', () => {
  it('obliga cuando la que corre es anterior a la mínima', () => {
    expect(esObligatoria('1.107.0', '1.106.9')).toBe(true);
    expect(esObligatoria('1.10.0', '1.9.5')).toBe(true);
  });

  it('no obliga con la mínima o una posterior', () => {
    expect(esObligatoria('1.107.0', '1.107.0')).toBe(false);
    expect(esObligatoria('1.107.0', '1.108.0')).toBe(false);
  });

  it('no obliga sin mínima publicada ni en dev', () => {
    expect(esObligatoria(null, '1.0.0')).toBe(false);
    expect(esObligatoria('', '1.0.0')).toBe(false);
    expect(esObligatoria('9.0.0', 'dev')).toBe(false);
  });
});

describe('compararVersiones', () => {
  it('compara número por número, no como texto', () => {
    expect(compararVersiones('1.10.0', '1.9.0')).toBeGreaterThan(0);
    expect(compararVersiones('1.2', '1.2.0')).toBe(0);
    expect(compararVersiones('1.2.3', '1.2.4')).toBeLessThan(0);
  });
});

// Solo en pantallas de consulta se recarga sola al volver o sin tocarla.
describe('esRutaDeConsulta', () => {
  it('acepta las de consulta', () => {
    for (const r of ['/', '/notas', '/notas/12', '/notas/12/salidas', '/maquinas', '/inventario']) {
      expect(esRutaDeConsulta(r)).toBe(true);
    }
  });

  it('rechaza las de captura', () => {
    for (const r of ['/notas/nueva', '/ajustes', '/ajustes/ticket', '/caja', '/notas/12/ticket']) {
      expect(esRutaDeConsulta(r)).toBe(false);
    }
  });
});

describe('esMomentoSeguro', () => {
  it('no con un modal abierto', () => {
    document.body.innerHTML = '<div class="fixed inset-0"></div>';
    expect(esMomentoSeguro()).toBe(false);
  });

  it('no escribiendo en un campo', () => {
    document.body.innerHTML = '<input id="c" />';
    document.getElementById('c').focus();
    expect(esMomentoSeguro()).toBe(false);
  });

  it('sí sin modal ni campo activo', () => {
    document.body.innerHTML = '<p>hola</p>';
    expect(esMomentoSeguro()).toBe(true);
  });
});
