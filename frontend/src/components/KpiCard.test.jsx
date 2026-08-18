import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import KpiCard from './KpiCard';

const renderConRouter = (ui) => render(<MemoryRouter>{ui}</MemoryRouter>);

describe('KpiCard', () => {
  it('muestra el valor, la etiqueta y la sub-etiqueta', () => {
    renderConRouter(<KpiCard value="$1,200" label="Ingresado" sublabel="hoy" />);
    expect(screen.getByText('$1,200')).toBeInTheDocument();
    expect(screen.getByText('Ingresado')).toBeInTheDocument();
    expect(screen.getByText('hoy')).toBeInTheDocument();
  });

  it('con `to` se renderiza como enlace navegable', () => {
    renderConRouter(<KpiCard value="5" label="Notas" to="/notas" />);
    const enlace = screen.getByRole('link');
    expect(enlace).toHaveAttribute('href', '/notas');
  });

  it('sin `to` no es un enlace', () => {
    renderConRouter(<KpiCard value="5" label="Notas" />);
    expect(screen.queryByRole('link')).toBeNull();
  });
});
