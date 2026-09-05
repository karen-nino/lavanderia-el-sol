import { describe, it, expect } from 'vitest';
import { explicarMotivo, explicarFalla, resumirMotivo } from './mensajes.js';

describe('explicarMotivo', () => {
  it('distingue los problemas que se arreglan en la app', () => {
    expect(explicarMotivo('sin_cuenta_conectada')).toMatch(/cuenta de eWeLink no está conectada/i);
    expect(explicarMotivo('sesion_expirada')).toMatch(/permiso de eWeLink venció/i);
  });

  it('dice cuándo el problema es del servidor y no de la lavandería', () => {
    expect(explicarMotivo('ewelink_no_configurado')).toMatch(/credenciales de eWeLink en el servidor/i);
    expect(explicarMotivo('ewelink_no_configurado')).toMatch(/no se arregla desde la app/i);
  });

  it('manda a revisar la máquina cuando el Sonoff no contesta bien', () => {
    expect(explicarMotivo('estado_desconocido')).toMatch(/fuera de línea/i);
    expect(explicarMotivo('error_red')).toMatch(/internet/i);
    expect(explicarMotivo('sin_enlazar')).toMatch(/Device ID/i);
  });

  it('trata los códigos de autenticación de eWeLink como un permiso vencido', () => {
    expect(explicarMotivo('ewelink_402')).toMatch(/Conecta la cuenta otra vez/i);
    expect(explicarMotivo('ewelink_40101')).toMatch(/Conecta la cuenta otra vez/i);
  });

  it('deja a la vista el código que no sabe leer, sin inventarle significado', () => {
    const detalle = explicarMotivo('ewelink_40001');
    expect(detalle).toMatch(/código 40001/);
    expect(detalle).toMatch(/desconectado de la corriente o fuera de línea/i);
  });

  it('responde algo útil aunque no llegue motivo', () => {
    expect(explicarMotivo(undefined)).toMatch(/vuelve a intentar/i);
  });
});

describe('explicarFalla', () => {
  it('dice primero qué se intentaba hacer', () => {
    expect(explicarFalla('sin_cuenta_conectada', 'No se pudo encender L1'))
      .toMatch(/^No se pudo encender L1: la cuenta de eWeLink/);
  });
});

describe('resumirMotivo', () => {
  it('deja una sola frase, lista para la tarjeta', () => {
    const resumen = resumirMotivo('sin_cuenta_conectada');
    expect(resumen).toBe('La cuenta de eWeLink no está conectada, así que ningún Sonoff recibe órdenes.');
  });
});
