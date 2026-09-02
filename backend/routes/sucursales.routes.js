import { Router } from 'express';
import { verifyToken } from '../middleware/auth.js';
import { requireAdmin, requireAdminMain } from '../middleware/roles.js';
import { bloquearPruebaGlobal } from '../middleware/sucursalActiva.js';
import {
  getSucursales,
  createSucursal,
  updateSucursal,
  setActivaSucursal,
  reordenarSucursales,
} from '../controllers/sucursales.controller.js';

const router = Router();

router.use(verifyToken);

router.get('/', getSucursales);
router.post('/', requireAdmin, bloquearPruebaGlobal, createSucursal);
// Antes de /:slug para que "reordenar" no se interprete como un slug.
router.patch('/reordenar', requireAdmin, bloquearPruebaGlobal, reordenarSucursales);
router.patch('/:slug', requireAdmin, bloquearPruebaGlobal, updateSucursal);
router.patch('/:slug/activa', requireAdminMain, bloquearPruebaGlobal, setActivaSucursal);

export default router;
