import { Router } from 'express';
import { verifyToken } from '../middleware/auth.js';
import { sucursalActiva } from '../middleware/sucursalActiva.js';
import { requireAdmin, esAdmin } from '../middleware/roles.js';
import { getResumen, getAnios } from '../controllers/ventas.controller.js';

const router = Router();

router.use(verifyToken, sucursalActiva);

// El Dashboard enseña "Ingresado hoy" a todos: un empleado puede pedir el
// resumen de hoy y solo recibe el total (`soloTotal`). Lo demás es de admin.
const adminOTotalDeHoy = (req, res, next) => {
  if (esAdmin(req.user?.rol)) return next();
  const { periodo = 'hoy', desde, hasta, year, month } = req.query;
  if (periodo === 'hoy' && !desde && !hasta && !year && !month) {
    req.soloTotal = true;
    return next();
  }
  return requireAdmin(req, res, next);
};

router.get('/resumen', adminOTotalDeHoy, getResumen);
router.get('/anios', requireAdmin, getAnios);

export default router;
