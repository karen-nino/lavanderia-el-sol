import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';

vi.mock('../lib/api', () => ({ api: { get: vi.fn(), post: vi.fn() } }));
import { api } from '../lib/api';
import CashCutCard from './CashCutCard';

const renderCard = () => render(<MemoryRouter><CashCutCard /></MemoryRouter>);

beforeEach(() => {
  api.get.mockReset();
  api.post.mockReset();
});

describe('CashCutCard', () => {
  it('con caja abierta ofrece realizar el corte', async () => {
    api.get.mockResolvedValue({ abierta: true });
    renderCard();

    expect(await screen.findByText('Corte de Caja')).toBeInTheDocument();
    const enlace = screen.getByRole('link', { name: 'Realizar corte' });
    expect(enlace).toHaveAttribute('href', '/caja?tab=corte');
  });

  it('sin caja abierta permite abrirla desde el modal', async () => {
    api.get.mockResolvedValue({ abierta: false });
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
});
