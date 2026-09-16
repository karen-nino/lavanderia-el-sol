import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

// Mocks compartidos (hoisted para poder referenciarlos dentro de vi.mock).
const { navigate, login } = vi.hoisted(() => ({ navigate: vi.fn(), login: vi.fn() }));
vi.mock('react-router-dom', () => ({ useNavigate: () => navigate }));
vi.mock('../context/AuthContext', () => ({ useAuth: () => ({ login }) }));
vi.mock('../lib/api', () => ({ api: { get: vi.fn(), post: vi.fn() } }));
// ES_DEMO se lee en cada render, así que el getter permite encender la demo
// dentro de un test. Por defecto apagado: el resto del archivo prueba el login
// normal.
const entorno = vi.hoisted(() => ({ ES_DEMO: false }));
vi.mock('../lib/entorno', () => ({ get ES_DEMO() { return entorno.ES_DEMO; } }));

import { api } from '../lib/api';
import Login from './Login';

beforeEach(() => {
  api.get.mockReset();
  api.post.mockReset();
  navigate.mockReset();
  login.mockReset();
  sessionStorage.clear();
  entorno.ES_DEMO = false;
});

// Escribe el nombre, espera la sugerencia y la selecciona.
async function seleccionarUsuario(user) {
  api.get.mockResolvedValue([{ id: 7, nombre: 'Juan Pérez' }]);
  await user.type(screen.getByPlaceholderText('Escribe tu nombre...'), 'Juan');
  const sugerencia = await screen.findByRole('button', { name: 'Juan Pérez' });
  await user.click(sugerencia);
}

describe('Login', () => {
  it('busca usuarios al escribir y muestra las sugerencias', async () => {
    const user = userEvent.setup();
    api.get.mockResolvedValue([{ id: 7, nombre: 'Juan Pérez' }]);
    render(<Login />);

    await user.type(screen.getByPlaceholderText('Escribe tu nombre...'), 'Juan');

    expect(await screen.findByRole('button', { name: 'Juan Pérez' })).toBeInTheDocument();
    await waitFor(() =>
      expect(api.get).toHaveBeenCalledWith(expect.stringContaining('/auth/buscar-usuarios?q=Juan'))
    );
  });

  it('no busca con menos de 3 letras y avisa cuántas faltan', async () => {
    const user = userEvent.setup();
    render(<Login />);

    await user.type(screen.getByPlaceholderText('Escribe tu nombre...'), 'Ju');

    expect(await screen.findByText('Escribe al menos 3 letras de tu nombre')).toBeInTheDocument();
    expect(api.get).not.toHaveBeenCalled();
  });

  it('si cierras la lista con un clic fuera, no se reabre sola', async () => {
    const user = userEvent.setup();
    // La respuesta llega DESPUÉS del clic fuera, que es el caso que fallaba:
    // el debounce y la petición seguían vivos y reabrían la lista encima.
    api.get.mockResolvedValue([{ id: 7, nombre: 'Juan Pérez' }]);
    render(<Login />);

    await user.type(screen.getByPlaceholderText('Escribe tu nombre...'), 'Juan');
    await user.click(document.body);          // clic fuera: el usuario la cierra

    await waitFor(() => expect(api.get).toHaveBeenCalled());
    await waitFor(() => expect(screen.queryByText('Buscando...')).not.toBeInTheDocument());
    expect(screen.queryByRole('button', { name: 'Juan Pérez' })).not.toBeInTheDocument();
  });

  it('vuelve a abrirse en cuanto el usuario sigue escribiendo', async () => {
    const user = userEvent.setup();
    api.get.mockResolvedValue([{ id: 7, nombre: 'Juan Pérez' }]);
    render(<Login />);

    const input = screen.getByPlaceholderText('Escribe tu nombre...');
    await user.type(input, 'Juan');
    await user.click(document.body);
    await user.type(input, 'i');

    expect(await screen.findByRole('button', { name: 'Juan Pérez' })).toBeInTheDocument();
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

// La pantalla de la DEMO pública: sin usuario ni contraseña, solo un botón.
describe('Login en la demo', () => {
  beforeEach(() => { entorno.ES_DEMO = true; });

  it('entra con un solo botón, sin pedir credenciales', async () => {
    const user = userEvent.setup();
    api.post.mockResolvedValue({ token: 'tok', usuario: { id: 1, nombre: 'Prueba' } });
    render(<Login />);

    expect(screen.queryByPlaceholderText('Escribe tu nombre...')).not.toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Entrar' }));

    await waitFor(() => expect(login).toHaveBeenCalledWith('tok', { id: 1, nombre: 'Prueba' }));
  });

  it('explica por qué se cerró la sesión anterior', async () => {
    // El token de la demo caduca en una hora: al volver aquí, el visitante
    // tiene que entender por qué, o parece que la app lo echó sin motivo.
    sessionStorage.setItem('authAviso', 'Tu sesión expiró. Inicia sesión de nuevo.');
    render(<Login />);

    expect(await screen.findByText('Tu sesión expiró. Inicia sesión de nuevo.')).toBeInTheDocument();
  });
});
