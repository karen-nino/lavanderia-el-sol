import { describe, it, expect } from 'vitest';
import { esTerminal, puedeLiquidar, puedeFinalizar, puedeEliminar, eliminarSoloEnEscritorio } from './accionesNota';

const nota = (estado, estado_pago) => ({ estado, estado_pago });

describe('acciones del detalle de una nota', () => {
  it('una Por Encargo recién creada ya ofrece liquidar', () => {
    // Es el caso que faltaba: el cliente paga al dejar la ropa, mucho antes de
    // que la nota llegue a LISTA.
    expect(puedeLiquidar(nota('EN_ESPERA', 'PENDIENTE'))).toBe(true);
  });

  it('liquidar sigue disponible mientras la ropa se lava o está lista', () => {
    expect(puedeLiquidar(nota('LAVANDO', 'PENDIENTE'))).toBe(true);
    expect(puedeLiquidar(nota('SECANDO', 'PENDIENTE'))).toBe(true);
    expect(puedeLiquidar(nota('LISTA', 'PENDIENTE'))).toBe(true);
  });

  it('un Autoservicio sin máquina asignada todavía no se cobra', () => {
    // La máquina se tarifa al asignarla en Salidas: antes de eso la nota vale
    // $0 y cobrarla dejaría el dinero fuera.
    const auto = (carga) => ({
      estado: 'EN_ESPERA', estado_pago: 'PENDIENTE',
      tipo_servicio: 'AUTOSERVICIO', cargas: [carga],
    });
    expect(puedeLiquidar(auto({ lavadora_tipo_previsto: 'mediana' }))).toBe(false);
    expect(puedeLiquidar(auto({ secadora_tipo_previsto: 'mediana' }))).toBe(false);
    expect(puedeLiquidar(auto({
      lavadora_tipo_previsto: 'mediana', lavadora_usada_id: 7,
    }))).toBe(true);
  });

  it('una nota ya cobrada no se vuelve a liquidar', () => {
    expect(puedeLiquidar(nota('LISTA', 'PAGADO'))).toBe(false);
  });

  it('una cancelada no se cobra; una finalizada que debe, sí', () => {
    // Cancelada el servidor lo rechaza. La finalizada que quedó debiendo —le
    // revirtieron el pago— tiene que poder cobrarse: si no, el detalle se queda
    // sin un solo botón y ese dinero no vuelve a la app.
    expect(puedeLiquidar(nota('CANCELADA', 'PENDIENTE'))).toBe(false);
    expect(puedeLiquidar(nota('FINALIZADA', 'PENDIENTE'))).toBe(true);
  });

  it('finalizar sigue exigiendo que esté lista Y cobrada', () => {
    expect(puedeFinalizar(nota('LISTA', 'PAGADO'))).toBe(true);
    expect(puedeFinalizar(nota('LISTA', 'PENDIENTE'))).toBe(false);
    expect(puedeFinalizar(nota('LAVANDO', 'PAGADO'))).toBe(false);
  });

  it('liquidar y finalizar nunca salen a la vez', () => {
    const casos = ['EN_ESPERA', 'LAVANDO', 'SECANDO', 'LISTA', 'FINALIZADA', 'CANCELADA'];
    for (const estado of casos) {
      for (const pago of ['PENDIENTE', 'PAGADO']) {
        const n = nota(estado, pago);
        expect(puedeLiquidar(n) && puedeFinalizar(n)).toBe(false);
      }
    }
  });

  it('el admin puede eliminar en cualquier estado', () => {
    // Borrar una nota abierta sigue siendo posible: cancelar una ya cobrada
    // exige revertir el pago antes, y eso son tres pasos para lo que a veces
    // es un error de captura.
    for (const estado of ['EN_ESPERA', 'LAVANDO', 'SECANDO', 'LISTA', 'CANCELADA', 'FINALIZADA']) {
      expect(puedeEliminar(nota(estado, 'PENDIENTE'), true)).toBe(true);
    }
  });

  // El cobro que ya entró en un corte cerrado no se toca por ninguna vía: el
  // servidor responde 409, así que el botón no debe ni aparecer.
  it('una nota con el cobro congelado en un corte cerrado no se elimina', () => {
    expect(puedeEliminar({ ...nota('FINALIZADA', 'PAGADO'), cobro_congelado: true }, true)).toBe(false);
    // Con su caja todavía abierta (o cobrada sin caja) sí se puede.
    expect(puedeEliminar({ ...nota('FINALIZADA', 'PAGADO'), cobro_congelado: false }, true)).toBe(true);
  });

  it('un empleado no elimina nunca', () => {
    expect(puedeEliminar(nota('CANCELADA', 'PENDIENTE'), false)).toBe(false);
    expect(puedeEliminar(nota('EN_ESPERA', 'PENDIENTE'), false)).toBe(false);
  });

  it('en el teléfono el botón se esconde mientras la nota siga viva', () => {
    for (const estado of ['EN_ESPERA', 'LAVANDO', 'SECANDO', 'LISTA']) {
      expect(eliminarSoloEnEscritorio(nota(estado, 'PENDIENTE'))).toBe(true);
    }
  });

  it('ya cerrada, el botón se ve también en el teléfono', () => {
    expect(eliminarSoloEnEscritorio(nota('CANCELADA', 'PENDIENTE'))).toBe(false);
    expect(eliminarSoloEnEscritorio(nota('FINALIZADA', 'PAGADO'))).toBe(false);
  });

  it('esTerminal reconoce las notas cerradas', () => {
    expect(esTerminal(nota('FINALIZADA', 'PAGADO'))).toBe(true);
    expect(esTerminal(nota('CANCELADA', 'PENDIENTE'))).toBe(true);
    expect(esTerminal(nota('LISTA', 'PAGADO'))).toBe(false);
  });
});
