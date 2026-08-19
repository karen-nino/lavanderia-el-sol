import { defineConfig } from 'vitest/config';

// Pruebas UNIT: lógica pura, sin base de datos. Rápidas y sin dependencias
// externas. Las de integración van en vitest.integration.config.js.
export default defineConfig({
  test: {
    environment: 'node',
    include: ['utils/**/*.test.js', 'services/**/*.test.js'],
  },
});
