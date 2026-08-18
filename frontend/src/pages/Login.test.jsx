import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

// Mocks compartidos (hoisted para poder referenciarlos dentro de vi.mock).
const { navigate, login } = vi.hoisted(() => ({ navigate: vi.fn(), login: vi.fn() }));
vi.mock('react-router-dom', () => ({ useNavigate: () => navigate }));
vi.mock('../context/AuthContext', () => ({ useAuth: () => ({ login }) }));
vi.mock('../lib/api', () => ({ api: { get: vi.fn(), post: vi.fn() } }));

import { api } from '../lib/api';
import Login from './Login';

beforeEach(() => {
  api.get.mockReset();
  api.post.mockReset();
  navigate.mockReset();
  login.mockReset();
  sessionStorage.clear();
});

// Escribe el nombre, espera la sugerencia y la selecciona.
async function seleccionarUsuario(user) {
  api.get.mockResolvedValue([{ id: 7, nombre: 'Juan Pérez' }]);
  await user.type(screen.getByPlaceholderText('Escribe tu nombre...'), 'Ju');
  const sugerencia = await screen.findByRole('button', { name: 'Juan Pérez' });
  await user.click(sugerencia);
}

describe('Login', () => {
  it('busca usuarios al escribir y muestra las sugerencias', async () => {
    const user = userEvent.setup();
    api.get.mockResolvedValue([{ id: 7, nombre: 'Juan Pérez' }]);
    render(<Login />);

    await user.type(screen.getByPlaceholderText('Escribe tu nombre...'), 'Ju');

    expect(await screen.findByRole('button', { name: 'Juan Pérez' })).toBeInTheDocument();
    await waitFor(() =>
      expect(api.get).toHaveBeenCalledWith(expect.stringContaining('/auth/buscar-usuarios?q=Ju'))
    );
  });

  it('la contraseña está deshabilitada hasta elegir un usuario', async () => {
    const user = userEvent.setup();
    render(<Login />);
    expect(screen.getByPlaceholderText('••••••••')).toBeDisabled();

    await seleccionarUsuario(user);
    expect(screen.getByPlaceholderText('••••••••')).toBeEnabled();
    expect(screen.getByRole('button', { name: 'Cambiar' })).toBeInTheDocument();
  });

  it('inicia sesión: llama al api, guarda la sesión y navega al inicio', async () => {
    const user = userEvent.setup();
    render(<Login />);
    await seleccionarUsuario(user);

    api.post.mockResolvedValue({ token: 'tok123', usuario: { id: 7, rol: 'operador' } });
    await user.type(screen.getByPlaceholderText('••••••••'), 'secret123');
    await user.click(screen.getByRole('button', { name: 'Iniciar sesión' }));

    expect(api.post).toHaveBeenCalledWith(
      '/auth/login',
      { usuario_id: 7, password: 'secret123' },
      { skipAuthRedirect: true }
    );
    await waitFor(() => expect(login).toHaveBeenCalledWith('tok123', { id: 7, rol: 'operador' }));
    expect(navigate).toHaveBeenCalledWith('/');
  });

  it('muestra el error cuando el login falla y no navega', async () => {
    const user = userEvent.setup();
    render(<Login />);
    await seleccionarUsuario(user);

    api.post.mockRejectedValue(new Error('Contraseña incorrecta.'));
    await user.type(screen.getByPlaceholderText('••••••••'), 'mala');
    await user.click(screen.getByRole('button', { name: 'Iniciar sesión' }));

    expect(await screen.findByText('Contraseña incorrecta.')).toBeInTheDocument();
    expect(navigate).not.toHaveBeenCalled();
  });

  it('muestra el aviso de sesión cerrada guardado en sessionStorage', () => {
    sessionStorage.setItem('authAviso', 'Se inició sesión en otro dispositivo.');
    render(<Login />);
    expect(screen.getByText('Se inició sesión en otro dispositivo.')).toBeInTheDocument();
    // Se consume: no debe reaparecer.
    expect(sessionStorage.getItem('authAviso')).toBeNull();
  });
});
