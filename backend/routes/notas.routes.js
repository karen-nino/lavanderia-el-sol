import { Router } from 'express';
import { verifyToken } from '../middleware/auth.js';
import {
  getNotas,
  getNotaById,
  getNextFolio,
  createNota,
  updateNota,
  eliminarNota,
  cambiarEstadoNota,
  activarNota,
  cambiarEstadoPago,
  getNotaProductos,
  addProductoToNota,
  removeProductoFromNota,
} from '../controllers/notas.controller.js';

const router = Router();

router.use(verifyToken);

router.get('/',           getNotas);
router.get('/next-folio', getNextFolio);
router.post('/',          createNota);
router.get('/:id',        getNotaById);
router.patch('/:id', updateNota);
router.delete('/:id', eliminarNota);
router.patch('/:id/estado',      cambiarEstadoNota);
router.patch('/:id/activar',     activarNota);
router.patch('/:id/estado-pago', cambiarEstadoPago);
router.get('/:id/productos',    getNotaProductos);
router.post('/:id/productos',   addProductoToNota);
router.delete('/:id/productos/:productoId', removeProductoFromNota);

export default router;
