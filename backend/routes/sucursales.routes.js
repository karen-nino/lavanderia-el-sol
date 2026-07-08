import { Router } from 'express';
import { verifyToken } from '../middleware/auth.js';
import { requireAdmin } from '../middleware/roles.js';
import { getSucursales, updateSucursal } from '../controllers/sucursales.controller.js';

const router = Router();

router.use(verifyToken);

router.get('/', getSucursales);
router.patch('/:slug', requireAdmin, updateSucursal);

export default router;
