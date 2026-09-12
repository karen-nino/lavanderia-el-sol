import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';

vi.mock('../lib/api', () => ({ api: { get: vi.fn(), post: vi.fn() } }));
// El modal de apertura mira el rol: el empleado no puede cambiar el fondo.
let usuarioMock = { rol: 'admin' };
vi.mock('../context/AuthContext', () => ({ useAuth: () => ({ usuario: usuarioMock }) }));
import { api } from '../lib/api';
import CashCutCard from './CashCutCard';

const renderCard = () => render(<MemoryRouter><CashCutCard /></MemoryRouter>);

beforeEach(() => {
  api.get.mockReset();
  api.post.mockReset();
  usuarioMock = { rol: 'admin' };
});

describe('CashCutCard', () => {
  it('con caja abierta ofrece realizar el corte', async () => {
    api.get.mockResolvedValue({ abierta: true });
    renderCard();

    expect(await screen.findByText('Corte de Caja')).toBeInTheDocument();
    const enlace = screen.getByRole('link', { name: 'Realizar corte' });
    expect(enlace).toHaveAttribute('href', '/caja?tab=corte');
  });

  it('sin corte anterior, un admin captura el fondo y abre la caja', async () => {
    api.get.mockResolvedValue({ abierta: false, apertura_sugerida: null });
    api.post.mockResolvedValue({});
    renderCard();

    // Botón de la tarjeta para abrir el modal.
    const abrir = await screen.findByRole('button', { name: 'Abrir caja' });
    await userEvent.click(abrir);

    // El modal pide el fondo inicial.
    const monto = await screen.findByPlaceholderText('0.00');
    await userEvent.type(monto, '500');

    // Enviar el formulario (el segundo botón "Abrir caja" es el submit del modal).
    const botones = screen.getAllByRole('button', { name: 'Abrir caja' });
    await userEvent.click(botones[botones.length - 1]);

    expect(api.post).toHaveBeenCalledWith('/caja/abrir', { monto_inicial: 500, notas: '' });
    // Tras abrir, el botón pasa a "Realizar corte".
    expect(await screen.findByRole('link', { name: 'Realizar corte' })).toBeInTheDocument();
  });

  it('un empleado abre con lo que quedó del corte anterior, sin poder cambiarlo', async () => {
    usuarioMock = { rol: 'operador' };
    api.get.mockResolvedValue({
      abierta: false,
      apertura_sugerida: {
        monto: 742.5,
        origen: 'corte',
        corte: { id: 1, cerrada_at: '2026-09-11T21:00:00.000Z', monto_contado: 742.5, esperado: 742.5 },
      },
    });
    api.post.mockResolvedValue({});
    renderCard();

    await userEvent.click(await screen.findByRole('button', { name: 'Abrir caja' }));

    // El fondo viene puesto y bloqueado: el empleado solo confirma.
    const monto = await screen.findByLabelText('Fondo inicial');
    expect(monto).toHaveValue(742.5);
    expect(monto).toHaveAttribute('readonly');

    const botones = screen.getAllByRole('button', { name: 'Abrir caja' });
    await userEvent.click(botones[botones.length - 1]);

    expect(api.post).toHaveBeenCalledWith('/caja/abrir', { monto_inicial: 742.5, notas: '' });
  });
});
