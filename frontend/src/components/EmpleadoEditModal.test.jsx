import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

// Se mockean el cliente api y el contexto de autenticación.
vi.mock('../lib/api', () => ({ api: { patch: vi.fn() } }));
vi.mock('../context/AuthContext', () => ({ useAuth: vi.fn() }));

import { api } from '../lib/api';
import { useAuth } from '../context/AuthContext';
import EmpleadoEditModal from './EmpleadoEditModal';

const sucursales = [{ slug: 'centro', nombre: 'Centro' }, { slug: 'norte', nombre: 'Norte' }];
const operador = { id: 7, nombre: 'Juan', apellido: 'Pérez', rol: 'operador', sucursal: 'centro' };

beforeEach(() => {
  api.patch.mockReset();
  // Por defecto, el editor es un admin distinto al empleado editado.
  useAuth.mockReturnValue({ usuario: { id: 1, rol: 'admin' } });
});

describe('EmpleadoEditModal', () => {
  it('precarga los datos del empleado y muestra el selector de sucursal para un operador', () => {
    render(<EmpleadoEditModal empleado={operador} sucursales={sucursales} onClose={() => {}} onSaved={() => {}} />);
    expect(screen.getByPlaceholderText('Nombre')).toHaveValue('Juan');
    expect(screen.getByPlaceholderText('Apellido')).toHaveValue('Pérez');
    // Hay 2 selects: rol y sucursal.
    expect(screen.getAllByRole('combobox')).toHaveLength(2);
  });

  it('al guardar sin cambiar el rol, el payload no incluye rol ni password', async () => {
    api.patch.mockResolvedValue({ id: 7, nombre: 'Juan' });
    const onSaved = vi.fn();
    render(<EmpleadoEditModal empleado={operador} sucursales={sucursales} onClose={() => {}} onSaved={onSaved} />);

    await userEvent.click(screen.getByRole('button', { name: 'Guardar cambios' }));

    expect(api.patch).toHaveBeenCalledWith('/usuarios/7', {
      nombre: 'Juan', apellido: 'Pérez', sucursal: 'centro',
    });
    await waitFor(() => expect(onSaved).toHaveBeenCalledWith({ id: 7, nombre: 'Juan' }));
  });

  it('cambiar el rol a admin oculta la sucursal y manda sucursal vacía + rol', async () => {
    api.patch.mockResolvedValue({});
    render(<EmpleadoEditModal empleado={operador} sucursales={sucursales} onClose={() => {}} onSaved={() => {}} />);

    // Cambiar el rol a admin (el primer combobox es el de rol).
    await userEvent.selectOptions(screen.getAllByRole('combobox')[0], 'admin');
    // Ahora solo queda el select de rol (la sucursal desaparece).
    expect(screen.getAllByRole('combobox')).toHaveLength(1);

    await userEvent.click(screen.getByRole('button', { name: 'Guardar cambios' }));
    expect(api.patch).toHaveBeenCalledWith('/usuarios/7', {
      nombre: 'Juan', apellido: 'Pérez', sucursal: '', rol: 'admin',
    });
  });

  it('muestra el error que devuelve el api', async () => {
    api.patch.mockRejectedValue(new Error('Ese nombre ya existe.'));
    render(<EmpleadoEditModal empleado={operador} sucursales={sucursales} onClose={() => {}} onSaved={() => {}} />);
    await userEvent.click(screen.getByRole('button', { name: 'Guardar cambios' }));
    expect(await screen.findByText('Ese nombre ya existe.')).toBeInTheDocument();
  });

  it('al editar tu propia cuenta, el rol queda bloqueado', () => {
    useAuth.mockReturnValue({ usuario: { id: 3, rol: 'admin' } });
    const propioAdmin = { id: 3, nombre: 'Yo', apellido: '', rol: 'admin', sucursal: '' };
    render(<EmpleadoEditModal empleado={propioAdmin} sucursales={sucursales} onClose={() => {}} onSaved={() => {}} />);
    // Como es admin, solo hay un combobox (rol) y está deshabilitado.
    expect(screen.getByRole('combobox')).toBeDisabled();
  });
});
