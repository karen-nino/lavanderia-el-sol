import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import ConfirmacionModal from './ConfirmacionModal';

// La advertencia que sustituyó al `confirm()` del navegador en Gestión de
// Máquinas. Lo que importa: que diga la consecuencia, que cancelar no haga
// nada, y que mientras la acción corre no se pueda pulsar dos veces.
describe('ConfirmacionModal', () => {
  const base = {
    titulo: 'Eliminar L1',
    mensaje: 'La máquina desaparece del sistema y esto no se puede deshacer.',
    textoConfirmar: 'Eliminar',
  };

  it('muestra el título, la consecuencia y los puntos', () => {
    render(
      <ConfirmacionModal
        {...base}
        puntos={['Las notas dejan de decir en qué máquina se lavó.', 'Ahora mismo está en uso.']}
        onClose={() => {}}
        onConfirm={() => {}}
      />
    );

    expect(screen.getByText('Eliminar L1')).toBeInTheDocument();
    expect(screen.getByText(/no se puede deshacer/)).toBeInTheDocument();
    expect(screen.getByText(/Las notas dejan de decir/)).toBeInTheDocument();
    expect(screen.getByText(/Ahora mismo está en uso/)).toBeInTheDocument();
  });

  it('los puntos vacíos no dejan viñetas sueltas', () => {
    // Los avisos se arman con condicionales (`estado === "en_uso" && "…"`), así
    // que al modal le llegan `false` y `undefined` con toda normalidad.
    render(
      <ConfirmacionModal {...base} puntos={[false, undefined, 'El único que aplica.']}
        onClose={() => {}} onConfirm={() => {}} />
    );

    expect(screen.getAllByRole('listitem')).toHaveLength(1);
  });

  it('enseña las filas de importe cuando la decisión es de dinero', () => {
    render(
      <ConfirmacionModal
        titulo="Quitar la Carga 2"
        mensaje="La carga sale de la nota y deja de cobrarse."
        detalle={[
          { etiqueta: 'Deja de cobrarse', valor: '$50.00' },
          { etiqueta: 'Nuevo total de la nota', valor: '$120.00' },
        ]}
        textoConfirmar="Quitar carga"
        onClose={() => {}}
        onConfirm={() => {}}
      />
    );

    expect(screen.getByText('Deja de cobrarse')).toBeInTheDocument();
    expect(screen.getByText('$50.00')).toBeInTheDocument();
    expect(screen.getByText('$120.00')).toBeInTheDocument();
  });

  it('cancelar cierra sin ejecutar la acción', async () => {
    const onClose = vi.fn();
    const onConfirm = vi.fn();
    render(<ConfirmacionModal {...base} onClose={onClose} onConfirm={onConfirm} />);

    await userEvent.click(screen.getByRole('button', { name: 'Cancelar' }));

    expect(onClose).toHaveBeenCalled();
    expect(onConfirm).not.toHaveBeenCalled();
  });

  it('confirmar ejecuta la acción', async () => {
    const onConfirm = vi.fn();
    render(<ConfirmacionModal {...base} onClose={() => {}} onConfirm={onConfirm} />);

    await userEvent.click(screen.getByRole('button', { name: 'Eliminar' }));

    expect(onConfirm).toHaveBeenCalled();
  });

  it('mientras procesa no se puede volver a pulsar ni cancelar a medias', async () => {
    const onConfirm = vi.fn();
    const onClose = vi.fn();
    render(
      <ConfirmacionModal {...base} textoConfirmar="Eliminando…" procesando
        onClose={onClose} onConfirm={onConfirm} />
    );

    const boton = screen.getByRole('button', { name: 'Eliminando…' });
    expect(boton).toBeDisabled();
    await userEvent.click(boton);
    expect(onConfirm).not.toHaveBeenCalled();
    expect(screen.getByRole('button', { name: 'Cancelar' })).toBeDisabled();
  });
});
