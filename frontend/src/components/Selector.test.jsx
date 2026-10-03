import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import Selector from './Selector';

const opciones = [
  { valor: 'a', etiqueta: 'Jabón Ariel', detalle: 'quedan 5' },
  { valor: 'b', etiqueta: 'Jabón Roma', detalle: 'agotado', deshabilitado: true },
];

describe('Selector', () => {
  it('sin valor muestra el marcador; con valor, su etiqueta', () => {
    const { rerender } = render(<Selector valor="" onChange={() => {}} opciones={opciones} marcador="Elegir…" />);
    expect(screen.getByText('Elegir…')).toBeInTheDocument();
    rerender(<Selector valor="a" onChange={() => {}} opciones={opciones} marcador="Elegir…" />);
    expect(screen.getByText('Jabón Ariel')).toBeInTheDocument();
  });

  it('abre la ventana con las opciones en tarjetas y elegir la cierra', async () => {
    const onChange = vi.fn();
    render(<Selector valor="" onChange={onChange} opciones={opciones} titulo="Jabón" etiquetaAria="Jabón" />);
    await userEvent.click(screen.getByRole('button', { name: 'Jabón: Seleccionar…' }));
    expect(screen.getByRole('dialog', { name: 'Jabón' })).toBeInTheDocument();
    expect(screen.getByText('quedan 5')).toBeInTheDocument();

    await userEvent.click(screen.getByRole('option', { name: /Jabón Ariel/ }));
    expect(onChange).toHaveBeenCalledWith('a');
    expect(screen.queryByRole('dialog')).toBeNull();
  });

  it('una opción deshabilitada no se puede elegir', async () => {
    const onChange = vi.fn();
    render(<Selector valor="" onChange={onChange} opciones={opciones} />);
    await userEvent.click(screen.getByRole('button'));
    expect(screen.getByRole('option', { name: /Jabón Roma/ })).toBeDisabled();
  });

  it('Cancelar cierra sin elegir', async () => {
    const onChange = vi.fn();
    render(<Selector valor="a" onChange={onChange} opciones={opciones} />);
    await userEvent.click(screen.getByRole('button'));
    await userEvent.click(screen.getByRole('button', { name: 'Cancelar' }));
    expect(onChange).not.toHaveBeenCalled();
    expect(screen.queryByRole('dialog')).toBeNull();
  });

  it('deshabilitado no abre nada', () => {
    render(<Selector valor="a" onChange={() => {}} opciones={opciones} deshabilitado />);
    expect(screen.getByRole('button')).toBeDisabled();
  });

  it('acepta un botón propio en lugar del campo', async () => {
    const onChange = vi.fn();
    render(
      <Selector
        valor="" onChange={onChange} opciones={opciones}
        disparador={({ abrir, elegida }) => (
          <button type="button" onClick={abrir}>{elegida ? 'Cambiar' : 'Elegir'}</button>
        )}
      />
    );
    await userEvent.click(screen.getByRole('button', { name: 'Elegir' }));
    await userEvent.click(screen.getByRole('option', { name: /Jabón Ariel/ }));
    expect(onChange).toHaveBeenCalledWith('a');
  });
});
