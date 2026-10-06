import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import CircularTimer from './CircularTimer';

// Cuenta las marcas (líneas) "encendidas" comparando su color de trazo con el
// color de relleno correspondiente al variant.
function contarLlenas(container, colorLleno) {
  return [...container.querySelectorAll('line')].filter(
    (l) => l.getAttribute('stroke') === colorLleno
  ).length;
}

describe('CircularTimer', () => {
  it('muestra la etiqueta y dibuja todas las marcas', () => {
    const { container } = render(<CircularTimer progress={1} label="12:30" ticks={24} />);
    expect(screen.getByText('12:30')).toBeInTheDocument();
    expect(container.querySelectorAll('line')).toHaveLength(24);
  });

  it('llena las marcas en proporción al progreso', () => {
    const { container } = render(<CircularTimer progress={0.5} label="06:00" ticks={24} color="blue" />);
    // 50% de 24 = 12 marcas azules encendidas.
    expect(contarLlenas(container, '#0272C0')).toBe(12);
  });

  it('clampa el progreso fuera de rango [0,1]', () => {
    const { container } = render(<CircularTimer progress={5} label="00:00" ticks={24} />);
    // Progreso > 1 se limita: todas encendidas, ninguna de más.
    expect(contarLlenas(container, '#0272C0')).toBe(24);
  });

  it('el variant verde usa su color de relleno', () => {
    const { container } = render(<CircularTimer progress={1} label="00:00" ticks={10} color="green" />);
    expect(contarLlenas(container, '#2F9F58')).toBe(10);
  });

  it('se llena desde las 12 en el sentido del reloj', () => {
    const { container } = render(<CircularTimer progress={0.25} label="00:15" ticks={4} size={100} />);
    const llenas = [...container.querySelectorAll('line')].filter(
      (l) => l.getAttribute('stroke') === '#0272C0'
    );
    // Con 4 marcas y 25%, la única encendida es la de las 12 (arriba)…
    expect(llenas).toHaveLength(1);
    expect(Number(llenas[0].getAttribute('y1'))).toBeLessThan(50);
    // …y la siguiente marca, la de las 3, queda a la derecha del centro.
    const segunda = container.querySelectorAll('line')[1];
    expect(Number(segunda.getAttribute('x1'))).toBeGreaterThan(50);
  });
});
