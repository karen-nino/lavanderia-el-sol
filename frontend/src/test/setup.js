// Configuración global de las pruebas de componentes (Vitest + Testing Library).
import '@testing-library/jest-dom/vitest';
import { cleanup } from '@testing-library/react';
import { afterEach, vi } from 'vitest';

// Desmonta el árbol renderizado entre pruebas para que no se filtre estado.
afterEach(() => cleanup());

// jsdom no implementa matchMedia; varios componentes lo usan para detectar
// móvil vs. escritorio. Se stubbea con un valor por defecto (escritorio).
if (!window.matchMedia) {
  window.matchMedia = vi.fn().mockImplementation((query) => ({
    matches: false,
    media: query,
    onchange: null,
    addListener: vi.fn(),
    removeListener: vi.fn(),
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
    dispatchEvent: vi.fn(),
  }));
}
