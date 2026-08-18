import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

vi.mock('../lib/api', () => ({ api: { get: vi.fn() } }));
vi.mock('../context/AuthContext', () => ({ useAuth: vi.fn() }));

import { api } from '../lib/api';
import { useAuth } from '../context/AuthContext';
import SucursalSelector from './SucursalSelector';

const sucursales = [
  { slug: 'centro', nombre: 'Centro' },
  { slug: 'norte', nombre: 'Norte' },
];

beforeEach(() => {
  api.get.mockReset();
  useAuth.mockReset();
});

describe('SucursalSelector', () => {
  it('no se muestra a un empleado (operador)', () => {
    useAuth.mockReturnValue({ usuario: { rol: 'operador', sucursal: 'centro' }, sucursalActiva: 'centro', setSucursalActiva: vi.fn() });
    const { container } = render(<SucursalSelector />);
    expect(container).toBeEmptyDOMElement();
  });

  it('a un admin le muestra la sucursal activa y permite cambiarla', async () => {
    api.get.mockResolvedValue(sucursales);
    const setSucursalActiva = vi.fn();
    useAuth.mockReturnValue({
      usuario: { rol: 'admin', sucursal: 'centro' },
      sucursalActiva: 'centro',
      setSucursalActiva,
    });

    render(<SucursalSelector />);

    // Muestra el nombre de la sucursal activa.
    expect(await screen.findByText('Centro')).toBeInTheDocument();

    // Abre el desplegable y elige otra sucursal.
    await userEvent.click(screen.getByText('Centro'));
    await userEvent.click(await screen.findByText('Norte'));

    expect(setSucursalActiva).toHaveBeenCalledWith('norte');
  });
});
