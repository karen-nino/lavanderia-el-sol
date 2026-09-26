import { describe, it, expect } from 'vitest';
import { armarMensajeWhatsapp, hayMensajeWhatsapp, telefonoWhatsapp } from './mensajeWhatsapp';

// La plantilla de WhatsApp de Por Encargo (mig. 124). Lo que importa: que los
// comodines se sustituyan, que un comodín inventado NO se borre —sería un
// hueco silencioso en el mensaje que le llega al cliente— y que los asteriscos
// de negritas de WhatsApp sigan funcionando.
describe('armarMensajeWhatsapp', () => {
  const nota = {
    cliente_nombre: 'Ana López',
    // 26/09/2026 14:30 hora local.
    created_at: new Date(2026, 8, 26, 14, 30).toISOString(),
    id: 1796,
    folio: '1796-260926',
  };

  it('sustituye *Nombre* y *Tiempo*', () => {
    expect(armarMensajeWhatsapp('Hola *Nombre*, tu ropa de las *Tiempo* ya está.', nota))
      .toBe('Hola Ana, tu ropa de las 02:30 pm ya está.');
  });

  // En un WhatsApp se saluda por el nombre de pila: "Hola Ana", no "Hola Ana
  // López" (2026-09-26).
  it('*Nombre* es solo el nombre de pila, sin apellidos', () => {
    expect(armarMensajeWhatsapp('*Nombre*', { cliente_nombre: 'María José García López' }))
      .toBe('María');
    expect(armarMensajeWhatsapp('*Nombre*', { cliente_nombre: '  Ana   López  ' }))
      .toBe('Ana');
  });

  // La clave con la que el cliente recoge: el folio sin la fecha.
  it('*Clave* es el número de la nota, sin lo que va tras el guion', () => {
    expect(armarMensajeWhatsapp('Tu clave es *Clave*.', nota)).toBe('Tu clave es 1796.');
  });

  it('*Clave* se cae al id cuando la nota todavía no tiene folio', () => {
    expect(armarMensajeWhatsapp('*Clave*', { id: 42 })).toBe('42');
    expect(armarMensajeWhatsapp('*Clave*', {})).toBe('');
  });

  it('no distingue mayúsculas ni acentos en el nombre del comodín', () => {
    expect(armarMensajeWhatsapp('*nombre* / *NOMBRE* / *Nombre*', nota))
      .toBe('Ana / Ana / Ana');
  });

  it('deja intacto un comodín que no existe, para que el error se vea', () => {
    expect(armarMensajeWhatsapp('Hola *Nombre*, pasa a *Direccion*.', nota))
      .toBe('Hola Ana, pasa a *Direccion*.');
  });

  it('respeta las negritas de WhatsApp: *ya está* no es un comodín', () => {
    expect(armarMensajeWhatsapp('*Nombre*, tu ropa *ya está lista*', nota))
      .toBe('Ana, tu ropa *ya está lista*');
  });

  it('un comodín conocido sin dato se va en blanco, no con sus asteriscos', () => {
    expect(armarMensajeWhatsapp('Hola *Nombre*.', { created_at: nota.created_at }))
      .toBe('Hola .');
  });

  it('sin plantilla devuelve cadena vacía', () => {
    expect(armarMensajeWhatsapp('', nota)).toBe('');
    expect(armarMensajeWhatsapp(null, nota)).toBe('');
  });

  it('no cruza renglones: un asterisco suelto no se come el mensaje', () => {
    expect(armarMensajeWhatsapp('Son las 3*\nHola *Nombre*', nota))
      .toBe('Son las 3*\nHola Ana');
  });
});

describe('hayMensajeWhatsapp', () => {
  it('solo espacios cuenta como vacío', () => {
    expect(hayMensajeWhatsapp('   \n ')).toBe(false);
    expect(hayMensajeWhatsapp('Hola')).toBe(true);
    expect(hayMensajeWhatsapp(null)).toBe(false);
  });
});

describe('telefonoWhatsapp', () => {
  it('pone la lada de México a un celular de 10 dígitos y limpia el formato', () => {
    expect(telefonoWhatsapp('33-1323-6789')).toBe('523313236789');
  });

  it('no la duplica si ya viene con 52', () => {
    expect(telefonoWhatsapp('523313236789')).toBe('523313236789');
  });

  it('sin teléfono devuelve cadena vacía', () => {
    expect(telefonoWhatsapp('')).toBe('');
    expect(telefonoWhatsapp(null)).toBe('');
  });
});
