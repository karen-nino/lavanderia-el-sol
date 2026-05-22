// Jerarquía: admin_main > admin > operador
// admin_main hereda todos los permisos de admin.

export const esAdmin     = (rol) => rol === 'admin' || rol === 'admin_main';
export const esAdminMain = (rol) => rol === 'admin_main';

export const requireAdmin = (req, res, next) => {
  if (!esAdmin(req.user?.rol)) {
    return res.status(403).json({ message: 'Solo un administrador puede realizar esta acción.' });
  }
  next();
};
