import { Router } from 'express';
import { verifyToken } from '../middleware/auth.js';
import { requireAdmin, requireAdminMain } from '../middleware/roles.js';
import {
  getSucursales,
  createSucursal,
  updateSucursal,
  setActivaSucursal,
} from '../controllers/sucursales.controller.js';

const router = Router();

router.use(verifyToken);

router.get('/', getSucursales);
router.post('/', requireAdmin, createSucursal);
router.patch('/:slug', requireAdmin, updateSucursal);
router.patch('/:slug/activa', requireAdminMain, setActivaSucursal);

export default router;
