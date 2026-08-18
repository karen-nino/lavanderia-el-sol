import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

// Se mockea el cliente api para no pegar a la red.
vi.mock('../lib/api', () => ({ api: { delete: vi.fn() } }));
import { api } from '../lib/api';
import EmpleadoDeleteModal from './EmpleadoDeleteModal';

const empleado = { id: 7, nombre: 'Juan', apellido: 'Pérez' };

beforeEach(() => {
  api.delete.mockReset();
});

describe('EmpleadoDeleteModal', () => {
  it('muestra el nombre del empleado a eliminar', () => {
    render(<EmpleadoDeleteModal empleado={empleado} onClose={() => {}} onDeleted={() => {}} />);
    expect(screen.getByText('Juan Pérez')).toBeInTheDocument();
  });

  it('Cancelar cierra sin llamar al api', async () => {
    const onClose = vi.fn();
    render(<EmpleadoDeleteModal empleado={empleado} onClose={onClose} onDeleted={() => {}} />);
    await userEvent.click(screen.getByRole('button', { name: 'Cancelar' }));
    expect(onClose).toHaveBeenCalledTimes(1);
    expect(api.delete).not.toHaveBeenCalled();
  });

  it('Eliminar llama al api y avisa con el id eliminado', async () => {
    api.delete.mockResolvedValue({});
    const onDeleted = vi.fn();
    render(<EmpleadoDeleteModal empleado={empleado} onClose={() => {}} onDeleted={onDeleted} />);

    await userEvent.click(screen.getByRole('button', { name: 'Eliminar' }));

    expect(api.delete).toHaveBeenCalledWith('/usuarios/7');
    await waitFor(() => expect(onDeleted).toHaveBeenCalledWith(7));
  });

  it('si el api falla, muestra el mensaje de error y no avisa onDeleted', async () => {
    api.delete.mockRejectedValue(new Error('No se puede eliminar un empleado con notas activas.'));
    const onDeleted = vi.fn();
    render(<EmpleadoDeleteModal empleado={empleado} onClose={() => {}} onDeleted={onDeleted} />);

    await userEvent.click(screen.getByRole('button', { name: 'Eliminar' }));

    expect(await screen.findByText(/notas activas/i)).toBeInTheDocument();
    expect(onDeleted).not.toHaveBeenCalled();
  });
});
