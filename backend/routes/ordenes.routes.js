import { Router } from 'express';
import { verifyToken } from '../middleware/auth.js';
import {
  getOrdenes,
  getOrdenById,
  createOrden,
  eliminarOrden,
  cambiarEstadoOrden,
  cambiarEstadoPago,
} from '../controllers/ordenes.controller.js';

const router = Router();

router.use(verifyToken);

router.get('/', getOrdenes);
router.get('/:id', getOrdenById);
router.post('/', createOrden);
router.delete('/:id', eliminarOrden);
router.patch('/:id/estado', cambiarEstadoOrden);
router.patch('/:id/estado-pago', cambiarEstadoPago);

export default router;
