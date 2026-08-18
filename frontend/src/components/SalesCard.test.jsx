import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import SalesCard from './SalesCard';

const renderConRouter = (ui) => render(<MemoryRouter>{ui}</MemoryRouter>);

describe('SalesCard', () => {
  it('formatea el total como moneda MXN sin decimales', () => {
    renderConRouter(<SalesCard total={1200} />);
    expect(screen.getByText('$1,200')).toBeInTheDocument();
    expect(screen.getByText('Ventas Hoy')).toBeInTheDocument();
  });

  it('sin total muestra $0', () => {
    renderConRouter(<SalesCard total={null} label="Ventas" />);
    expect(screen.getByText('$0')).toBeInTheDocument();
  });

  it('con `to` navega como enlace', () => {
    renderConRouter(<SalesCard total={500} to="/ventas" />);
    expect(screen.getByRole('link')).toHaveAttribute('href', '/ventas');
  });
});
