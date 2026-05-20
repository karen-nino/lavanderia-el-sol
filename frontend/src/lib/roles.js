// Jerarquía: admin_main > admin > operador
// admin_main hereda todos los permisos de admin.

export const esAdmin     = (rol) => rol === 'admin' || rol === 'admin_main';
export const esAdminMain = (rol) => rol === 'admin_main';
