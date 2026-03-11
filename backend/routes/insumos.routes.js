import { Router } from 'express';
import { verifyToken } from '../middleware/auth.js';
import {
  getInsumos,
  createInsumo,
  updateInsumo,
  registrarMovimiento,
} from '../controllers/insumos.controller.js';

const router = Router();

router.use(verifyToken);

router.get('/', getInsumos);
router.post('/', createInsumo);
router.patch('/:id', updateInsumo);
router.post('/:id/movimiento', registrarMovimiento);

export default router;
