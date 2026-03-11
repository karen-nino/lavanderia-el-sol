import { Router } from 'express';
import { verifyToken } from '../middleware/auth.js';
import {
  getOrdenes,
  getOrdenById,
  createOrden,
  cambiarEstadoOrden,
} from '../controllers/ordenes.controller.js';

const router = Router();

router.use(verifyToken);

router.get('/', getOrdenes);
router.get('/:id', getOrdenById);
router.post('/', createOrden);
router.patch('/:id/estado', cambiarEstadoOrden);

export default router;
