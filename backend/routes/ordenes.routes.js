import { Router } from 'express';
import { verifyToken } from '../middleware/auth.js';
import {
  getOrdenes,
  getOrdenById,
  createOrden,
  eliminarOrden,
  cambiarEstadoOrden,
  cambiarEstadoPago,
  getOrdenProductos,
  addProductoToOrden,
  removeProductoFromOrden,
} from '../controllers/ordenes.controller.js';

const router = Router();

router.use(verifyToken);

router.get('/',    getOrdenes);
router.post('/',   createOrden);
router.get('/:id', getOrdenById);
router.delete('/:id', eliminarOrden);
router.patch('/:id/estado',      cambiarEstadoOrden);
router.patch('/:id/estado-pago', cambiarEstadoPago);
router.get('/:id/productos',    getOrdenProductos);
router.post('/:id/productos',   addProductoToOrden);
router.delete('/:id/productos/:productoId', removeProductoFromOrden);

export default router;
