import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { useContext } from 'react';
import { AuthProvider } from './AuthProvider';
import { AuthContext } from './AuthContext';
import { recordarListaNotas, urlListaNotas } from '../lib/filtrosNotas';

// El aviso de salida al servidor no debe frenar el cierre de sesión.
vi.mock('../lib/api', () => ({ api: { post: vi.fn(() => Promise.resolve()) } }));

function BotonSalir() {
  const { logout } = useContext(AuthContext);
  return <button onClick={logout}>Salir</button>;
}

describe('AuthProvider — cerrar sesión', () => {
  beforeEach(() => {
    localStorage.clear();
    sessionStorage.clear();
  });

  it('borra las credenciales y los rastros del turno que termina', async () => {
    localStorage.setItem('token', 'abc');
    localStorage.setItem('usuario', JSON.stringify({ nombre: 'Ana' }));
    // El filtro con el que el empleado anterior dejó la lista de notas: al
    // entrar otro en el mismo teléfono no debe encontrárselo.
    recordarListaNotas('/notas?fecha=AYER');

    render(<AuthProvider><BotonSalir /></AuthProvider>);
    await userEvent.click(screen.getByText('Salir'));

    expect(localStorage.getItem('token')).toBeNull();
    expect(localStorage.getItem('usuario')).toBeNull();
    expect(urlListaNotas()).toBe('/notas');
  });
});
