import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import Desplegable from './Desplegable';

// El desplegable que sustituyó al `<select>` nativo para que la lista de
// opciones se vea como el campo. Lo que importa: que siga haciendo todo lo que
// el nativo daba gratis —elegir con el ratón y con el teclado, cerrarse con
// Esc— y que el marcador de posición se quede en el campo, sin ocupar un
// renglón de la lista.
describe('Desplegable', () => {
  const OPCIONES = [
    { valor: 'lavadora', etiqueta: 'Lavadora' },
    { valor: 'secadora', etiqueta: 'Secadora' },
  ];
  const pintar = (props = {}) => {
    const onChange = vi.fn();
    render(
      <Desplegable
        valor="" onChange={onChange} opciones={OPCIONES}
        marcador="Elige lavadora o secadora" etiquetaAria="Máquina 1" {...props}
      />
    );
    return { onChange, campo: screen.getByRole('combobox', { name: 'Máquina 1' }) };
  };

  it('enseña el marcador de posición y no despliega nada hasta que se abre', () => {
    const { campo } = pintar();
    expect(campo).toHaveTextContent('Elige lavadora o secadora');
    expect(campo).toHaveAttribute('aria-expanded', 'false');
    expect(screen.queryByRole('listbox')).not.toBeInTheDocument();
  });

  it('abre la lista con lo elegible y nada más, y avisa qué está elegido', async () => {
    const u = userEvent.setup();
    const { campo } = pintar({ valor: 'lavadora' });
    await u.click(campo);
    expect(screen.getByRole('listbox')).toBeInTheDocument();
    // El marcador vive en el campo, no en la lista: solo se ofrece lo que de
    // verdad se puede elegir.
    expect(screen.getAllByRole('option').map(o => o.textContent.trim()))
      .toEqual(['Lavadora', 'Secadora']);
    expect(screen.getByRole('option', { name: 'Lavadora' })).toHaveAttribute('aria-selected', 'true');
  });

  it('elegir con el ratón devuelve el valor y cierra', async () => {
    const u = userEvent.setup();
    const { campo, onChange } = pintar();
    await u.click(campo);
    await u.click(screen.getByRole('option', { name: 'Secadora' }));
    expect(onChange).toHaveBeenCalledWith('secadora');
    expect(screen.queryByRole('listbox')).not.toBeInTheDocument();
  });

  it('se maneja con el teclado: flechas para moverse y Enter para elegir', async () => {
    const u = userEvent.setup();
    const { campo, onChange } = pintar();
    campo.focus();
    await u.keyboard('{ArrowDown}');   // abre, marcando la primera
    await u.keyboard('{ArrowDown}');   // Lavadora → Secadora
    await u.keyboard('{Enter}');
    expect(onChange).toHaveBeenCalledWith('secadora');
  });

  it('Esc cierra sin elegir y devuelve el foco al campo', async () => {
    const u = userEvent.setup();
    const { campo, onChange } = pintar();
    await u.click(campo);
    await u.keyboard('{Escape}');
    expect(screen.queryByRole('listbox')).not.toBeInTheDocument();
    expect(onChange).not.toHaveBeenCalled();
    expect(campo).toHaveFocus();
  });

  it('deshabilitado no abre nada', async () => {
    const u = userEvent.setup();
    const { campo } = pintar({ deshabilitado: true });
    await u.click(campo);
    expect(screen.queryByRole('listbox')).not.toBeInTheDocument();
  });
});
