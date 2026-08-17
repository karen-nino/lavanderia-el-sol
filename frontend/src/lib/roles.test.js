import { describe, it, expect } from 'vitest';
import { esAdmin, esAdminMain } from './roles.js';

describe('esAdmin', () => {
  it('admin y admin_main son admin', () => {
    expect(esAdmin('admin')).toBe(true);
    expect(esAdmin('admin_main')).toBe(true);
  });

  it('operador y desconocidos no son admin', () => {
    expect(esAdmin('operador')).toBe(false);
    expect(esAdmin(undefined)).toBe(false);
    expect(esAdmin('')).toBe(false);
  });
});

describe('esAdminMain', () => {
  it('solo admin_main', () => {
    expect(esAdminMain('admin_main')).toBe(true);
    expect(esAdminMain('admin')).toBe(false);
    expect(esAdminMain('operador')).toBe(false);
  });
});
