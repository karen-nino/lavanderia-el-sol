import { Router } from 'express';
import { verifyToken } from '../middleware/auth.js';
import {
  getOrdenes,
  getOrdenById,
  createOrden,
  eliminarOrden,
  cambiarEstadoOrden,
  cambiarEstadoPago,
  getOrdenArticulos,
  addArticuloToOrden,
  removeArticuloFromOrden,
} from '../controllers/ordenes.controller.js';

const router = Router();

router.use(verifyToken);

router.get('/',    getOrdenes);
router.post('/',   createOrden);
router.get('/:id', getOrdenById);
router.delete('/:id', eliminarOrden);
router.patch('/:id/estado',      cambiarEstadoOrden);
router.patch('/:id/estado-pago', cambiarEstadoPago);
router.get('/:id/articulos',    getOrdenArticulos);
router.post('/:id/articulos',   addArticuloToOrden);
router.delete('/:id/articulos/:articuloId', removeArticuloFromOrden);

export default router;
