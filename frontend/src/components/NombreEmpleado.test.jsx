import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import NombreEmpleado from './NombreEmpleado';

// En jsdom matchMedia devuelve matches:false (escritorio), así que el nombre
// nunca se acorta: se prueba el caso de escritorio y el fallback sin nombre.
describe('NombreEmpleado', () => {
  it('en escritorio muestra el nombre completo', () => {
    render(<NombreEmpleado nombre="Sofía" apellido="Monrraz" />);
    // El nombre aparece dos veces (visible + medidor oculto).
    expect(screen.getAllByText('Sofía Monrraz').length).toBeGreaterThan(0);
  });

  it('sin apellido muestra solo el nombre', () => {
    render(<NombreEmpleado nombre="Ana" />);
    expect(screen.getAllByText('Ana').length).toBeGreaterThan(0);
  });

  it('sin nombre ni apellido muestra el guion largo', () => {
    render(<NombreEmpleado nombre="" apellido="" />);
    expect(screen.getAllByText('—').length).toBeGreaterThan(0);
  });
});
