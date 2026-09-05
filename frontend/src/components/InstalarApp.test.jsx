import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

// El módulo pwa habla con el navegador (evento beforeinstallprompt, matchMedia,
// userAgent), así que aquí se sustituye: lo que se prueba es qué ofrece el
// botón en cada situación, no la detección en sí.
vi.mock('../lib/pwa', () => ({
  leerEstadoInstalacion: vi.fn(),
  estaInstalada: vi.fn(),
  suscribirse: vi.fn(() => () => {}),
  lanzarInstalacion: vi.fn(),
}));

import { leerEstadoInstalacion, estaInstalada, lanzarInstalacion } from '../lib/pwa';
import InstalarApp from './InstalarApp';

beforeEach(() => {
  vi.clearAllMocks();
  estaInstalada.mockReturnValue(false);
  lanzarInstalacion.mockResolvedValue('aceptada');
});

describe('InstalarApp', () => {
  it('con diálogo nativo disponible, ofrece instalar y lo lanza', async () => {
    leerEstadoInstalacion.mockReturnValue({ disponible: true, comoInstalar: 'prompt' });
    render(<InstalarApp />);

    const boton = screen.getByRole('button', { name: /instalar app/i });
    await userEvent.click(boton);

    expect(lanzarInstalacion).toHaveBeenCalledTimes(1);
  });

  it('tras aceptar la instalación, el botón desaparece', async () => {
    leerEstadoInstalacion.mockReturnValue({ disponible: true, comoInstalar: 'prompt' });
    render(<InstalarApp />);

    await userEvent.click(screen.getByRole('button', { name: /instalar app/i }));

    expect(screen.queryByRole('button', { name: /instalar app/i })).not.toBeInTheDocument();
  });

  it('en iPhone explica los pasos en vez de intentar instalar', async () => {
    // Safari no deja instalar por código: el botón solo puede abrir la ayuda.
    leerEstadoInstalacion.mockReturnValue({ disponible: true, comoInstalar: 'ios' });
    render(<InstalarApp />);

    await userEvent.click(screen.getByRole('button', { name: /cómo instalarla/i }));

    expect(lanzarInstalacion).not.toHaveBeenCalled();
    expect(screen.getByText(/Agregar a inicio/i)).toBeInTheDocument();
  });

  it('no se muestra si la app ya está instalada', () => {
    estaInstalada.mockReturnValue(true);
    leerEstadoInstalacion.mockReturnValue({ disponible: true, comoInstalar: 'prompt' });
    const { container } = render(<InstalarApp />);
    expect(container).toBeEmptyDOMElement();
  });

  it('no se muestra en un navegador que no la admite', () => {
    leerEstadoInstalacion.mockReturnValue({ disponible: false, comoInstalar: null });
    const { container } = render(<InstalarApp />);
    expect(container).toBeEmptyDOMElement();
  });
});
